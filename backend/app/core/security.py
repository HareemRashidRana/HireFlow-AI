"""Password hashing, JWT access tokens and refresh-token helpers.

Nothing in here logs or returns secrets. Refresh tokens are random opaque strings; only their
SHA-256 hash is ever stored, so a database leak cannot be replayed as valid sessions.
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from jwt import InvalidTokenError
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.core.config import settings

# Module-level so tests can swap in a cheaper hasher.
hasher = PasswordHash((Argon2Hasher(),))

# Verified against when the email is unknown, so "no such user" costs the same time as a wrong
# password and cannot be told apart by response timing.
_DUMMY_HASH = hasher.hash(secrets.token_urlsafe(24))

ACCESS_TOKEN_TYPE = "access"


def utcnow() -> datetime:
    return datetime.now(UTC)


# ---------- passwords ----------


def hash_password(password: str) -> str:
    return hasher.hash(password)


def verify_password(password: str, password_hash: str) -> tuple[bool, str | None]:
    """Returns (is_valid, upgraded_hash); upgraded_hash is set when parameters need refreshing."""
    try:
        return hasher.verify_and_update(password, password_hash)
    except Exception:
        return False, None


def burn_password_check(password: str) -> None:
    """Do the same work as a real verification (used for unknown accounts)."""
    try:
        hasher.verify(password, _DUMMY_HASH)
    except Exception:
        pass


# ---------- access tokens (JWT) ----------


def _signing_key() -> str:
    if not settings.SECRET_KEY:
        raise RuntimeError("SECRET_KEY is not configured")
    return settings.SECRET_KEY


def create_access_token(user_id: uuid.UUID, *, now: datetime | None = None) -> tuple[str, int]:
    """Returns (token, lifetime_in_seconds). No role is stored in it: roles come from the DB."""
    now = now or utcnow()
    lifetime = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    claims: dict[str, Any] = {
        "sub": str(user_id),
        "typ": ACCESS_TOKEN_TYPE,
        "jti": uuid.uuid4().hex,
        # Float timestamp: lets us reject tokens issued before a password change (microseconds).
        "iat": now.timestamp(),
        "exp": int((now + lifetime).timestamp()),
    }
    token = jwt.encode(claims, _signing_key(), algorithm=settings.JWT_ALGORITHM)
    return token, int(lifetime.total_seconds())


def decode_access_token(token: str) -> dict[str, Any]:
    """Raises jwt.InvalidTokenError for anything wrong: signature, expiry, type, missing claims."""
    payload = jwt.decode(
        token,
        _signing_key(),
        algorithms=[settings.JWT_ALGORITHM],  # pinned: "alg: none" and algorithm swaps are rejected
        options={"require": ["exp", "iat", "sub", "typ"], "verify_iat": False},
        leeway=5,
    )
    if payload.get("typ") != ACCESS_TOKEN_TYPE:
        raise InvalidTokenError("Wrong token type")
    return payload


# ---------- refresh tokens ----------


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(raw: str) -> str:
    """SHA-256 is appropriate here: the input is 384 bits of randomness, not a human password."""
    return hashlib.sha256(raw.encode()).hexdigest()


def hash_identifier(value: str) -> str:
    """Stable hash of a login identifier (email), so we never store typed-in text verbatim."""
    return hashlib.sha256(value.strip().lower().encode()).hexdigest()
