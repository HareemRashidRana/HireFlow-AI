"""Domain errors raised by services, and their mapping to HTTP responses.

Services raise these plain exceptions (no FastAPI imports there); `register_exception_handlers`
turns them into consistent JSON errors: {"detail": "..."}.
"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppError(Exception):
    status_code = 400

    def __init__(self, detail: str, headers: dict[str, str] | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.headers = headers


class NotFoundError(AppError):
    status_code = 404


class ConflictError(AppError):
    status_code = 409


class BusinessRuleError(AppError):
    """Request is well-formed but breaks a business rule (e.g. circular reporting line)."""

    status_code = 422


class AuthenticationError(AppError):
    """Missing, invalid or expired credentials."""

    status_code = 401

    def __init__(self, detail: str = "Not authenticated.") -> None:
        super().__init__(detail, headers={"WWW-Authenticate": "Bearer"})


class PermissionDeniedError(AppError):
    """Authenticated, but not allowed to do this."""

    status_code = 403


class TooManyRequestsError(AppError):
    status_code = 429

    def __init__(self, detail: str, retry_after_seconds: int) -> None:
        super().__init__(detail, headers={"Retry-After": str(max(1, retry_after_seconds))})


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code, content={"detail": exc.detail}, headers=exc.headers
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # FastAPI's default response echoes the submitted value in `input`. That would send
        # passwords straight back in 422 bodies, so only location, message and type are returned.
        errors = [
            {
                "loc": list(e.get("loc", ())),
                "msg": str(e.get("msg", "Invalid value")),
                "type": e.get("type", ""),
            }
            for e in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": errors})
