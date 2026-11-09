"""Authentication: login, lockout, rate limiting, refresh rotation/reuse, logout, CSRF, passwords."""

import logging
import uuid
from datetime import timedelta

import jwt
import pytest
from sqlalchemy import select

from app.core import security
from app.core.config import settings
from app.models.refresh_token import RefreshToken
from app.models.user import UserRole
from tests.conftest import DEFAULT_PASSWORD, sign_in

LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"
ME = "/api/v1/auth/me"
CHANGE_PW = "/api/v1/auth/change-password"
COOKIE = settings.COOKIE_NAME


def login(client, email, password=DEFAULT_PASSWORD, **kw):
    return client.post(LOGIN, json={"email": email, "password": password}, **kw)


def cookie_header(raw: str) -> dict:
    """Present a specific refresh token (an explicit Cookie header beats the client's jar)."""
    return {"Cookie": f"{COOKIE}={raw}"}


# ---------- login ----------


class TestLogin:
    def test_success_returns_access_token_and_user_only(self, anon, make_user):
        user = make_user(UserRole.HR_MANAGER)
        res = login(anon, user.email)
        assert res.status_code == 200
        body = res.json()
        assert body["token_type"] == "bearer"
        assert body["expires_in"] == settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
        assert body["user"]["email"] == user.email
        assert body["user"]["role"] == "hr_manager"
        assert set(body) == {"access_token", "token_type", "expires_in", "user"}
        assert res.headers["cache-control"] == "no-store"

    def test_response_never_contains_hash_or_refresh_token(self, anon, make_user):
        user = make_user()
        res = login(anon, user.email)
        raw_refresh = res.cookies.get(COOKIE)
        assert raw_refresh
        for forbidden in ("password_hash", "$argon2", "refresh", raw_refresh):
            assert forbidden not in res.text
        assert "password" not in res.json()["user"]

    def test_email_is_case_insensitive(self, anon, make_user):
        user = make_user(email="mixed@example.com")
        assert login(anon, "MIXED@Example.COM").status_code == 200
        assert user

    def test_refresh_cookie_flags(self, anon, make_user):
        res = login(anon, make_user().email)
        header = res.headers["set-cookie"].lower()
        assert f"{COOKIE}=" in header
        assert "httponly" in header
        assert "path=/api/v1/auth" in header
        assert "samesite=strict" in header
        assert "max-age=" in header
        assert "secure" not in header.replace("samesite", "")  # dev default: no Secure flag

    def test_cookie_is_secure_in_production_mode(self, anon, make_user, monkeypatch):
        monkeypatch.setattr(settings, "COOKIE_SECURE", True)
        header = login(anon, make_user().email).headers["set-cookie"].lower()
        assert "secure" in header.replace("samesite", "")

    def test_wrong_password_and_unknown_email_look_identical(self, anon, make_user):
        user = make_user()
        wrong = login(anon, user.email, "definitely-not-the-password")
        unknown = login(anon, "nobody@example.com")
        assert wrong.status_code == unknown.status_code == 401
        assert wrong.json() == unknown.json() == {"detail": "Invalid email or password."}
        assert wrong.headers["www-authenticate"] == "Bearer"

    def test_inactive_user_cannot_login_and_is_indistinguishable(self, anon, make_user):
        user = make_user(is_active=False)
        res = login(anon, user.email)
        assert res.status_code == 401
        assert res.json() == {"detail": "Invalid email or password."}

    def test_bad_payloads_rejected_without_echoing_input(self, anon):
        res = anon.post(LOGIN, json={"email": "not-an-email", "password": "hunter2hunter2"})
        assert res.status_code == 422
        assert "hunter2hunter2" not in res.text
        assert all("input" not in e for e in res.json()["detail"])
        assert anon.post(LOGIN, json={"email": "a@b.co"}).status_code == 422
        assert anon.post(LOGIN, json={"email": "a@b.co", "password": "x" * 500}).status_code == 422

    def test_last_login_recorded(self, anon, make_user, session_factory):
        user = make_user()
        login(anon, user.email)
        with session_factory() as db:
            from app.models.user import User

            assert db.get(User, user.id).last_login_at is not None

    def test_refresh_token_stored_only_as_hash(self, anon, make_user, session_factory):
        res = login(anon, make_user().email)
        raw = res.cookies.get(COOKIE)
        with session_factory() as db:
            rows = db.scalars(select(RefreshToken)).all()
        assert len(rows) == 1
        assert rows[0].token_hash == security.hash_token(raw) and raw not in rows[0].token_hash


# ---------- lockout and rate limiting ----------


class TestLockout:
    def _fail(self, client, email, times):
        for _ in range(times):
            assert login(client, email, "wrong-password-xx").status_code == 401

    def test_account_locks_after_max_failures_even_with_correct_password(self, anon, make_user):
        user = make_user()
        self._fail(anon, user.email, settings.LOGIN_MAX_FAILED_ATTEMPTS)
        res = login(anon, user.email)  # correct password, but locked
        assert res.status_code == 429
        assert int(res.headers["retry-after"]) > 0
        assert "Try again" in res.json()["detail"]

    def test_unknown_email_is_throttled_the_same_way(self, anon):
        self._fail(anon, "ghost@example.com", settings.LOGIN_MAX_FAILED_ATTEMPTS)
        res = login(anon, "ghost@example.com")
        assert res.status_code == 429  # no signal about whether the account exists

    def test_lock_expires_after_window(self, anon, make_user, clock):
        user = make_user()
        self._fail(anon, user.email, settings.LOGIN_MAX_FAILED_ATTEMPTS)
        assert login(anon, user.email).status_code == 429
        clock.advance(minutes=settings.LOGIN_LOCKOUT_MINUTES + 1)
        assert login(anon, user.email).status_code == 200

    def test_rejected_attempts_do_not_extend_the_lock(self, anon, make_user, clock):
        user = make_user()
        self._fail(anon, user.email, settings.LOGIN_MAX_FAILED_ATTEMPTS)
        for _ in range(5):
            assert login(anon, user.email, "still-wrong-pw-1").status_code == 429
        clock.advance(minutes=settings.LOGIN_LOCKOUT_MINUTES + 1)
        assert login(anon, user.email).status_code == 200

    def test_success_resets_failure_count(self, anon, make_user):
        user = make_user()
        n = settings.LOGIN_MAX_FAILED_ATTEMPTS - 1
        self._fail(anon, user.email, n)
        assert login(anon, user.email).status_code == 200
        self._fail(anon, user.email, n)  # would lock if the counter had not reset
        assert login(anon, user.email).status_code == 200

    def test_lockout_is_per_account(self, anon, make_user):
        a, b = make_user(), make_user()
        self._fail(anon, a.email, settings.LOGIN_MAX_FAILED_ATTEMPTS)
        assert login(anon, b.email).status_code == 200

    def test_ip_rate_limit_across_many_accounts(self, anon, make_user, monkeypatch):
        monkeypatch.setattr(settings, "LOGIN_IP_MAX_FAILED_ATTEMPTS", 6)
        victim = make_user()
        for i in range(6):  # password spraying: one try per account
            assert login(anon, f"user{i}@example.com", "spray-guess-123").status_code == 401
        res = login(anon, victim.email)
        assert res.status_code == 429 and "retry-after" in res.headers

    def test_old_attempts_are_pruned(self, anon, make_user, clock, session_factory):
        from app.models.login_attempt import LoginAttempt

        user = make_user()
        self._fail(anon, user.email, 2)
        clock.advance(hours=25)
        self._fail(anon, user.email, 1)  # triggers pruning
        with session_factory() as db:
            assert len(db.scalars(select(LoginAttempt)).all()) == 1

    def test_attempts_store_hashed_identifier_not_email(self, anon, make_user, session_factory):
        from app.models.login_attempt import LoginAttempt

        user = make_user(email="private.person@example.com")
        login(anon, user.email, "wrong-password-xx")
        with session_factory() as db:
            row = db.scalars(select(LoginAttempt)).one()
        assert "private" not in row.identifier_hash
        assert row.identifier_hash == security.hash_identifier(user.email)


# ---------- access tokens on protected endpoints ----------


class TestAccessToken:
    def test_me_requires_token(self, anon):
        res = anon.get(ME)
        assert res.status_code == 401
        assert res.headers["www-authenticate"] == "Bearer"

    def test_me_returns_safe_user_view(self, anon, make_user):
        user = make_user(UserRole.RECRUITER)
        sign_in(anon, user.email)
        res = anon.get(ME)
        assert res.status_code == 200
        assert res.json()["email"] == user.email
        assert "password_hash" not in res.text and "$argon2" not in res.text
        assert "password" not in res.json()

    @pytest.mark.parametrize("token", ["garbage", "a.b.c", "", "Bearer"])
    def test_garbage_tokens_rejected(self, anon, token):
        anon.headers["Authorization"] = f"Bearer {token}"
        assert anon.get(ME).status_code == 401

    def test_non_bearer_scheme_rejected(self, anon):
        anon.headers["Authorization"] = "Basic dXNlcjpwYXNz"
        assert anon.get(ME).status_code == 401

    def test_expired_token_rejected(self, anon, make_user):
        user = make_user()
        token, _ = security.create_access_token(user.id, now=security.utcnow() - timedelta(hours=1))
        anon.headers["Authorization"] = f"Bearer {token}"
        assert anon.get(ME).status_code == 401

    def test_token_signed_with_other_key_rejected(self, anon, make_user):
        user = make_user()
        claims = {"sub": str(user.id), "typ": "access", "iat": 1, "exp": 4102444800}
        forged = jwt.encode(claims, "attacker-key-attacker-key-attacker-key", algorithm="HS256")
        anon.headers["Authorization"] = f"Bearer {forged}"
        assert anon.get(ME).status_code == 401

    def test_token_for_unknown_user_rejected(self, anon):
        token, _ = security.create_access_token(uuid.uuid4())
        anon.headers["Authorization"] = f"Bearer {token}"
        assert anon.get(ME).status_code == 401

    def test_must_change_password_blocks_everything_but_password_change(
        self, anon, make_user
    ):
        user = make_user(UserRole.ADMIN, must_change_password=True)
        sign_in(anon, user.email)
        assert anon.get(ME).status_code == 200
        blocked = anon.get("/api/v1/employees")
        assert blocked.status_code == 403 and "change your password" in blocked.json()["detail"]
        new_pw = "a-brand-new-passphrase-9"
        res = anon.post(CHANGE_PW, json={"current_password": DEFAULT_PASSWORD, "new_password": new_pw})
        assert res.status_code == 204
        sign_in(anon, user.email, new_pw)
        assert anon.get("/api/v1/employees").status_code == 200


# ---------- refresh rotation, reuse detection, family revocation ----------


class TestRefresh:
    def test_rotation_issues_new_token_and_new_access_token(self, anon, make_user):
        res = login(anon, make_user().email)
        old = res.cookies.get(COOKIE)
        res2 = anon.post(REFRESH)
        assert res2.status_code == 200
        new = res2.cookies.get(COOKIE)
        assert new and new != old
        assert res2.json()["access_token"]
        assert res2.json()["user"]["email"]
        assert COOKIE not in res2.text and new not in res2.text

    def test_refreshed_access_token_works(self, anon, make_user):
        user = make_user()
        login(anon, user.email)
        token = anon.post(REFRESH).json()["access_token"]
        anon.headers["Authorization"] = f"Bearer {token}"
        assert anon.get(ME).status_code == 200

    def test_refresh_without_cookie_is_401(self, anon):
        res = anon.post(REFRESH)
        assert res.status_code == 401

    def test_unknown_token_is_401_and_clears_cookie(self, anon):
        res = anon.post(REFRESH, headers=cookie_header("x" * 64))
        assert res.status_code == 401
        assert "max-age=0" in res.headers["set-cookie"].lower()

    def test_reuse_of_old_token_revokes_entire_family(self, anon, make_user, caplog):
        user = make_user()
        old = login(anon, user.email).cookies.get(COOKIE)
        newest = anon.post(REFRESH).cookies.get(COOKIE)  # legitimate rotation: old is now used

        with caplog.at_level(logging.WARNING):
            replay = anon.post(REFRESH, headers=cookie_header(old))  # attacker replays old token
        assert replay.status_code == 401
        assert "reuse" in caplog.text.lower()

        # The legitimate holder's newest token is dead too: the whole family was revoked.
        assert anon.post(REFRESH, headers=cookie_header(newest)).status_code == 401

    def test_revoked_family_rows_are_marked(self, anon, make_user, session_factory):
        old = login(anon, make_user().email).cookies.get(COOKIE)
        anon.post(REFRESH)
        anon.post(REFRESH, headers=cookie_header(old))
        with session_factory() as db:
            rows = db.scalars(select(RefreshToken)).all()
        assert len(rows) == 2 and len({r.family_id for r in rows}) == 1
        assert all(r.revoked_at is not None for r in rows)

    def test_reuse_only_revokes_that_session_not_other_logins(self, new_client, make_user):
        user = make_user()
        laptop, phone = new_client(), new_client()
        login(laptop, user.email)
        login(phone, user.email)
        stolen = laptop.cookies.get(COOKIE)
        assert laptop.post(REFRESH).status_code == 200
        assert laptop.post(REFRESH, headers=cookie_header(stolen)).status_code == 401
        assert phone.post(REFRESH).status_code == 200  # other session unaffected

    def test_expired_refresh_token_rejected(self, anon, make_user, clock):
        login(anon, make_user().email)
        clock.advance(days=settings.REFRESH_TOKEN_EXPIRE_DAYS, minutes=1)
        res = anon.post(REFRESH)
        assert res.status_code == 401
        assert "max-age=0" in res.headers["set-cookie"].lower()

    def test_session_has_an_absolute_lifetime(self, anon, make_user, clock):
        login(anon, make_user().email)
        successes = 0
        for _ in range(10):  # keep refreshing just before each token expires
            clock.advance(days=settings.REFRESH_TOKEN_EXPIRE_DAYS - 1)
            if anon.post(REFRESH).status_code != 200:
                break
            successes += 1
        assert 0 < successes < 10
        assert successes * (settings.REFRESH_TOKEN_EXPIRE_DAYS - 1) <= settings.SESSION_MAX_DAYS

    def test_deactivated_user_cannot_refresh(self, new_client, make_user, client_as):
        user = make_user()
        victim = new_client()
        login(victim, user.email)
        admin = client_as(UserRole.ADMIN)
        assert admin.patch(f"/api/v1/users/{user.id}", json={"is_active": False}).status_code == 200
        assert victim.post(REFRESH).status_code == 401

    def test_refresh_token_not_accepted_as_access_token(self, anon, make_user):
        raw = login(anon, make_user().email).cookies.get(COOKIE)
        anon.headers["Authorization"] = f"Bearer {raw}"
        assert anon.get(ME).status_code == 401


# ---------- logout ----------


class TestLogout:
    def test_logout_revokes_session_and_clears_cookie(self, anon, make_user):
        login(anon, make_user().email)
        raw = anon.cookies.get(COOKIE)
        res = anon.post(LOGOUT)
        assert res.status_code == 204
        assert "max-age=0" in res.headers["set-cookie"].lower()
        assert anon.post(REFRESH, headers=cookie_header(raw)).status_code == 401

    def test_logout_without_cookie_is_ok(self, anon):
        assert anon.post(LOGOUT).status_code == 204

    def test_logout_with_garbage_cookie_is_ok(self, anon):
        assert anon.post(LOGOUT, headers=cookie_header("nope")).status_code == 204


# ---------- CSRF protection ----------


class TestCsrf:
    @pytest.mark.parametrize("path", [LOGIN, REFRESH, LOGOUT])
    def test_missing_csrf_header_blocked(self, anon, make_user, path):
        anon.headers.pop("X-Requested-With")
        res = anon.post(path, json={"email": make_user().email, "password": DEFAULT_PASSWORD})
        assert res.status_code == 403
        assert "CSRF" in res.json()["detail"]

    @pytest.mark.parametrize("path", [LOGIN, REFRESH, LOGOUT])
    def test_foreign_origin_blocked(self, anon, make_user, path):
        res = anon.post(
            path,
            json={"email": make_user().email, "password": DEFAULT_PASSWORD},
            headers={"Origin": "https://evil.example"},
        )
        assert res.status_code == 403

    def test_allowed_origin_accepted(self, anon, make_user):
        res = login(anon, make_user().email, headers={"Origin": "http://localhost:5173"})
        assert res.status_code == 200

    def test_wrong_csrf_header_value_blocked(self, anon, make_user):
        anon.headers["X-Requested-With"] = "XMLHttpRequest"
        assert login(anon, make_user().email).status_code == 403

    def test_cross_site_refresh_cannot_succeed_with_valid_cookie(self, anon, make_user):
        login(anon, make_user().email)
        res = anon.post(REFRESH, headers={"Origin": "https://evil.example"})
        assert res.status_code == 403


# ---------- change password ----------


class TestChangePassword:
    NEW = "a-brand-new-passphrase-9"

    def _body(self, current=DEFAULT_PASSWORD, new=NEW):
        return {"current_password": current, "new_password": new}

    def test_success_ends_all_sessions_and_old_token(self, anon, make_user):
        user = make_user()
        login(anon, user.email)
        old_refresh = anon.cookies.get(COOKIE)
        token = sign_in(anon, user.email)
        res = anon.post(CHANGE_PW, json=self._body())
        assert res.status_code == 204
        assert "max-age=0" in res.headers["set-cookie"].lower()

        anon.headers["Authorization"] = f"Bearer {token}"
        assert anon.get(ME).status_code == 401  # access token from before the change is dead
        assert anon.post(REFRESH, headers=cookie_header(old_refresh)).status_code == 401

        anon.headers.pop("Authorization")
        assert login(anon, user.email).status_code == 401  # old password no longer works
        assert login(anon, user.email, self.NEW).status_code == 200

    def test_wrong_current_password(self, anon, make_user):
        user = make_user()
        sign_in(anon, user.email)
        res = anon.post(CHANGE_PW, json=self._body(current="wrong-current-pw"))
        # 422 (not 401): clients treat 401 as "token expired" and would refresh + retry.
        assert res.status_code == 422
        assert res.json() == {"detail": "Current password is incorrect."}
        assert "www-authenticate" not in res.headers

    def test_wrong_current_password_is_rate_limited(self, anon, make_user):
        user = make_user()
        sign_in(anon, user.email)
        for _ in range(settings.LOGIN_MAX_FAILED_ATTEMPTS):
            anon.post(CHANGE_PW, json=self._body(current="wrong-current-pw"))
        res = anon.post(CHANGE_PW, json=self._body())  # even the right one is now refused
        assert res.status_code == 429

    @pytest.mark.parametrize(
        "new",
        ["short1", "a" * 11, "   " * 6, "aaaaaaaaaaaa", "password12345", "x" * 129],
    )
    def test_weak_passwords_rejected_without_echo(self, anon, make_user, new):
        user = make_user()
        sign_in(anon, user.email)
        res = anon.post(CHANGE_PW, json=self._body(new=new))
        assert res.status_code == 422
        assert "input" not in res.text

    def test_same_password_rejected(self, anon, make_user):
        sign_in(anon, make_user().email)
        res = anon.post(CHANGE_PW, json=self._body(new=DEFAULT_PASSWORD))
        assert res.status_code == 422

    def test_password_containing_email_rejected(self, anon, make_user):
        user = make_user(email="jonathan@example.com")
        sign_in(anon, user.email)
        res = anon.post(CHANGE_PW, json=self._body(new="my-jonathan-passphrase-1"))
        assert res.status_code == 422

    def test_requires_authentication(self, anon):
        assert anon.post(CHANGE_PW, json=self._body()).status_code == 401


# ---------- nothing sensitive in logs ----------


def test_no_secrets_in_logs(anon, make_user, caplog):
    user = make_user(email="logcheck.person@example.com")
    with caplog.at_level(logging.DEBUG):
        login(anon, user.email, "wrong-password-xx")  # failure path
        raw = login(anon, user.email).cookies.get(COOKIE)  # success path
        anon.post(REFRESH)
        anon.post(REFRESH, headers=cookie_header(raw))  # reuse path
        sign_in(anon, user.email)
        anon.post(CHANGE_PW, json={"current_password": "bad-current-pw", "new_password": "z" * 20})
    log = caplog.text
    for secret in (DEFAULT_PASSWORD, "wrong-password-xx", raw, "bad-current-pw", user.email):
        assert secret not in log
    assert "$argon2" not in log
