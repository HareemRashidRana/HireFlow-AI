"""Who may use the applications API. Enforced on the server, never only in the UI."""

import uuid

import pytest
from sqlalchemy import select

from app.models.application import Application
from app.models.user import UserRole
from tests.conftest import sign_in
from tests.test_applications import APPS, make_application, make_candidate, move, open_job

A, HR, REC, EMP = UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER, UserRole.EMPLOYEE


@pytest.fixture
def setup(client_as, make_user, new_client):
    admin = client_as(A)
    existing = make_application(admin, 1)

    def as_role(role: UserRole):
        if role == A:
            return admin
        if role == EMP:
            user = make_user(EMP, employee_id=None)
            c = new_client()
            sign_in(c, user.email)
            return c
        return client_as(role)

    return admin, existing, as_role


def fresh(admin):
    """Cases that change state each need their own untouched application."""
    return make_application(admin, next(_n))


_n = iter(range(100, 10_000))

ROLES = (A, HR, REC, EMP)
# (description, method, path, body, {role: expected status}); a path/body may need the application.
MATRIX = [
    ("list", "get", lambda a: APPS, None, {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("board", "get", lambda a: f"{APPS}/board", None, {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("summary", "get", lambda a: f"{APPS}/summary", None, {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("recruiters", "get", lambda a: f"{APPS}/recruiters", None, {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("view", "get", lambda a: f"{APPS}/{a['id']}", None, {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("edit notes", "patch", lambda a: f"{APPS}/{a['id']}", lambda a: {"internal_notes": "n"},
     {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("advance a stage", "post", lambda a: f"{APPS}/{a['id']}/stage", lambda a: {"stage": "screening"},
     {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("reject", "post", lambda a: f"{APPS}/{a['id']}/stage", lambda a: {"stage": "rejected", "note": "No"},
     {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("withdraw", "post", lambda a: f"{APPS}/{a['id']}/stage", lambda a: {"stage": "withdrawn"},
     {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("reopen a fresh application", "post", lambda a: f"{APPS}/{a['id']}/reopen", lambda a: {},
     {A: 409, HR: 409, REC: 403, EMP: 403}),  # 409 = allowed to try, but nothing to reopen
]
CASES = [(m[0], role, m[4][role], m) for m in MATRIX for role in ROLES]


@pytest.mark.parametrize("desc,role,expected,case", CASES, ids=[f"{d}|{r.value}" for d, r, _, _ in CASES])
def test_permission_matrix(setup, desc, role, expected, case):
    admin, _, as_role = setup
    app = fresh(admin)
    _, method, path_for, body_for, _ = case
    kwargs = {"json": body_for(app)} if body_for else {}
    res = getattr(as_role(role), method)(path_for(app), **kwargs)
    assert res.status_code == expected, f"{desc} as {role.value}: {res.status_code} {res.text}"


def test_creating_applications(setup):
    admin, _, as_role = setup
    for n, (role, expected) in enumerate([(A, 201), (HR, 201), (REC, 201), (EMP, 403)], start=50):
        c = as_role(role)
        res = c.post(APPS, json={"candidate_id": make_candidate(admin, n)["id"], "job_id": open_job(admin, n)["id"]})
        assert res.status_code == expected, f"{role.value}: {res.text}"


def test_hiring_and_reopening_are_hr_only(setup):
    admin, _, as_role = setup
    for role, hire, reopen in [(A, 200, 200), (HR, 200, 200), (REC, 403, 403), (EMP, 403, 403)]:
        a, b = fresh(admin), fresh(admin)
        for step in ("screening", "shortlisted", "interview", "offer"):
            move(admin, a["id"], step)
        move(admin, b["id"], "rejected", note="x")
        c = as_role(role)
        assert move(c, a["id"], "hired").status_code == hire, role.value
        assert c.post(f"{APPS}/{b['id']}/reopen", json={}).status_code == reopen, role.value


def test_forbidden_requests_change_nothing(setup, session_factory):
    admin, existing, as_role = setup
    emp, rec = as_role(EMP), as_role(REC)
    emp.patch(f"{APPS}/{existing['id']}", json={"internal_notes": "Hacked"})
    move(emp, existing["id"], "screening")
    move(rec, existing["id"], "hired")
    emp.post(f"{APPS}/{existing['id']}/reopen", json={})
    emp.post(APPS, json={"candidate_id": make_candidate(admin, 77)["id"], "job_id": open_job(admin, 77)["id"]})
    after = admin.get(f"{APPS}/{existing['id']}").json()
    assert after["stage"] == "applied" and after["internal_notes"] is None
    assert len(after["events"]) == 1
    assert admin.get(APPS).json()["total"] == 1


def test_forbidden_responses_leak_no_application_data(setup):
    admin, existing, as_role = setup
    emp = as_role(EMP)
    for res in (emp.get(f"{APPS}/{existing['id']}"), emp.get(APPS), emp.get(f"{APPS}/board")):
        assert res.status_code == 403
        for secret in (existing["candidate"]["email"], existing["candidate"]["first_name"], existing["job"]["title"]):
            assert secret not in res.text


def test_employees_cannot_reach_history_or_notes_of_anyone(setup):
    admin, existing, as_role = setup
    admin.patch(f"{APPS}/{existing['id']}", json={"internal_notes": "private opinion"})
    emp = as_role(EMP)
    for path in (f"{APPS}/{existing['id']}", APPS, f"{APPS}/board", f"{APPS}/summary"):
        res = emp.get(path)
        assert res.status_code == 403 and "private opinion" not in res.text


def test_an_employee_linked_to_the_candidates_email_still_gets_nothing(setup, make_user, new_client):
    """Being the same person as a candidate does not open the recruiting data."""
    admin, existing, _ = setup
    user = make_user(EMP, email=existing["candidate"]["email"])
    c = new_client()
    sign_in(c, user.email)
    assert c.get(f"{APPS}/{existing['id']}").status_code == 403
    assert c.get(APPS, params={"candidate_id": existing["candidate"]["id"]}).status_code == 403


PROTECTED = [
    ("get", APPS), ("post", APPS), ("get", f"{APPS}/board"), ("get", f"{APPS}/summary"),
    ("get", f"{APPS}/recruiters"), ("get", f"{APPS}/{uuid.uuid4()}"), ("patch", f"{APPS}/{uuid.uuid4()}"),
    ("post", f"{APPS}/{uuid.uuid4()}/stage"), ("post", f"{APPS}/{uuid.uuid4()}/reopen"),
]


@pytest.mark.parametrize("method,path", PROTECTED)
def test_anonymous_requests_get_401(anon, method, path):
    res = getattr(anon, method)(path)
    assert res.status_code == 401
    assert res.headers["www-authenticate"] == "Bearer"


def test_a_user_who_must_change_their_password_is_blocked(new_client, make_user):
    user = make_user(REC, must_change_password=True)
    c = new_client()
    sign_in(c, user.email)
    assert c.get(APPS).status_code == 403


def test_deactivated_staff_lose_access_immediately(setup, client_as):
    admin, _, _ = setup
    rec = client_as(REC)
    assert rec.get(APPS).status_code == 200
    admin.patch(f"/api/v1/users/{rec.user.id}", json={"is_active": False})
    assert rec.get(APPS).status_code == 401


def test_demoting_staff_applies_to_existing_tokens_immediately(setup, client_as):
    from tests.conftest import employee_payload

    admin, existing, _ = setup
    rec = client_as(REC)
    assert move(rec, existing["id"], "screening").status_code == 200
    employee = admin.post("/api/v1/employees", json=employee_payload(96)).json()
    admin.patch(f"/api/v1/users/{rec.user.id}", json={"role": "employee", "employee_id": employee["id"]})
    assert rec.get(APPS).status_code == 403
    assert move(rec, existing["id"], "shortlisted").status_code == 403


class TestRecruiterAssignment:
    def test_admin_and_hr_can_assign_anyone(self, setup, client_as):
        admin, existing, as_role = setup
        other = client_as(REC)
        hr = as_role(HR)
        for who in (admin, hr):
            res = who.patch(f"{APPS}/{existing['id']}", json={"assigned_recruiter_id": str(other.user.id)})
            assert res.status_code == 200
            who.patch(f"{APPS}/{existing['id']}", json={"assigned_recruiter_id": None})

    def test_a_recruiter_can_take_an_application_for_themselves(self, setup, client_as):
        _, existing, _ = setup
        rec = client_as(REC)
        res = rec.patch(f"{APPS}/{existing['id']}", json={"assigned_recruiter_id": str(rec.user.id)})
        assert res.status_code == 200 and res.json()["assigned_recruiter"]["id"] == str(rec.user.id)

    def test_a_recruiter_can_release_their_own_claim(self, setup, client_as):
        _, existing, _ = setup
        rec = client_as(REC)
        rec.patch(f"{APPS}/{existing['id']}", json={"assigned_recruiter_id": str(rec.user.id)})
        res = rec.patch(f"{APPS}/{existing['id']}", json={"assigned_recruiter_id": None})
        assert res.status_code == 200 and res.json()["assigned_recruiter"] is None

    def test_a_recruiter_cannot_assign_someone_else(self, setup, client_as):
        _, existing, _ = setup
        rec, colleague = client_as(REC), client_as(REC)
        res = rec.patch(f"{APPS}/{existing['id']}", json={"assigned_recruiter_id": str(colleague.user.id)})
        assert res.status_code == 403 and rec.get(f"{APPS}/{existing['id']}").json()["assigned_recruiter"] is None

    def test_a_recruiter_cannot_clear_a_colleagues_assignment(self, setup, client_as):
        admin, existing, _ = setup
        rec, colleague = client_as(REC), client_as(REC)
        admin.patch(f"{APPS}/{existing['id']}", json={"assigned_recruiter_id": str(colleague.user.id)})
        # Clearing someone else's claim is refused. (Taking an application for themselves is
        # allowed: recruiters share all applications.)
        admin.patch(f"{APPS}/{existing['id']}", json={"assigned_recruiter_id": str(colleague.user.id)})
        res = rec.patch(f"{APPS}/{existing['id']}", json={"assigned_recruiter_id": None})
        assert res.status_code == 403
        assert admin.get(f"{APPS}/{existing['id']}").json()["assigned_recruiter"]["id"] == str(colleague.user.id)

    def test_the_actor_is_recorded_on_the_server_not_taken_from_the_client(self, setup, client_as, session_factory):
        _, existing, _ = setup
        rec = client_as(REC)
        res = rec.post(f"{APPS}/{existing['id']}/stage", json={"stage": "screening", "actor_id": str(uuid.uuid4())})
        assert res.status_code == 422
        rec.post(f"{APPS}/{existing['id']}/stage", json={"stage": "screening"})
        with session_factory() as db:
            row = db.scalar(select(Application).where(Application.id == uuid.UUID(existing["id"])))
            assert row.events[-1].actor_id == rec.user.id
