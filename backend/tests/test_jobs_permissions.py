"""Who may use the jobs API. Roles are enforced on the server, not in the UI."""

import uuid

import pytest

from app.models.user import UserRole
from tests.conftest import sign_in
from tests.test_jobs import JOBS, job_payload

A, HR, REC, EMP = UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER, UserRole.EMPLOYEE


@pytest.fixture
def setup(client_as, make_user, new_client):
    admin = client_as(A)
    draft = admin.post(JOBS, json=job_payload(1)).json()

    def as_role(role: UserRole):
        if role == A:
            return admin
        if role == EMP:
            user = make_user(EMP, employee_id=None)
            c = new_client()
            sign_in(c, user.email)
            return c
        return client_as(role)

    return admin, draft, as_role


# (description, method, path-builder, body-builder, {role: expected status})
MATRIX = [
    ("list jobs", "get", lambda j: JOBS, None, {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("department suggestions", "get", lambda j: f"{JOBS}/departments", None,
     {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("view a job", "get", lambda j: f"{JOBS}/{j['id']}", None, {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("create a job", "post", lambda j: JOBS, lambda: job_payload(50),
     {A: 201, HR: 201, REC: 201, EMP: 403}),
    ("edit a job", "patch", lambda j: f"{JOBS}/{j['id']}", lambda: {"openings": 4},
     {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("change status", "post", lambda j: f"{JOBS}/{j['id']}/status", lambda: {"status": "open"},
     {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("delete a draft", "delete", lambda j: f"{JOBS}/{j['id']}", None,
     {A: 204, HR: 403, REC: 403, EMP: 403}),
]
CASES = [(m[0], role, m[4][role], m) for m in MATRIX for role in (A, HR, REC, EMP)]


@pytest.mark.parametrize("desc,role,expected,case", CASES, ids=[f"{d}|{r.value}" for d, r, _, _ in CASES])
def test_permission_matrix(setup, desc, role, expected, case):
    _, method, path_for, body_for, _ = case
    _, draft, as_role = setup
    c = as_role(role)
    kwargs = {"json": body_for()} if body_for else {}
    res = getattr(c, method)(path_for(draft), **kwargs)
    assert res.status_code == expected, f"{desc} as {role.value}: {res.status_code} {res.text}"


def test_forbidden_requests_change_nothing(setup):
    admin, draft, as_role = setup
    emp, rec = as_role(EMP), as_role(REC)
    emp.patch(f"{JOBS}/{draft['id']}", json={"title": "Hacked title"})
    emp.post(f"{JOBS}/{draft['id']}/status", json={"status": "open"})
    rec.delete(f"{JOBS}/{draft['id']}")
    after = admin.get(f"{JOBS}/{draft['id']}").json()
    assert after["title"] == draft["title"] and after["status"] == "draft"


PROTECTED = [
    ("get", JOBS), ("post", JOBS), ("get", f"{JOBS}/departments"),
    ("get", f"{JOBS}/{uuid.uuid4()}"), ("patch", f"{JOBS}/{uuid.uuid4()}"),
    ("post", f"{JOBS}/{uuid.uuid4()}/status"), ("delete", f"{JOBS}/{uuid.uuid4()}"),
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
    assert c.get(JOBS).status_code == 403


def test_deactivated_recruiter_loses_access_immediately(setup, client_as):
    admin, _, _ = setup
    rec = client_as(REC)
    assert rec.get(JOBS).status_code == 200
    admin.patch(f"/api/v1/users/{rec.user.id}", json={"is_active": False})
    assert rec.get(JOBS).status_code == 401


def test_role_change_applies_to_existing_tokens_immediately(setup, client_as):
    """Roles are read from the database on every request, never from the token."""
    from tests.conftest import employee_payload

    admin, _, _ = setup
    rec = client_as(REC)
    assert rec.get(JOBS).status_code == 200
    employee = admin.post("/api/v1/employees", json=employee_payload(90)).json()
    res = admin.patch(
        f"/api/v1/users/{rec.user.id}", json={"role": "employee", "employee_id": employee["id"]}
    )
    assert res.status_code == 200
    assert rec.get(JOBS).status_code == 403  # same token, new role, no access
    assert rec.post(JOBS, json=job_payload(61)).status_code == 403


def test_created_jobs_record_who_created_them(client_as, session_factory):
    from sqlalchemy import select

    from app.models.job import JobPosting

    rec = client_as(REC)
    job = rec.post(JOBS, json=job_payload(70)).json()
    with session_factory() as db:
        stored = db.scalar(select(JobPosting).where(JobPosting.id == uuid.UUID(job["id"])))
        assert stored.created_by_id == rec.user.id


def test_job_responses_never_include_user_secrets(setup):
    admin, draft, _ = setup
    text = admin.get(JOBS).text + admin.get(f"{JOBS}/{draft['id']}").text
    assert "password" not in text and "$argon2" not in text
