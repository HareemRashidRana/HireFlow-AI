"""Sign-in, token rotation and session revocation.

Security model
- Access token: short-lived JWT, held in browser memory by the frontend.
- Refresh token: opaque random string in an HttpOnly cookie. Only its hash is stored.
  * Rotation: every refresh consumes the token and issues a new one in the same family.
  * Reuse detection: presenting a consumed/revoked token revokes the entire family.
  * Absolute lifetime: a login session can never outlive SESSION_MAX_DAYS.
- Lockout / rate limiting: failed attempts are stored in the database per hashed email and per IP.
  Unknown emails are throttled exactly like real ones, so responses never reveal which accounts
  exist.
"""

import logging
import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from pydantic import SecretStr
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import settings
from app.core.exceptions import AuthenticationError, BusinessRuleError, TooManyRequestsError
from app.models.login_attempt import LoginAttempt
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.schemas.user import password_contains_email

logger = logging.getLogger(__name__)

GENERIC_LOGIN_ERROR = "Invalid email or password."
SESSION_ENDED = "Your session has ended. Please sign in again."
ATTEMPT_RETENTION = timedelta(hours=24)


@dataclass
class AuthResult:
    user: User
    access_token: str
    expires_in: int
    refresh_token: str  # raw value: goes into the cookie only, never into a response body
    refresh_max_age: int  # seconds


# ---------- failed-login tracking, lockout, rate limiting ----------


def _record_attempt(db: Session, ident: str, ip: str, succeeded: bool, now: datetime) -> None:
    db.add(LoginAttempt(identifier_hash=ident, ip_address=ip, succeeded=succeeded, created_at=now))


def _check_throttle(db: Session, ident: str, ip: str, now: datetime) -> None:
    """Raise 429 if this account or this IP has too many recent failures."""
    window = timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)
    checks = (
        (LoginAttempt.identifier_hash, ident, settings.LOGIN_MAX_FAILED_ATTEMPTS),
        (LoginAttempt.ip_address, ip, settings.LOGIN_IP_MAX_FAILED_ATTEMPTS),
    )
    for column, value, limit in checks:
        count, latest = db.execute(
            select(func.count(), func.max(LoginAttempt.created_at)).where(
                column == value,
                LoginAttempt.succeeded.is_(False),
                LoginAttempt.created_at > now - window,
            )
        ).one()
        if count >= limit and latest is not None:
            # Rejected attempts are not recorded, so an attacker cannot extend the lock forever.
            wait = math.ceil((latest + window - now).total_seconds())
            minutes = max(1, math.ceil(wait / 60))
            raise TooManyRequestsError(
                f"Too many failed attempts. Try again in {minutes} minute(s).", wait
            )


def _prune_old_attempts(db: Session, now: datetime) -> None:
    db.execute(delete(LoginAttempt).where(LoginAttempt.created_at < now - ATTEMPT_RETENTION))


def clear_failed_attempts(db: Session, email: str) -> None:
    db.execute(
        delete(LoginAttempt).where(
            LoginAttempt.identifier_hash == security.hash_identifier(email),
            LoginAttempt.succeeded.is_(False),
        )
    )


# ---------- refresh tokens ----------


def _issue_refresh_token(
    db: Session, user: User, family_id: uuid.UUID, session_expires_at: datetime, now: datetime
) -> tuple[str, int]:
    raw = security.generate_refresh_token()
    expires_at = min(now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS), session_expires_at)
    db.add(
        RefreshToken(
            user_id=user.id,
            family_id=family_id,
            token_hash=security.hash_token(raw),
            created_at=now,
            expires_at=expires_at,
            session_expires_at=session_expires_at,
        )
    )
    return raw, max(1, int((expires_at - now).total_seconds()))


def _revoke_family(db: Session, family_id: uuid.UUID, now: datetime) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )


def revoke_all_sessions(db: Session, user_id: uuid.UUID) -> None:
    """Sign a user out everywhere. The caller commits."""
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=security.utcnow())
    )


def _build_result(
    user: User, refresh_raw: str, refresh_max_age: int, now: datetime
) -> AuthResult:
    access, expires_in = security.create_access_token(user.id, now=now)
    return AuthResult(user, access, expires_in, refresh_raw, refresh_max_age)


# ---------- public operations ----------


def login(db: Session, email: str, password: str, ip: str) -> AuthResult:
    now = security.utcnow()
    email = email.strip().lower()
    ident = security.hash_identifier(email)

    _check_throttle(db, ident, ip, now)

    user = db.scalar(select(User).where(User.email == email))
    valid, upgraded_hash = False, None
    if user is not None:
        valid, upgraded_hash = security.verify_password(password, user.password_hash)
    else:
        security.burn_password_check(password)  # same cost whether or not the account exists

    # Wrong password, unknown email and disabled account all look identical to the caller.
    if user is None or not valid or not user.is_active:
        _record_attempt(db, ident, ip, False, now)
        _prune_old_attempts(db, now)
        db.commit()
        logger.warning("Failed sign-in (known_account=%s)", user is not None)
        raise AuthenticationError(GENERIC_LOGIN_ERROR)

    if upgraded_hash:
        user.password_hash = upgraded_hash
    clear_failed_attempts(db, email)
    _record_attempt(db, ident, ip, True, now)
    user.last_login_at = now

    session_expires = now + timedelta(days=settings.SESSION_MAX_DAYS)
    raw, max_age = _issue_refresh_token(db, user, uuid.uuid4(), session_expires, now)
    db.commit()
    logger.info("Sign-in succeeded user_id=%s", user.id)
    return _build_result(user, raw, max_age, now)


def refresh(db: Session, raw_token: str | None) -> AuthResult:
    now = security.utcnow()
    if not raw_token:
        raise AuthenticationError(SESSION_ENDED)

    # Row lock (PostgreSQL) so two simultaneous requests cannot both consume the same token.
    row = db.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == security.hash_token(raw_token))
        .with_for_update()
    )
    if row is None:
        raise AuthenticationError(SESSION_ENDED)

    if row.used_at is not None or row.revoked_at is not None:
        # Reuse detected: assume the token was copied. Kill every token of this session.
        _revoke_family(db, row.family_id, now)
        db.commit()
        logger.warning(
            "Refresh token reuse detected; family revoked user_id=%s family_id=%s",
            row.user_id,
            row.family_id,
        )
        raise AuthenticationError(SESSION_ENDED)

    user = db.get(User, row.user_id)
    if row.expires_at <= now or user is None or not user.is_active:
        _revoke_family(db, row.family_id, now)
        db.commit()
        raise AuthenticationError(SESSION_ENDED)

    row.used_at = now  # consume: this token can never be used again
    new_raw, max_age = _issue_refresh_token(db, user, row.family_id, row.session_expires_at, now)
    db.commit()
    return _build_result(user, new_raw, max_age, now)


def logout(db: Session, raw_token: str | None) -> None:
    """Revoke the whole session (token family). Safe to call with a missing/unknown token."""
    if not raw_token:
        return
    row = db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == security.hash_token(raw_token))
    )
    if row is not None:
        _revoke_family(db, row.family_id, security.utcnow())
        db.commit()


def change_password(
    db: Session, user: User, current_password: str, new_password: str, ip: str
) -> None:
    """Verify the current password (with the same lockout), set the new one, sign out everywhere."""
    now = security.utcnow()
    ident = security.hash_identifier(user.email)
    _check_throttle(db, ident, ip, now)

    valid, _ = security.verify_password(current_password, user.password_hash)
    if not valid:
        # A stolen access token must not become an unlimited password-guessing oracle.
        _record_attempt(db, ident, ip, False, now)
        db.commit()
        # 422, not 401: a 401 means "your access token is missing/expired", and clients react to
        # it by refreshing and retrying, which would double-count this failed attempt.
        raise BusinessRuleError("Current password is incorrect.")

    if password_contains_email(SecretStr(new_password), user.email):
        raise BusinessRuleError("Password must not contain the email address")

    user.password_hash = security.hash_password(new_password)
    user.password_changed_at = now
    user.must_change_password = False
    clear_failed_attempts(db, user.email)
    revoke_all_sessions(db, user.id)
    db.commit()
    logger.info("Password changed user_id=%s", user.id)
