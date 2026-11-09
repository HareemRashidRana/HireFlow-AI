import uuid
from datetime import datetime
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    SecretStr,
    field_validator,
    model_validator,
)

from app.models.user import UserRole

PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 128  # also bounds the work Argon2 can be made to do

# A tiny blocklist of the most obvious choices. Length is the main defence.
_COMMON_PASSWORDS = {
    "password1234",
    "password12345",
    "123456789012",
    "qwertyuiop12",
    "letmein12345",
    "administrator",
    "welcome12345",
    "changeme1234",
}


def _check_password_policy(value: SecretStr) -> SecretStr:
    raw = value.get_secret_value()
    if len(raw) < PASSWORD_MIN_LENGTH:
        raise ValueError(f"Password must be at least {PASSWORD_MIN_LENGTH} characters long")
    if len(raw) > PASSWORD_MAX_LENGTH:
        raise ValueError(f"Password must be at most {PASSWORD_MAX_LENGTH} characters long")
    if not raw.strip():
        raise ValueError("Password cannot be only whitespace")
    if len(set(raw)) < 4:
        raise ValueError("Password is too repetitive")
    if raw.lower() in _COMMON_PASSWORDS:
        raise ValueError("Password is too common")
    return value


# SecretStr: masked in repr/logs/tracebacks; .get_secret_value() is only called where hashing.
Password = Annotated[SecretStr, AfterValidator(_check_password_policy)]


def password_contains_email(password: SecretStr, email: str) -> bool:
    local = email.split("@")[0].lower()
    return len(local) >= 4 and local in password.get_secret_value().lower()


class UserRead(BaseModel):
    """Safe public view of a user. There is deliberately no password or token field."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    role: UserRole
    is_active: bool
    must_change_password: bool
    employee_id: uuid.UUID | None
    last_login_at: datetime | None
    created_at: datetime


class UserList(BaseModel):
    items: list[UserRead]
    total: int
    page: int
    page_size: int


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: Password
    role: UserRole
    employee_id: uuid.UUID | None = None
    # Admin-created accounts start with a temporary password the user must replace.
    must_change_password: bool = True

    @field_validator("email")
    @classmethod
    def _lowercase(cls, v: str) -> str:
        return v.lower()

    @model_validator(mode="after")
    def _password_not_email(self) -> "UserCreate":
        if password_contains_email(self.password, self.email):
            raise ValueError("Password must not contain the email address")
        return self


class UserUpdate(BaseModel):
    """PATCH body. Email and password cannot be changed here (use the dedicated endpoints)."""

    model_config = ConfigDict(extra="forbid")

    role: UserRole | None = None
    is_active: bool | None = None
    employee_id: uuid.UUID | None = None  # null unlinks the employee record

    @model_validator(mode="after")
    def _no_null_for_required(self) -> "UserUpdate":
        for name in ("role", "is_active"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class AdminPasswordReset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    new_password: Password
