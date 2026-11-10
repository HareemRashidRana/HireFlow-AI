from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL

MIN_SECRET_KEY_LENGTH = 32


class Settings(BaseSettings):
    """App configuration, loaded from environment variables / backend/.env."""

    # Absolute path so it loads the same .env no matter which directory the app/scripts run from.
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_NAME: str = "HireFlow AI"
    APP_VERSION: str = "0.1.0"
    APP_ENV: str = "development"
    DEBUG: bool = False
    CORS_ORIGINS: str = "http://localhost:5173"

    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "hireflow"
    POSTGRES_USER: str = "hireflow_user"
    POSTGRES_PASSWORD: str = ""

    # --- Authentication ---
    SECRET_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    # A refresh token lasts this long and is replaced on every use (rotation)...
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    # ...but a whole login session can never be extended beyond this.
    SESSION_MAX_DAYS: int = 30

    # Refresh-token cookie. COOKIE_SECURE=None means "secure unless APP_ENV is development".
    COOKIE_SECURE: bool | None = None
    COOKIE_SAMESITE: Literal["strict", "lax", "none"] = "strict"
    COOKIE_NAME: str = "hireflow_refresh"

    # Failed-login protection (database-backed).
    LOGIN_MAX_FAILED_ATTEMPTS: int = 5  # per account, within the window -> temporary lockout
    LOGIN_IP_MAX_FAILED_ATTEMPTS: int = 30  # per client IP, within the window -> rate limited
    LOGIN_LOCKOUT_MINUTES: int = 15

    # --- Recruitment privacy ---
    # How long candidate data is kept after the candidate's last meaningful activity before it
    # becomes due for review/erasure. Default 12 months; configurable per deployment.
    CANDIDATE_RETENTION_MONTHS: int = Field(default=12, ge=1, le=120)
    # Permanent deletion of expired candidates is OFF unless a deployment turns it on on purpose.
    # (Previewing what a purge would delete always works.) There is no automatic / scheduled purge.
    PRIVACY_PURGE_ENABLED: bool = False
    # One export never contains more candidates than this; larger requests are refused, not cut off.
    EXPORT_MAX_ROWS: int = Field(default=500, ge=1, le=5000)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def database_url(self) -> URL:
        # URL.create escapes special characters in the password safely.
        return URL.create(
            "postgresql+psycopg",
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD,
            host=self.POSTGRES_HOST,
            port=self.POSTGRES_PORT,
            database=self.POSTGRES_DB,
        )

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def is_development(self) -> bool:
        return self.APP_ENV.lower() in {"development", "dev", "local", "test"}

    @property
    def cookie_secure(self) -> bool:
        if self.COOKIE_SECURE is not None:
            return self.COOKIE_SECURE
        return not self.is_development

    @model_validator(mode="after")
    def _validate_security(self) -> "Settings":
        # Refuse to boot a non-development deployment with a weak or missing signing key.
        if not self.is_development and len(self.SECRET_KEY) < MIN_SECRET_KEY_LENGTH:
            raise ValueError(
                f"SECRET_KEY must be at least {MIN_SECRET_KEY_LENGTH} characters "
                "outside development"
            )
        # Browsers reject SameSite=None cookies that are not Secure.
        if self.COOKIE_SAMESITE == "none" and not self.cookie_secure:
            raise ValueError("COOKIE_SAMESITE=none requires secure cookies")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
