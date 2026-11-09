"""Role-based access control and employee-level ownership, enforced on the server."""

import itertools
import uuid

import pytest

from app.models.user import UserRole
from tests.conftest import employee_payload, sign_in

A, HR, REC, EMP = UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER, UserRole.EMPLOYEE
_counter = itertools.count(100)


@pytest.fixture
def setup(client_as, make_user, new_client):
    """An admin plus a target employee record, and an employee-role user linked to their own record."""
    admin = client_as(A)
    target = admin.post("/api/v1/employees", json=employee_payload(1)).json()
    mine = admin.post("/api/v1/employees", json=employee_payload(2)).json()

    def as_role(role: UserRole):
        if role == A:
            return admin
        if role == EMP:
            user = make_user(EMP, employee_id=uuid.UUID(mine["id"]))
            c = new_client()
            sign_in(c, user.email)
            return c
        return client_as(role)

    return admin, target, mine, as_role


# (description, method, path-builder, body-builder, {role: expected status})
def _create_body():
    n = next(_counter)
    return employee_payload(n)


MATRIX = [
    ("list employees", "get", lambda t, m: "/api/v1/employees", None,
     {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("create employee", "post", lambda t, m: "/api/v1/employees", _create_body,
     {A: 201, HR: 201, REC: 403, EMP: 403}),
    ("view someone else's record", "get", lambda t, m: f"/api/v1/employees/{t['id']}", None,
     {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("update employee", "patch", lambda t, m: f"/api/v1/employees/{t['id']}",
     lambda: {"job_title": "Changed"}, {A: 200, HR: 200, REC: 403, EMP: 403}),
    ("update OWN employee record", "patch", lambda t, m: f"/api/v1/employees/{m['id']}",
     lambda: {"job_title": "Self-promoted"}, {A: 200, HR: 200, REC: 403, EMP: 403}),
    ("delete employee", "delete", lambda t, m: f"/api/v1/employees/{t['id']}", None,
     {A: 204, HR: 403, REC: 403, EMP: 403}),
    ("delete OWN employee record", "delete", lambda t, m: f"/api/v1/employees/{m['id']}", None,
     {A: 204, HR: 403, REC: 403, EMP: 403}),
    ("view OWN record", "get", lambda t, m: f"/api/v1/employees/{m['id']}", None,
     {A: 200, HR: 200, REC: 200, EMP: 200}),
    ("list users", "get", lambda t, m: "/api/v1/users", None,
     {A: 200, HR: 403, REC: 403, EMP: 403}),
    ("create user", "post", lambda t, m: "/api/v1/users",
     lambda: {"email": f"u{next(_counter)}@example.com", "password": "Another-long-pass-12", "role": "recruiter"},
     {A: 201, HR: 403, REC: 403, EMP: 403}),
    ("get user", "get", lambda t, m: f"/api/v1/users/{uuid.uuid4()}", None,
     {A: 404, HR: 403, REC: 403, EMP: 403}),
    ("update user", "patch", lambda t, m: f"/api/v1/users/{uuid.uuid4()}",
     lambda: {"is_active": False}, {A: 404, HR: 403, REC: 403, EMP: 403}),
    ("unlock user", "post", lambda t, m: f"/api/v1/users/{uuid.uuid4()}/unlock", None,
     {A: 404, HR: 403, REC: 403, EMP: 403}),
    ("reset user password", "post", lambda t, m: f"/api/v1/users/{uuid.uuid4()}/reset-password",
     lambda: {"new_password": "Yet-another-long-pass-1"}, {A: 404, HR: 403, REC: 403, EMP: 403}),
]
CASES = [(m[0], role, m[4][role], m) for m in MATRIX for role in (A, HR, REC, EMP)]


@pytest.mark.parametrize(
    "desc,role,expected,case", CASES, ids=[f"{d}|{r.value}" for d, r, _, _ in CASES]
)
def test_permission_matrix(setup, desc, role, expected, case):
    _, method, path_for, body_for, _ = case
    _, target, mine, as_role = setup
    c = as_role(role)
    kwargs = {"json": body_for()} if body_for else {}
    res = getattr(c, method)(path_for(target, mine), **kwargs)
    assert res.status_code == expected, f"{desc} as {role.value}: {res.status_code} {res.text}"


# Every protected endpoint must reject callers who are not signed in.
PROTECTED = [
    ("get", "/api/v1/employees"), ("post", "/api/v1/employees"),
    ("get", "/api/v1/employees/me"), ("get", f"/api/v1/employees/{uuid.uuid4()}"),
    ("patch", f"/api/v1/employees/{uuid.uuid4()}"), ("delete", f"/api/v1/employees/{uuid.uuid4()}"),
    ("get", "/api/v1/users"), ("post", "/api/v1/users"), ("get", f"/api/v1/users/{uuid.uuid4()}"),
    ("patch", f"/api/v1/users/{uuid.uuid4()}"),
    ("post", f"/api/v1/users/{uuid.uuid4()}/unlock"),
    ("post", f"/api/v1/users/{uuid.uuid4()}/reset-password"),
    ("get", "/api/v1/auth/me"), ("post", "/api/v1/auth/change-password"),
]


@pytest.mark.parametrize("method,path", PROTECTED)
def test_anonymous_requests_get_401(anon, method, path):
    res = getattr(anon, method)(path)
    assert res.status_code == 401
    assert res.headers["www-authenticate"] == "Bearer"


def test_health_stays_public(anon):
    assert anon.get("/api/v1/health").status_code == 200


# ---------- ownership ----------


class TestOwnership:
    def test_employee_reads_only_own_record(self, setup):
        _, target, mine, as_role = setup
        me = as_role(EMP)
        assert me.get(f"/api/v1/employees/{mine['id']}").json()["employee_id"] == mine["employee_id"]
        res = me.get(f"/api/v1/employees/{target['id']}")
        assert res.status_code == 403
        assert target["work_email"] not in res.text  # nothing about the other record leaks

    def test_my_record_endpoint(self, setup):
        _, _, mine, as_role = setup
        res = as_role(EMP).get("/api/v1/employees/me")
        assert res.status_code == 200 and res.json()["id"] == mine["id"]

    def test_my_record_404_when_not_linked(self, client_as):
        unlinked = client_as(HR)
        assert unlinked.get("/api/v1/employees/me").status_code == 404

    def test_employee_cannot_list_directory_or_search(self, setup):
        _, _, _, as_role = setup
        me = as_role(EMP)
        assert me.get("/api/v1/employees", params={"q": "person"}).status_code == 403

    def test_unlinked_employee_role_sees_nothing(self, client_as, setup):
        _, target, _, _ = setup
        ghost = client_as(EMP, employee_id=None)
        assert ghost.get(f"/api/v1/employees/{target['id']}").status_code == 403
        assert ghost.get("/api/v1/employees/me").status_code == 404

    def test_ownership_cannot_be_forged_by_a_token_claim(self, setup, make_user, new_client):
        """Role and employee link come from the database; a token carries only the user id."""
        import jwt

        from app.core.config import settings
        from app.core.security import create_access_token

        _, target, _, _ = setup
        user = make_user(EMP, employee_id=None)
        token, _ = create_access_token(user.id)
        claims = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        claims.update({"role": "admin", "employee_id": target["id"]})
        forged = jwt.encode(claims, settings.SECRET_KEY, algorithm="HS256")  # validly signed!
        c = new_client()
        c.headers["Authorization"] = f"Bearer {forged}"
        assert c.get(f"/api/v1/employees/{target['id']}").status_code == 403
        assert c.get("/api/v1/users").status_code == 403

    def test_deleting_an_employee_unlinks_their_login(self, setup):
        admin, _, mine, as_role = setup
        me = as_role(EMP)
        assert admin.delete(f"/api/v1/employees/{mine['id']}").status_code == 204
        assert me.get("/api/v1/employees/me").status_code == 404
        assert me.get(f"/api/v1/employees/{mine['id']}").status_code == 403


class TestRolesComeFromTheDatabase:
    def test_role_change_applies_to_existing_token_immediately(self, client_as, setup):
        admin, _, _, _ = setup
        hr = client_as(HR)
        assert hr.post("/api/v1/employees", json=employee_payload(50)).status_code == 201
        assert admin.patch(f"/api/v1/users/{hr.user.id}", json={"role": "recruiter"}).status_code == 200
        assert hr.post("/api/v1/employees", json=employee_payload(51)).status_code == 403
        assert hr.get("/api/v1/employees").status_code == 200  # recruiters can still read

    def test_employee_validation_rules_still_apply_through_auth(self, client):
        """Existing Employee Management behaviour is unchanged for authorised users."""
        assert client.post("/api/v1/employees", json=employee_payload(1)).status_code == 201
        assert client.post("/api/v1/employees", json=employee_payload(1)).status_code == 409
        bad = client.post("/api/v1/employees", json=employee_payload(2, work_email="nope"))
        assert bad.status_code == 422
