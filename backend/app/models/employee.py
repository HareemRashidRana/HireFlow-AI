import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class EmploymentType(enum.StrEnum):
    FULL_TIME = "full_time"
    PART_TIME = "part_time"
    CONTRACT = "contract"
    INTERN = "intern"


class EmploymentStatus(enum.StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    TERMINATED = "terminated"


def _enum_column(enum_cls: type[enum.StrEnum], name: str) -> Enum:
    # Stored as VARCHAR + CHECK constraint (portable and easy to migrate), using lowercase values.
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=20,
        values_callable=lambda e: [m.value for m in e],
    )


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    work_email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone_number: Mapped[str | None] = mapped_column(String(20))
    job_title: Mapped[str] = mapped_column(String(150))
    department: Mapped[str] = mapped_column(String(100), index=True)
    employment_type: Mapped[EmploymentType] = mapped_column(
        _enum_column(EmploymentType, "employment_type")
    )
    employment_status: Mapped[EmploymentStatus] = mapped_column(
        _enum_column(EmploymentStatus, "employment_status"),
        default=EmploymentStatus.ACTIVE,
        index=True,
    )
    date_of_joining: Mapped[date] = mapped_column(Date)

    # Optional self-reference. If a manager is deleted, their reports are kept (manager -> NULL).
    manager_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), index=True
    )
    manager: Mapped["Employee | None"] = relationship(
        remote_side="Employee.id", back_populates="direct_reports"
    )
    direct_reports: Mapped[list["Employee"]] = relationship(back_populates="manager")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<Employee {self.employee_id} {self.work_email}>"
