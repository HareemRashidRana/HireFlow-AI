"""Who may use the candidates API. Enforced on the server, never only in the UI."""

import uuid

import pytest
from sqlalchemy import select

from app.models.candidate import Candidate
from app.models.user import UserRole
from tests.conftest import employee_payload, sign_in
from tests.test_candidates import CANDIDATES, candidate_payload

A, HR, REC, EMP = UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER, UserRole.EMPLOYEE


@pytest.fixture
def setup(client_as, make_user, new_client):
    admin = client_as(A)
    existing = admin.post(CANDIDATES, json=candidate_payload(1)).json()

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


_n = iter(range(100, 10_000))

# (description, method, path-builder, body-builder, {role: expected status})
MATRIX = [
    ("list candidates", "get", lambda c: CANDIDATES, None, {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("view a candidate", "get", lambda c: f"{CANDIDATES}/{c['id']}", None,
     {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("create a candidate", "post", lambda c: CANDIDATES, lambda: candidate_payload(next(_n)),
     {A: 201, HR: 201, REC: 201, EMP: 403}),
    ("edit a candidate", "patch", lambda c: f"{CANDIDATES}/{c['id']}", lambda: {"location": "Multan"},
     {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("delete a candidate", "delete", lambda c: f"{CANDIDATES}/{c['id']}", None,
     {A: 204, HR: 204, REC: 403, EMP: 403}),
]
CASES = [(m[0], role, m[4][role], m) for m in MATRIX for role in (A, HR, REC, EMP)]


@pytest.mark.parametrize("desc,role,expected,case", CASES, ids=[f"{d}|{r.value}" for d, r, _, _ in CASES])
def test_permission_matrix(setup, desc, role, expected, case):
    _, method, path_for, body_for, _ = case
    _, existing, as_role = setup
    c = as_role(role)
    kwargs = {"json": body_for()} if body_for else {}
    res = getattr(c, method)(path_for(existing), **kwargs)
    assert res.status_code == expected, f"{desc} as {role.value}: {res.status_code} {res.text}"


def test_forbidden_requests_change_nothing(setup):
    admin, existing, as_role = setup
    emp, rec = as_role(EMP), as_role(REC)
    emp.patch(f"{CANDIDATES}/{existing['id']}", json={"location": "Hacked"})
    emp.delete(f"{CANDIDATES}/{existing['id']}")
    rec.delete(f"{CANDIDATES}/{existing['id']}")
    emp.post(CANDIDATES, json=candidate_payload(2))
    after = admin.get(f"{CANDIDATES}/{existing['id']}").json()
    assert after["location"] == existing["location"]
    assert admin.get(CANDIDATES).json()["total"] == 1


def test_forbidden_responses_leak_no_candidate_data(setup):
    _, existing, as_role = setup
    res = as_role(EMP).get(f"{CANDIDATES}/{existing['id']}")
    assert res.status_code == 403
    for secret in (existing["email"], existing["first_name"], existing["phone"]):
        assert secret not in res.text


PROTECTED = [
    ("get", CANDIDATES), ("post", CANDIDATES), ("get", f"{CANDIDATES}/{uuid.uuid4()}"),
    ("patch", f"{CANDIDATES}/{uuid.uuid4()}"), ("delete", f"{CANDIDATES}/{uuid.uuid4()}"),
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
    assert c.get(CANDIDATES).status_code == 403


def test_deactivated_recruiter_loses_access_immediately(setup, client_as):
    admin, _, _ = setup
    rec = client_as(REC)
    assert rec.get(CANDIDATES).status_code == 200
    admin.patch(f"/api/v1/users/{rec.user.id}", json={"is_active": False})
    assert rec.get(CANDIDATES).status_code == 401


def test_role_change_applies_to_existing_tokens_immediately(setup, client_as):
    admin, _, _ = setup
    rec = client_as(REC)
    assert rec.get(CANDIDATES).status_code == 200
    employee = admin.post("/api/v1/employees", json=employee_payload(95)).json()
    admin.patch(f"/api/v1/users/{rec.user.id}", json={"role": "employee", "employee_id": employee["id"]})
    assert rec.get(CANDIDATES).status_code == 403


def test_recruiters_can_see_all_candidates_regardless_of_who_added_them(setup, client_as):
    """Product decision: recruiters see all candidates and applications."""
    admin, existing, _ = setup
    first, second = client_as(REC), client_as(REC)
    mine = first.post(CANDIDATES, json=candidate_payload(7)).json()
    ids = {c["id"] for c in second.get(CANDIDATES).json()["items"]}
    assert {mine["id"], existing["id"]} <= ids
    assert second.get(f"{CANDIDATES}/{mine['id']}").status_code == 200


def test_the_creator_is_recorded(client_as, session_factory):
    rec = client_as(REC)
    created = rec.post(CANDIDATES, json=candidate_payload(8)).json()
    with session_factory() as db:
        row = db.scalar(select(Candidate).where(Candidate.id == uuid.UUID(created["id"])))
        assert row.created_by_id == rec.user.id


def test_employee_endpoints_never_expose_candidates(setup):
    admin, existing, _ = setup
    listing = admin.get("/api/v1/employees").text
    assert existing["email"] not in listing and existing["last_name"] not in listing
    assert admin.get(f"/api/v1/employees/{existing['id']}").status_code == 404
