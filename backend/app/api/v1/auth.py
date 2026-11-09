from fastapi import APIRouter, Cookie, Depends, Request, Response, status
from fastapi.responses import JSONResponse

from app.api.deps import AuthenticatedUser, DbSession, client_ip, csrf_protect
from app.core.config import settings
from app.core.exceptions import AuthenticationError
from app.schemas.auth import ChangePasswordRequest, LoginRequest, TokenResponse
from app.schemas.user import UserRead
from app.services import auth as service

router = APIRouter(prefix="/auth", tags=["auth"])

# The refresh cookie is only ever sent to the auth endpoints, never to the rest of the API.
COOKIE_PATH = "/api/v1/auth"


def _set_refresh_cookie(response: Response, raw_token: str, max_age: int) -> None:
    response.set_cookie(
        key=settings.COOKIE_NAME,
        value=raw_token,
        max_age=max_age,
        path=COOKIE_PATH,
        httponly=True,  # invisible to JavaScript, so XSS cannot read it
        secure=settings.cookie_secure,
        samesite=settings.COOKIE_SAMESITE,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.COOKIE_NAME,
        path=COOKIE_PATH,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.COOKIE_SAMESITE,
    )


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


def _token_response(result: service.AuthResult) -> TokenResponse:
    return TokenResponse(
        access_token=result.access_token,
        expires_in=result.expires_in,
        user=UserRead.model_validate(result.user),
    )


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(csrf_protect)])
def login(payload: LoginRequest, request: Request, response: Response, db: DbSession):
    result = service.login(
        db, payload.email, payload.password.get_secret_value(), client_ip(request)
    )
    _set_refresh_cookie(response, result.refresh_token, result.refresh_max_age)
    _no_store(response)
    return _token_response(result)


@router.post("/refresh", response_model=TokenResponse, dependencies=[Depends(csrf_protect)])
def refresh(
    response: Response,
    db: DbSession,
    refresh_token: str | None = Cookie(default=None, alias=settings.COOKIE_NAME),
):
    try:
        result = service.refresh(db, refresh_token)
    except AuthenticationError as exc:
        # The cookie is dead (expired, revoked or reused): remove it from the browser.
        failure = JSONResponse(
            status_code=exc.status_code, content={"detail": exc.detail}, headers=exc.headers
        )
        _clear_refresh_cookie(failure)
        _no_store(failure)
        return failure
    _set_refresh_cookie(response, result.refresh_token, result.refresh_max_age)
    _no_store(response)
    return _token_response(result)


@router.post(
    "/logout", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(csrf_protect)]
)
def logout(
    db: DbSession,
    refresh_token: str | None = Cookie(default=None, alias=settings.COOKIE_NAME),
):
    service.logout(db, refresh_token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_refresh_cookie(response)
    return response


@router.get("/me", response_model=UserRead)
def me(user: AuthenticatedUser, response: Response):
    _no_store(response)
    return user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest, request: Request, user: AuthenticatedUser, db: DbSession
):
    service.change_password(
        db,
        user,
        payload.current_password.get_secret_value(),
        payload.new_password.get_secret_value(),
        client_ip(request),
    )
    # All sessions were revoked: the user signs in again with the new password.
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_refresh_cookie(response)
    return response
