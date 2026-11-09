"""Shared FastAPI dependencies: database session, current user, role checks, CSRF."""

import uuid
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import settings
from app.core.exceptions import AuthenticationError, PermissionDeniedError
from app.db.session import get_db
from app.models.user import User, UserRole

DbSession = Annotated[Session, Depends(get_db)]

_bearer = HTTPBearer(auto_error=False)  # we raise our own 401 with a consistent body

CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "HireFlow"


def client_ip(request: Request) -> str:
    # NOTE: behind a reverse proxy this is the proxy's address unless the server is configured to
    # trust forwarded headers (see limitations in the docs).
    return request.client.host if request.client else "unknown"


def csrf_protect(request: Request) -> None:
    """Guard for endpoints that rely on the refresh cookie (login, refresh, logout).

    Defence in depth on top of SameSite cookies:
      1. A custom header is required. Browsers cannot attach it cross-site without a CORS
         preflight, and our CORS policy only allows our own frontend origin.
      2. If the browser sent an Origin header, it must be an allowed frontend origin.
    """
    if request.headers.get(CSRF_HEADER) != CSRF_VALUE:
        raise PermissionDeniedError("Request blocked (missing CSRF header).")
    origin = request.headers.get("origin")
    if origin is not None and origin not in settings.cors_origins_list:
        raise PermissionDeniedError("Request blocked (origin not allowed).")


def get_authenticated_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: DbSession,
) -> User:
    """Valid access token + active account. Allows users who still must change their password."""
    if credentials is None:
        raise AuthenticationError("Not authenticated.")
    try:
        payload = security.decode_access_token(credentials.credentials)
        user_id = uuid.UUID(payload["sub"])
    except (InvalidTokenError, ValueError, KeyError):
        raise AuthenticationError("Invalid or expired token.") from None

    # The role is always read from the database, never from the token, so role changes,
    # deactivation and password changes take effect immediately.
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise AuthenticationError("Invalid or expired token.")
    changed_at = user.password_changed_at
    if changed_at is not None and payload["iat"] < changed_at.timestamp():
        raise AuthenticationError("Invalid or expired token.")
    return user


def get_current_user(user: Annotated[User, Depends(get_authenticated_user)]) -> User:
    """Like get_authenticated_user, but blocks accounts that must set a new password first."""
    if user.must_change_password:
        raise PermissionDeniedError("You must change your password before continuing.")
    return user


AuthenticatedUser = Annotated[User, Depends(get_authenticated_user)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: UserRole) -> Callable[..., User]:
    """Dependency factory: `Depends(require_roles(UserRole.ADMIN, UserRole.HR_MANAGER))`."""
    allowed = frozenset(roles)

    def checker(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise PermissionDeniedError("You do not have permission to perform this action.")
        return user

    return checker
