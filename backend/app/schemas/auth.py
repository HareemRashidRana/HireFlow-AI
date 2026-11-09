from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, model_validator

from app.schemas.user import Password, UserRead


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    # No minimum length here on purpose (don't reveal the policy to attackers), but the maximum
    # stops oversized inputs from being fed to Argon2.
    password: Annotated[SecretStr, Field(min_length=1, max_length=128)]


class TokenResponse(BaseModel):
    """The refresh token is NOT here: it travels only in the HttpOnly cookie."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Access token lifetime in seconds")
    user: UserRead


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: Annotated[SecretStr, Field(min_length=1, max_length=128)]
    new_password: Password

    @model_validator(mode="after")
    def _different(self) -> "ChangePasswordRequest":
        if self.current_password.get_secret_value() == self.new_password.get_secret_value():
            raise ValueError("New password must be different from the current password")
        return self
