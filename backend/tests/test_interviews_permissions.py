"""Who may use interviews, and that guessing ids gets nobody anything."""

import uuid

import pytest

from app.models.user import UserRole
from tests.conftest import sign_in
from tests.interview_helpers import INTERVIEWS, feedback_body, new_application, payload, slot

A, HR, REC, EMP = UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER, UserRole.EMPLOYEE
ROLES = (A, HR, REC, EMP)


@pytest.fixture
def world(client_as, make_user, new_client):
    admin = client_as(A)
    app = new_application(admin, 1)
    interviewer = make_user(UserRole.RECRUITER)
    made = admin.post(INTERVIEWS, json=payload(app, [interviewer])).json()

    def as_role(role):
        if role == A:
            return admin
        if role == EMP:
            c = new_client()
            sign_in(c, make_user(EMP, employee_id=None).email)
            return c
        return client_as(role)

    return admin, app, made, interviewer, as_role


def cases(app, made, interviewer):
    i = f"{INTERVIEWS}/{made['id']}"
    return [
        ("list", lambda c: c.get(INTERVIEWS)),
        ("stats", lambda c: c.get(f"{INTERVIEWS}/stats")),
        ("rating scale", lambda c: c.get(f"{INTERVIEWS}/rating-scale")),
        ("assignable interviewers", lambda c: c.get(f"{INTERVIEWS}/interviewers")),
        ("detail", lambda c: c.get(i)),
        ("history", lambda c: c.get(f"{i}/history")),
        ("application's interviews", lambda c: c.get(f"/api/v1/applications/{app['id']}/interviews")),
        ("feedback overview", lambda c: c.get(f"{i}/feedback")),
        ("update", lambda c: c.patch(i, json={"title": "Renamed"})),
        ("confirm", lambda c: c.post(f"{i}/confirm")),
        ("add interviewer", lambda c: c.post(f"{i}/interviewers", json={"user_id": str(uuid.uuid4())})),
        ("create", lambda c: c.post(INTERVIEWS, json=payload(app, [interviewer], day=9))),
        ("reschedule", lambda c: c.post(f"{i}/reschedule", json=slot(11, 10))),
        ("cancel", lambda c: c.post(f"{i}/cancel", json={"reason": "x"})),
    ]


STAFF_OK = {"list": 200, "stats": 200, "rating scale": 200, "assignable interviewers": 200, "detail": 200, "history": 200,
            "application's interviews": 200, "feedback overview": 200, "update": 200, "confirm": 200,
            "add interviewer": 422, "create": 201, "reschedule": 201, "cancel": 409}
# (cancel comes after reschedule in the list, so the original is already rescheduled: 409 proves the call got that far)

NAMES = [n for n, _ in cases({"id": "x"}, {"id": "x"}, None)]


@pytest.mark.parametrize("name", NAMES)
@pytest.mark.parametrize("role", ROLES, ids=lambda r: r.value)
def test_permission_matrix(world, role, name):
    admin, app, made, interviewer, as_role = world
    call = dict(cases(app, made, interviewer))[name]
    res = call(as_role(role))
    expected = 403 if role == EMP else STAFF_OK[name]
    if name == "cancel" and role != EMP:
        # a fresh interview for this call, so the answer does not depend on test order
        fresh = admin.post(INTERVIEWS, json=payload(new_application(admin, 5), [interviewer], day=12)).json()
        res = as_role(role).post(f"{INTERVIEWS}/{fresh['id']}/cancel", json={"reason": "x"})
        expected = 200
    if name == "reschedule" and role != EMP:
        fresh = admin.post(INTERVIEWS, json=payload(new_application(admin, 6), [interviewer], day=13)).json()
        res = as_role(role).post(f"{INTERVIEWS}/{fresh['id']}/reschedule", json=slot(14, 10))
        expected = 201
    if name == "create" and role != EMP:
        res = as_role(role).post(INTERVIEWS, json=payload(new_application(admin, 7), [interviewer], day=15))
    assert res.status_code == expected, f"{name} as {role.value}: {res.status_code} {res.text[:160]}"


def test_anonymous_requests_get_401(anon, world):
    admin, app, made, interviewer, _ = world
    results = [call(anon).status_code for _, call in cases(app, made, interviewer)]
    assert results == [401] * len(results)
    assert anon.get(INTERVIEWS).headers["www-authenticate"] == "Bearer"


def test_an_employee_changes_nothing_and_leaks_nothing(world, session_factory):
    from sqlalchemy import func, select

    from app.models.audit import CandidateAuditEvent
    from app.models.interview import Interview, InterviewEvent

    admin, app, made, interviewer, as_role = world
    emp = as_role(EMP)
    with session_factory() as db:
        before = [db.scalar(select(func.count()).select_from(t)) for t in (Interview, InterviewEvent, CandidateAuditEvent)]
    for _, call in cases(app, made, interviewer):
        res = call(emp)
        assert res.status_code == 403
        assert app["candidate"]["first_name"] not in res.text and made["title"] not in res.text
    emp.put(f"{INTERVIEWS}/{made['id']}/feedback", json=feedback_body())
    emp.post(f"{INTERVIEWS}/{made['id']}/feedback/submit", json=feedback_body())
    with session_factory() as db:
        after = [db.scalar(select(func.count()).select_from(t)) for t in (Interview, InterviewEvent, CandidateAuditEvent)]
    assert after == before


def test_employees_get_403_before_any_lookup_so_ids_reveal_nothing(world):
    _, _, _, _, as_role = world
    emp = as_role(EMP)
    for _ in range(3):
        assert emp.get(f"{INTERVIEWS}/{uuid.uuid4()}").status_code == 403
        assert emp.get(f"{INTERVIEWS}/{uuid.uuid4()}/feedback").status_code == 403


def test_staff_guessing_ids_get_a_plain_404(world):
    _, _, _, _, as_role = world
    rec = as_role(REC)
    ghost = uuid.uuid4()
    for res in (
        rec.get(f"{INTERVIEWS}/{ghost}"), rec.get(f"{INTERVIEWS}/{ghost}/history"), rec.patch(f"{INTERVIEWS}/{ghost}", json={"title": "x"}),
        rec.post(f"{INTERVIEWS}/{ghost}/confirm"), rec.post(f"{INTERVIEWS}/{ghost}/cancel", json={"reason": "x"}),
        rec.post(f"{INTERVIEWS}/{ghost}/reschedule", json=slot(5, 10)), rec.get(f"{INTERVIEWS}/{ghost}/feedback"),
        rec.get(f"/api/v1/applications/{ghost}/interviews"),
    ):
        assert res.status_code == 404 and set(res.json()) == {"detail"}
    for bad in ("not-a-uuid", "123"):
        assert rec.get(f"{INTERVIEWS}/{bad}").status_code == 422


def test_creating_for_someone_elses_or_unknown_application_is_a_404(world):
    _, app, _, interviewer, as_role = world
    rec = as_role(REC)
    body = payload({"id": str(uuid.uuid4())}, [interviewer])
    assert rec.post(INTERVIEWS, json=body).status_code == 404


def test_an_interview_is_only_listed_under_its_own_application(world):
    admin, app, made, interviewer, _ = world
    other = new_application(admin, 2)
    assert admin.get(f"/api/v1/applications/{other['id']}/interviews").json()["total"] == 0
    assert made["id"] in str(admin.get(f"/api/v1/applications/{app['id']}/interviews").json())


def test_recruiters_are_not_limited_by_application_assignment_today(world, client_as):
    """Applications are visible to every recruiter (assignment only limits who may ASSIGN), so
    interviews follow the same rule. This pins the behaviour so a change is deliberate."""
    admin, app, made, interviewer, _ = world
    assigned, unassigned = client_as(REC), client_as(REC)
    assert admin.patch(f"/api/v1/applications/{app['id']}", json={"assigned_recruiter_id": str(assigned.user.id)}).status_code == 200
    for rec in (assigned, unassigned):
        assert rec.get(f"{INTERVIEWS}/{made['id']}").status_code == 200
        assert rec.get(INTERVIEWS).json()["total"] >= 1


def test_the_actor_is_the_session_user_not_a_request_field(world, client_as):
    admin, app, made, interviewer, _ = world
    rec = client_as(REC)
    res = rec.post(INTERVIEWS, json={**payload(new_application(admin, 3), [interviewer], day=16), "created_by_id": str(admin.user.id)})
    assert res.status_code == 422  # unknown field: refused, never silently honoured
    ok = rec.post(INTERVIEWS, json=payload(new_application(admin, 4), [interviewer], day=17))
    assert ok.status_code == 201 and ok.json()["created_by"]["email"] == rec.user.email


def test_feedback_roles(world, client_as):
    admin, app, made, interviewer, _ = world
    hr, rec = client_as(HR), client_as(REC)
    for who in (admin, hr, rec):  # none of them is an interviewer on this interview
        assert who.put(f"{INTERVIEWS}/{made['id']}/feedback", json=feedback_body()).status_code == 403


def test_a_user_who_must_change_their_password_is_blocked(new_client, make_user, world):
    _, _, made, _, _ = world
    c = new_client()
    sign_in(c, make_user(REC, must_change_password=True).email)
    assert c.get(f"{INTERVIEWS}/{made['id']}").status_code == 403
    assert c.get(INTERVIEWS).status_code == 403


def test_a_deactivated_user_loses_access_immediately(world, client_as):
    admin, _, made, _, _ = world
    rec = client_as(REC)
    assert rec.get(f"{INTERVIEWS}/{made['id']}").status_code == 200
    admin.patch(f"/api/v1/users/{rec.user.id}", json={"is_active": False})
    assert rec.get(f"{INTERVIEWS}/{made['id']}").status_code == 401


def test_a_deactivated_interviewer_cannot_be_newly_assigned(world, make_user):
    admin, app, _, _, _ = world
    gone = make_user(REC, is_active=False)
    assert admin.post(INTERVIEWS, json=payload(new_application(admin, 8), [gone], day=18)).status_code == 422
