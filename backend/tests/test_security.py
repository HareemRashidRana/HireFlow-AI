"""Unit tests for password hashing, JWTs, refresh-token helpers and security configuration."""

import uuid
from datetime import timedelta

import jwt
import pytest
from pydantic import ValidationError

from app.core import security
from app.core.config import Settings
from app.core.config import settings as app_settings


class TestPasswords:
    def test_hash_is_argon2_and_not_plaintext(self):
        h = security.hash_password("a-long-passphrase-123")
        assert h.startswith("$argon2")
        assert "a-long-passphrase-123" not in h

    def test_same_password_gets_different_salted_hashes(self):
        assert security.hash_password("a-long-passphrase-123") != security.hash_password(
            "a-long-passphrase-123"
        )

    def test_verify(self):
        h = security.hash_password("a-long-passphrase-123")
        assert security.verify_password("a-long-passphrase-123", h)[0] is True
        assert security.verify_password("wrong", h)[0] is False

    def test_verify_garbage_hash_is_false_not_error(self):
        assert security.verify_password("x", "not-a-hash") == (False, None)


class TestAccessTokens:
    def test_roundtrip_has_no_role_or_email(self):
        uid = uuid.uuid4()
        token, lifetime = security.create_access_token(uid)
        payload = security.decode_access_token(token)
        assert payload["sub"] == str(uid)
        assert payload["typ"] == "access"
        assert lifetime == app_settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
        assert not {"role", "email", "password"} & payload.keys()

    def test_expired_token_rejected(self):
        past = security.utcnow() - timedelta(hours=1)
        token, _ = security.create_access_token(uuid.uuid4(), now=past)
        with pytest.raises(jwt.InvalidTokenError):
            security.decode_access_token(token)

    def test_wrong_signature_rejected(self):
        claims = {"sub": str(uuid.uuid4()), "typ": "access", "iat": 1, "exp": 4102444800}
        forged = jwt.encode(claims, "some-other-secret-key-0123456789abcdef", algorithm="HS256")
        with pytest.raises(jwt.InvalidTokenError):
            security.decode_access_token(forged)

    def test_alg_none_rejected(self):
        claims = {"sub": str(uuid.uuid4()), "typ": "access", "iat": 1, "exp": 4102444800}
        unsigned = jwt.encode(claims, key=None, algorithm="none")
        with pytest.raises(jwt.InvalidTokenError):
            security.decode_access_token(unsigned)

    def test_wrong_type_rejected(self):
        claims = {"sub": str(uuid.uuid4()), "typ": "refresh", "iat": 1, "exp": 4102444800}
        token = jwt.encode(claims, app_settings.SECRET_KEY, algorithm="HS256")
        with pytest.raises(jwt.InvalidTokenError):
            security.decode_access_token(token)

    def test_missing_claims_rejected(self):
        token = jwt.encode({"sub": "x"}, app_settings.SECRET_KEY, algorithm="HS256")
        with pytest.raises(jwt.InvalidTokenError):
            security.decode_access_token(token)


class TestRefreshTokens:
    def test_tokens_are_random_and_long(self):
        a, b = security.generate_refresh_token(), security.generate_refresh_token()
        assert a != b and len(a) >= 60

    def test_hash_is_stable_and_hides_token(self):
        raw = security.generate_refresh_token()
        assert security.hash_token(raw) == security.hash_token(raw)
        assert raw not in security.hash_token(raw)
        assert len(security.hash_token(raw)) == 64

    def test_identifier_hash_normalises_email(self):
        assert security.hash_identifier(" A@B.com ") == security.hash_identifier("a@b.com")


class TestSettings:
    def test_production_rejects_short_secret(self):
        with pytest.raises(ValidationError):
            Settings(APP_ENV="production", SECRET_KEY="short", _env_file=None)

    def test_production_rejects_missing_secret(self):
        with pytest.raises(ValidationError):
            Settings(APP_ENV="production", SECRET_KEY="", _env_file=None)

    def test_production_accepts_strong_secret_and_secures_cookie(self):
        s = Settings(
            APP_ENV="production", SECRET_KEY="x" * 40, COOKIE_SECURE=None, _env_file=None
        )
        assert s.cookie_secure is True

    def test_development_cookie_not_secure_by_default(self):
        s = Settings(APP_ENV="development", COOKIE_SECURE=None, _env_file=None)
        assert s.cookie_secure is False

    def test_samesite_none_requires_secure(self):
        with pytest.raises(ValidationError):
            Settings(
                APP_ENV="development", COOKIE_SAMESITE="none", COOKIE_SECURE=False, _env_file=None
            )
