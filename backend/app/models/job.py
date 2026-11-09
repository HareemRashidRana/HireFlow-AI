import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.types import UTCDateTime, string_enum
from app.models.employee import Employee, EmploymentType


class JobStatus(enum.StrEnum):
    DRAFT = "draft"
    OPEN = "open"
    ON_HOLD = "on_hold"
    CLOSED = "closed"


class JobPosting(Base):
    __tablename__ = "job_postings"
    __table_args__ = (
        CheckConstraint("openings >= 1", name="openings_positive"),
        CheckConstraint(
            "salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max",
            name="salary_range_ordered",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(150))
    # Free text for now (same as Employee.department). A Departments module can replace it later.
    department: Mapped[str] = mapped_column(String(100), index=True)
    location: Mapped[str] = mapped_column(String(150))
    employment_type: Mapped[EmploymentType] = mapped_column(
        string_enum(EmploymentType, "job_employment_type")
    )
    description: Mapped[str] = mapped_column(Text, default="")

    # Explicit, job-related criteria. They are what screening scores a resume against later.
    required_skills: Mapped[list[str]] = mapped_column(JSON, default=list)
    nice_to_have_skills: Mapped[list[str]] = mapped_column(JSON, default=list)
    min_experience_years: Mapped[int | None] = mapped_column(Integer)

    # Internal compensation band. Optional; only staff roles can read jobs at all.
    salary_min: Mapped[int | None] = mapped_column(Integer)
    salary_max: Mapped[int | None] = mapped_column(Integer)
    salary_currency: Mapped[str | None] = mapped_column(String(3))

    openings: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[JobStatus] = mapped_column(
        string_enum(JobStatus, "job_status"), default=JobStatus.DRAFT, index=True
    )

    hiring_manager_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), index=True
    )
    hiring_manager: Mapped[Employee | None] = relationship(foreign_keys=[hiring_manager_id])
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    opened_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # first time it was published
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<JobPosting {self.id} {self.title!r} {self.status}>"
