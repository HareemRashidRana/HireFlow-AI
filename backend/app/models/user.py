import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, Enum, ForeignKey, String, Uuid, false, func, true
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import UTCDateTime


class UserRole(enum.StrEnum):
    ADMIN = "admin"
    HR_MANAGER = "hr_manager"
    RECRUITER = "recruiter"
    EMPLOYEE = "employee"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)  # stored lowercase
    password_hash: Mapped[str] = mapped_column(String(255))  # Argon2id; never returned by the API
    role: Mapped[UserRole] = mapped_column(
        Enum(
            UserRole,
            name="user_role",
            native_enum=False,
            create_constraint=True,
            length=20,
            values_callable=lambda e: [m.value for m in e],
        ),
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    # True after an admin creates the account or resets the password: only /auth/me,
    # /auth/change-password and /auth/logout work until the user picks their own password.
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )

    # Which employee record this login belongs to (used for ownership checks).
    employee_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), unique=True
    )

    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # Access tokens issued before this moment are rejected.
    password_changed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:  # never include the hash
        return f"<User {self.id} role={self.role}>"
