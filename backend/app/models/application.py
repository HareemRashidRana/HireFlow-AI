import enum
import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint, Uuid, event, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.types import UTCDateTime, string_enum
from app.models.candidate import Candidate, CandidateSource
from app.models.job import JobPosting
from app.models.user import User


class ApplicationStage(enum.StrEnum):
    APPLIED = "applied"
    SCREENING = "screening"
    SHORTLISTED = "shortlisted"
    INTERVIEW = "interview"
    OFFER = "offer"
    HIRED = "hired"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"


class ApplicationEventType(enum.StrEnum):
    CREATED = "created"
    STAGE_CHANGED = "stage_changed"
    ASSIGNED = "assigned"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    HIRED = "hired"
    REOPENED = "reopened"
    NOTES_UPDATED = "notes_updated"


class Application(Base):
    """One candidate applying to one job. The record is never deleted: it is the hiring history.

    Both foreign keys are RESTRICT: a candidate or job that has applications cannot be deleted out
    from under them. (Erasing a person is anonymization, handled separately.)
    """

    __tablename__ = "applications"
    __table_args__ = (
        # One application per candidate and job, ever. A rejected or withdrawn application is
        # reopened (by HR), not re-submitted, so the history stays in one place.
        UniqueConstraint("candidate_id", "job_id", name="uq_applications_candidate_id_job_id"),
        Index("ix_applications_job_stage", "job_id", "stage"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("candidates.id", ondelete="RESTRICT"), index=True
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("job_postings.id", ondelete="RESTRICT"), index=True
    )
    stage: Mapped[ApplicationStage] = mapped_column(
        string_enum(ApplicationStage, "application_stage"),
        default=ApplicationStage.APPLIED,
        index=True,
    )
    # How this application arrived. Defaults to the candidate's own source when not given.
    source: Mapped[CandidateSource] = mapped_column(
        string_enum(CandidateSource, "application_source")
    )

    assigned_recruiter_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    internal_notes: Mapped[str | None] = mapped_column(Text)  # staff only; never copied to history

    applied_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)  # never changes
    stage_changed_at: Mapped[datetime] = mapped_column(UTCDateTime)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, server_default=func.now(), onupdate=func.now()
    )

    candidate: Mapped[Candidate] = relationship(foreign_keys=[candidate_id])
    job: Mapped[JobPosting] = relationship(foreign_keys=[job_id])
    assigned_recruiter: Mapped[User | None] = relationship(foreign_keys=[assigned_recruiter_id])
    events: Mapped[list["ApplicationEvent"]] = relationship(
        back_populates="application",
        order_by="ApplicationEvent.created_at, ApplicationEvent.id",
    )

    def __repr__(self) -> str:  # no personal data
        return f"<Application {self.id} {self.stage}>"


class ApplicationEvent(Base):
    """Append-only history of an application. Rows are inserted by the service layer only."""

    __tablename__ = "application_events"
    __table_args__ = (
        Index("ix_application_events_application_created", "application_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applications.id", ondelete="RESTRICT")
    )
    event_type: Mapped[ApplicationEventType] = mapped_column(
        string_enum(ApplicationEventType, "application_event_type")
    )
    from_value: Mapped[str | None] = mapped_column(String(255))
    to_value: Mapped[str | None] = mapped_column(String(255))
    note: Mapped[str | None] = mapped_column(String(500))  # the staff member's explanation
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    application: Mapped[Application] = relationship(back_populates="events")
    actor: Mapped[User | None] = relationship(foreign_keys=[actor_id])


class HistoryIsAppendOnly(Exception):
    pass


@event.listens_for(ApplicationEvent, "before_update")
def _no_update(*_args) -> None:
    raise HistoryIsAppendOnly("Application history cannot be edited")


@event.listens_for(ApplicationEvent, "before_delete")
def _no_delete(*_args) -> None:
    raise HistoryIsAppendOnly("Application history cannot be deleted")
