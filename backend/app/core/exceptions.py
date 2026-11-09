"""Domain errors raised by services, and their mapping to HTTP responses.

Services raise these plain exceptions (no FastAPI imports there); `register_exception_handlers`
turns them into consistent JSON errors: {"detail": "..."}.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    status_code = 400

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class NotFoundError(AppError):
    status_code = 404


class ConflictError(AppError):
    status_code = 409


class BusinessRuleError(AppError):
    """Request is well-formed but breaks a business rule (e.g. circular reporting line)."""

    status_code = 422


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
