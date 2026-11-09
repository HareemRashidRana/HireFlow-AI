"""Admin user management: create, list, update, unlock, password reset, safety rules."""

import uuid

import pytest

from app.models.user import UserRole
from tests.conftest import DEFAULT_PASSWORD, employee_payload, sign_in

USERS = "/api/v1/users"
STRONG = "Str0ng-and-long-enough-pw"


def new_user_body(**overrides) -> dict:
    body = {"email": "new.hire@example.com", "password": STRONG, "role": "recruiter"}
    body.update(overrides)
    return body


class TestCreate:
    def test_admin_creates_user(self, client):
        res = client.post(USERS, json=new_user_body(email="New.Hire@Example.com"))
        assert res.status_code == 201
        body = res.json()
        assert body["email"] == "new.hire@example.com"  # stored lowercase
        assert body["role"] == "recruiter"
        assert body["is_active"] is True
        assert body["must_change_password"] is True  # admin-set passwords are temporary
        assert "password" not in body and "password_hash" not in body
        assert STRONG not in res.text and "$argon2" not in res.text

    def test_created_user_can_sign_in(self, client, anon):
        client.post(USERS, json=new_user_body())
        res = anon.post("/api/v1/auth/login", json={"email": "new.hire@example.com", "password": STRONG})
        assert res.status_code == 200
        assert res.json()["user"]["must_change_password"] is True

    def test_duplicate_email_conflict_case_insensitive(self, client):
        assert client.post(USERS, json=new_user_body()).status_code == 201
        res = client.post(USERS, json=new_user_body(email="NEW.HIRE@example.com"))
        assert res.status_code == 409

    @pytest.mark.parametrize(
        "override",
        [
            {"password": "tiny-pw-ZZ9"},
            {"password": "a" * 12},
            {"password": "new.hire-is-in-this-pw"},
            {"email": "not-an-email"},
            {"role": "superuser"},
            {"password_hash": "$argon2id$injected"},
            {"is_active": False},
        ],
    )
    def test_invalid_input_rejected_without_echoing_secrets(self, client, override):
        res = client.post(USERS, json=new_user_body(**override))
        assert res.status_code == 422
        assert "tiny-pw-ZZ9" not in res.text
        assert all("input" not in e for e in res.json()["detail"])

    def test_employee_role_requires_linked_record(self, client):
        res = client.post(USERS, json=new_user_body(role="employee"))
        assert res.status_code == 422

    def test_link_to_missing_employee_rejected(self, client):
        res = client.post(USERS, json=new_user_body(role="employee", employee_id=str(uuid.uuid4())))
        assert res.status_code == 422

    def test_employee_record_cannot_be_linked_twice(self, client):
        emp = client.post("/api/v1/employees", json=employee_payload(1)).json()
        ok = client.post(USERS, json=new_user_body(role="employee", employee_id=emp["id"]))
        assert ok.status_code == 201
        dup = client.post(
            USERS, json=new_user_body(email="other@example.com", role="employee", employee_id=emp["id"])
        )
        assert dup.status_code == 409


class TestListAndGet:
    def test_list_filter_and_pagination(self, client, make_user):
        for _ in range(3):
            make_user(UserRole.RECRUITER)
        make_user(UserRole.HR_MANAGER, is_active=False)
        everything = client.get(USERS).json()
        assert everything["total"] == 5  # 4 created + the signed-in admin
        assert client.get(USERS, params={"role": "recruiter"}).json()["total"] == 3
        assert client.get(USERS, params={"is_active": False}).json()["total"] == 1
        page = client.get(USERS, params={"page_size": 2, "page": 2}).json()
        assert len(page["items"]) == 2 and page["page"] == 2
        assert client.get(USERS, params={"q": "recruiter"}).json()["total"] == 3
        assert client.get(USERS, params={"q": "%"}).json()["total"] == 0  # wildcards are literal

    def test_list_never_exposes_secrets(self, client, make_user):
        make_user(UserRole.RECRUITER)
        assert "password" not in str(client.get(USERS).json().keys())
        assert "$argon2" not in client.get(USERS).text

    def test_get_one_and_404(self, client, make_user):
        u = make_user(UserRole.RECRUITER)
        assert client.get(f"{USERS}/{u.id}").json()["email"] == u.email
        assert client.get(f"{USERS}/{uuid.uuid4()}").status_code == 404
        assert client.get(f"{USERS}/not-a-uuid").status_code == 422

    @pytest.mark.parametrize("params", [{"page": 0}, {"page_size": 101}, {"role": "boss"}])
    def test_list_rejects_bad_params(self, client, params):
        assert client.get(USERS, params=params).status_code == 422


class TestUpdate:
    def test_change_role(self, client, make_user):
        u = make_user(UserRole.RECRUITER)
        res = client.patch(f"{USERS}/{u.id}", json={"role": "hr_manager"})
        assert res.status_code == 200 and res.json()["role"] == "hr_manager"

    def test_cannot_change_email_or_password_via_patch(self, client, make_user):
        u = make_user(UserRole.RECRUITER)
        assert client.patch(f"{USERS}/{u.id}", json={"email": "x@example.com"}).status_code == 422
        assert client.patch(f"{USERS}/{u.id}", json={"password": STRONG}).status_code == 422

    def test_null_role_rejected(self, client, make_user):
        u = make_user(UserRole.RECRUITER)
        assert client.patch(f"{USERS}/{u.id}", json={"role": None}).status_code == 422

    def test_admin_cannot_demote_or_deactivate_self(self, client):
        me = client.user
        assert client.patch(f"{USERS}/{me.id}", json={"role": "recruiter"}).status_code == 422
        assert client.patch(f"{USERS}/{me.id}", json={"is_active": False}).status_code == 422
        # Re-sending the current values is harmless.
        assert client.patch(f"{USERS}/{me.id}", json={"role": "admin"}).status_code == 200

    def test_moving_to_employee_role_requires_link(self, client, make_user):
        u = make_user(UserRole.RECRUITER)
        assert client.patch(f"{USERS}/{u.id}", json={"role": "employee"}).status_code == 422

    def test_deactivation_kills_active_sessions_immediately(self, client, new_client, make_user):
        u = make_user(UserRole.RECRUITER)
        victim = new_client()
        sign_in(victim, u.email)
        assert victim.get("/api/v1/auth/me").status_code == 200
        assert client.patch(f"{USERS}/{u.id}", json={"is_active": False}).status_code == 200
        assert victim.get("/api/v1/auth/me").status_code == 401  # access token rejected at once
        assert victim.post("/api/v1/auth/refresh").status_code == 401

    def test_reactivated_user_can_sign_in_again(self, client, anon, make_user):
        u = make_user(UserRole.RECRUITER, is_active=False)
        assert anon.post("/api/v1/auth/login", json={"email": u.email, "password": DEFAULT_PASSWORD}).status_code == 401
        client.patch(f"{USERS}/{u.id}", json={"is_active": True})
        assert anon.post("/api/v1/auth/login", json={"email": u.email, "password": DEFAULT_PASSWORD}).status_code == 200

    def test_account_with_deleted_employee_can_still_be_deactivated(self, client, make_user):
        emp = client.post("/api/v1/employees", json=employee_payload(5)).json()
        u = make_user(UserRole.EMPLOYEE, employee_id=uuid.UUID(emp["id"]))
        client.delete(f"/api/v1/employees/{emp['id']}")  # link becomes NULL
        res = client.patch(f"{USERS}/{u.id}", json={"is_active": False})
        assert res.status_code == 200

    def test_unknown_user_404(self, client):
        assert client.patch(f"{USERS}/{uuid.uuid4()}", json={"is_active": False}).status_code == 404


class TestUnlockAndReset:
    def test_admin_can_unlock_a_locked_account(self, client, anon, make_user):
        u = make_user(UserRole.RECRUITER)
        for _ in range(5):
            anon.post("/api/v1/auth/login", json={"email": u.email, "password": "wrong-password-xx"})
        body = {"email": u.email, "password": DEFAULT_PASSWORD}
        assert anon.post("/api/v1/auth/login", json=body).status_code == 429
        assert client.post(f"{USERS}/{u.id}/unlock").status_code == 204
        assert anon.post("/api/v1/auth/login", json=body).status_code == 200

    def test_reset_password_forces_change_and_ends_sessions(self, client, new_client, make_user):
        u = make_user(UserRole.HR_MANAGER)
        victim = new_client()
        sign_in(victim, u.email)
        temp = "Temporary-pass-phrase-7"
        assert client.post(f"{USERS}/{u.id}/reset-password", json={"new_password": temp}).status_code == 204

        assert victim.get("/api/v1/auth/me").status_code == 401  # old access token invalid
        assert victim.post("/api/v1/auth/refresh").status_code == 401  # sessions revoked

        again = new_client()
        res = again.post("/api/v1/auth/login", json={"email": u.email, "password": temp})
        assert res.status_code == 200 and res.json()["user"]["must_change_password"] is True
        again.headers["Authorization"] = f"Bearer {res.json()['access_token']}"
        assert again.get("/api/v1/employees").status_code == 403  # must change password first

    def test_reset_rejects_weak_password(self, client, make_user):
        u = make_user(UserRole.RECRUITER)
        res = client.post(f"{USERS}/{u.id}/reset-password", json={"new_password": "short"})
        assert res.status_code == 422 and "short" not in res.json()["detail"][0].get("input", "")

    def test_unknown_user_404(self, client):
        assert client.post(f"{USERS}/{uuid.uuid4()}/unlock").status_code == 404
        res = client.post(f"{USERS}/{uuid.uuid4()}/reset-password", json={"new_password": STRONG})
        assert res.status_code == 404
