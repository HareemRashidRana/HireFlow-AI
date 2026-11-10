"""Who may use Requirements Coverage, and that guessing ids gets nobody anything."""

import uuid

import pytest

from app.models.user import UserRole
from tests.conftest import sign_in
from tests.screening_helpers import SCREENING, assess, build
from tests.test_jobs import JOBS

A, HR, REC, EMP = UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER, UserRole.EMPLOYEE
ROLES = (A, HR, REC, EMP)


@pytest.fixture
def world(client_as, make_user, new_client):
    admin = client_as(A)
    scenario = build(admin)
    assessment = assess(admin, scenario).json()

    def as_role(role):
        if role == A:
            return admin
        if role == EMP:
            c = new_client()
            sign_in(c, make_user(EMP, employee_id=None).email)
            return c
        return client_as(role)

    return admin, scenario, assessment, as_role


# (description, call, expected status per role)
CASES = [
    ("create", lambda c, s, a: c.post(s.app_url), {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("list", lambda c, s, a: c.get(s.app_url), {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("detail", lambda c, s, a: c.get(f"{SCREENING}/{a['id']}"), {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("review", lambda c, s, a: c.post(f"{SCREENING}/{a['id']}/reviews", json={"judgement": "agree"}),
     {A: 201, HR: 201, REC: 201, EMP: 403}),
    ("job overview", lambda c, s, a: c.get(f"{JOBS}/{s.job['id']}/screening"), {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("methodology", lambda c, s, a: c.get(f"{SCREENING}/methodology"), {A: 200, HR: 200, REC: 200, EMP: 403}),
]
PARAMS = [(d, role, exp[role], call) for d, call, exp in CASES for role in ROLES]


@pytest.mark.parametrize("desc,role,expected,call", PARAMS, ids=[f"{d}|{r.value}" for d, r, _, _ in PARAMS])
def test_permission_matrix(world, desc, role, expected, call):
    admin, scenario, assessment, as_role = world
    res = call(as_role(role), scenario, assessment)
    assert res.status_code == expected, f"{desc} as {role.value}: {res.status_code} {res.text[:200]}"


def test_create_is_201_the_first_time_for_every_staff_role(client_as):
    for n, role in enumerate((A, HR, REC), start=1):
        c = client_as(role)
        assert assess(c, build(c, 10 + n)).status_code == 201


def test_anonymous_requests_get_401(anon, world):
    _, scenario, assessment, _ = world
    calls = [
        anon.post(scenario.app_url), anon.get(scenario.app_url), anon.get(f"{SCREENING}/{assessment['id']}"),
        anon.post(f"{SCREENING}/{assessment['id']}/reviews", json={"judgement": "agree"}),
        anon.get(f"{JOBS}/{scenario.job['id']}/screening"), anon.get(f"{SCREENING}/methodology"),
    ]
    assert [c.status_code for c in calls] == [401] * 6
    assert all(c.headers["www-authenticate"] == "Bearer" for c in calls)


def test_a_forbidden_request_leaks_and_changes_nothing(world, session_factory):
    from sqlalchemy import func, select

    from app.models.audit import CandidateAuditEvent
    from app.models.screening import ScreeningAssessment, ScreeningReview

    admin, scenario, assessment, as_role = world
    emp = as_role(EMP)
    with session_factory() as db:
        before = (
            db.scalar(select(func.count()).select_from(ScreeningAssessment)),
            db.scalar(select(func.count()).select_from(ScreeningReview)),
            db.scalar(select(func.count()).select_from(CandidateAuditEvent)),
        )
    for res in (
        emp.get(f"{SCREENING}/{assessment['id']}"), emp.post(scenario.app_url),
        emp.post(f"{SCREENING}/{assessment['id']}/reviews", json={"judgement": "disagree", "note": "x"}),
    ):
        assert res.status_code == 403
        assert scenario.candidate["email"] not in res.text and "Python" not in res.text
    with session_factory() as db:
        after = (
            db.scalar(select(func.count()).select_from(ScreeningAssessment)),
            db.scalar(select(func.count()).select_from(ScreeningReview)),
            db.scalar(select(func.count()).select_from(CandidateAuditEvent)),
        )
    assert after == before  # not even an audit row


def test_guessing_ids_gets_an_employee_nothing_not_even_a_404_hint(world):
    _, _, _, as_role = world
    emp = as_role(EMP)
    for _ in range(5):
        assert emp.get(f"{SCREENING}/{uuid.uuid4()}").status_code == 403  # role check comes first
        assert emp.get(f"/api/v1/applications/{uuid.uuid4()}/screening").status_code == 403


def test_staff_guessing_ids_get_a_plain_404(world):
    _, _, _, as_role = world
    rec = as_role(REC)
    for res in (rec.get(f"{SCREENING}/{uuid.uuid4()}"), rec.get(f"/api/v1/applications/{uuid.uuid4()}/screening"),
                rec.post(f"/api/v1/applications/{uuid.uuid4()}/screening")):
        assert res.status_code == 404 and res.json() == {"detail": res.json()["detail"]}


def test_an_assessment_is_only_reachable_under_its_own_application(world, client_as):
    admin, scenario, assessment, _ = world
    other = build(admin, 2)
    listing = admin.get(other.app_url).json()
    assert listing["total"] == 0 and assessment["id"] not in str(listing)
    other_job = admin.get(f"{JOBS}/{other.job['id']}/screening").json()
    assert assessment["id"] not in str(other_job) and scenario.candidate["email"] not in str(other_job)
    assert admin.get(f"{JOBS}/{scenario.job['id']}/screening").json()["items"][0]["application_id"] == scenario.application["id"]


def test_recruiter_assignment_does_not_restrict_viewing_today(world, client_as):
    """Applications are visible to every recruiter (assignment only limits who may ASSIGN), so
    screening follows the same rule. This pins the behaviour so a change is deliberate."""
    admin, scenario, assessment, _ = world
    assigned = client_as(REC)
    unassigned = client_as(REC)
    assert admin.patch(
        f"/api/v1/applications/{scenario.application['id']}", json={"assigned_recruiter_id": str(assigned.user.id)}
    ).status_code == 200
    for rec in (assigned, unassigned):
        assert rec.get(f"{SCREENING}/{assessment['id']}").status_code == 200
        assert rec.get(scenario.app_url).status_code == 200


def test_a_user_who_must_change_their_password_is_blocked(new_client, make_user, world):
    _, scenario, assessment, _ = world
    c = new_client()
    sign_in(c, make_user(REC, must_change_password=True).email)
    assert c.get(f"{SCREENING}/{assessment['id']}").status_code == 403
    assert c.post(scenario.app_url).status_code == 403


def test_a_deactivated_recruiter_loses_access_immediately(world, client_as):
    admin, _, assessment, _ = world
    rec = client_as(REC)
    assert rec.get(f"{SCREENING}/{assessment['id']}").status_code == 200
    admin.patch(f"/api/v1/users/{rec.user.id}", json={"is_active": False})
    assert rec.get(f"{SCREENING}/{assessment['id']}").status_code == 401


def test_the_requester_is_the_session_user_not_a_request_field(world, client_as):
    _, scenario, _, _ = world
    rec = client_as(REC)
    other = build(rec, 3)
    res = rec.post(other.app_url, json={"requested_by_id": str(uuid.uuid4())})
    assert res.status_code == 201 and res.json()["requested_by"]["email"] == rec.user.email


def test_no_endpoint_changes_or_removes_an_assessment(world):
    admin, _, assessment, _ = world
    url = f"{SCREENING}/{assessment['id']}"
    for method in ("put", "patch", "delete"):
        assert getattr(admin, method)(url).status_code == 405
        assert getattr(admin, method)(f"{url}/reviews").status_code == 405
