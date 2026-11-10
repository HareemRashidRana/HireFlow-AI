"""Interview management (R5).

An interview belongs to ONE application (so it reaches the candidate and the job through it, and no
candidate contact details are copied here). Times are stored as absolute UTC instants plus the IANA
time zone they were scheduled in, so daylight-saving changes can never shift an interview.

History is never rewritten: rescheduling marks the original interview `rescheduled` and creates a
linked new one; every change is also written to an append-only event log. Submitted feedback is only
changed through a controlled edit that keeps a revision of what it said before.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.types import UTCDateTime, string_enum
from app.models.application import Application
from app.models.user import User


class InterviewType(enum.StrEnum):
    PHONE_SCREEN = "phone_screen"
    TECHNICAL = "technical"
    BEHAVIORAL = "behavioral"
    HR_ROUND = "hr_round"
    PANEL = "panel"
    FINAL = "final"
    OTHER = "other"


class InterviewMode(enum.StrEnum):
    ONLINE = "online"
    IN_PERSON = "in_person"
    PHONE = "phone"


class InterviewStatus(enum.StrEnum):
    SCHEDULED = "scheduled"
    CONFIRMED = "confirmed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    RESCHEDULED = "rescheduled"  # replaced by a newer interview (see rescheduled_from_id)


class InterviewEventType(enum.StrEnum):
    CREATED = "created"
    UPDATED = "updated"
    CONFIRMED = "confirmed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    RESCHEDULED = "rescheduled"
    INTERVIEWER_ADDED = "interviewer_added"
    INTERVIEWER_REMOVED = "interviewer_removed"


class FeedbackStatus(enum.StrEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"


# The statuses in which an interview occupies its interviewers' time (used for conflict checks).
OCCUPYING = (InterviewStatus.SCHEDULED, InterviewStatus.CONFIRMED, InterviewStatus.COMPLETED)
OPEN = (InterviewStatus.SCHEDULED, InterviewStatus.CONFIRMED)


class Interview(Base):
    __tablename__ = "interviews"
    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="ends_after_start"),
        CheckConstraint("round_number >= 1", name="round_positive"),
        CheckConstraint(
            "status <> 'cancelled' OR cancellation_reason IS NOT NULL", name="cancel_has_reason"
        ),
        CheckConstraint(
            "meeting_url IS NULL OR substr(meeting_url, 1, 8) = 'https://'",
            name="meeting_url_https",
        ),
        # An interview can be replaced by at most one successor.
        UniqueConstraint("rescheduled_from_id", name="uq_interviews_rescheduled_from"),
        Index("ix_interviews_starts_at", "starts_at"),
        Index("ix_interviews_application_starts", "application_id", "starts_at"),
        Index("ix_interviews_status_starts", "status", "starts_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(150))
    interview_type: Mapped[InterviewType] = mapped_column(
        string_enum(InterviewType, "interview_type", length=16)
    )
    round_number: Mapped[int] = mapped_column(Integer, default=1)
    mode: Mapped[InterviewMode] = mapped_column(
        string_enum(InterviewMode, "interview_mode", length=10)
    )
    status: Mapped[InterviewStatus] = mapped_column(
        string_enum(InterviewStatus, "interview_status", length=12),
        default=InterviewStatus.SCHEDULED,
    )
    starts_at: Mapped[datetime] = mapped_column(UTCDateTime)
    ends_at: Mapped[datetime] = mapped_column(UTCDateTime)
    timezone: Mapped[str] = mapped_column(String(64))  # IANA name, e.g. "Asia/Karachi"
    location: Mapped[str | None] = mapped_column(String(255))
    # A plain https link. Passwords and access tokens are refused, never stored.
    meeting_url: Mapped[str | None] = mapped_column(String(500))

    rescheduled_from_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("interviews.id", ondelete="SET NULL")
    )
    cancellation_reason: Mapped[str | None] = mapped_column(String(500))
    cancelled_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    scrubbed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, server_default=func.now(), onupdate=func.now()
    )

    application: Mapped[Application] = relationship(foreign_keys=[application_id])
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_id])
    updated_by: Mapped[User | None] = relationship(foreign_keys=[updated_by_id])
    interviewers: Mapped[list["InterviewInterviewer"]] = relationship(
        back_populates="interview",
        cascade="all, delete-orphan",
        order_by="InterviewInterviewer.created_at",
    )
    rescheduled_from: Mapped["Interview | None"] = relationship(
        remote_side="Interview.id", foreign_keys=[rescheduled_from_id]
    )


class InterviewInterviewer(Base):
    """Who is on an interview. One row per person, so duplicates are impossible."""

    __tablename__ = "interview_interviewers"
    __table_args__ = (
        UniqueConstraint("interview_id", "user_id", name="uq_interview_interviewers_pair"),
        Index("ix_interview_interviewers_user", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    interview_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("interviews.id", ondelete="CASCADE"))
    # RESTRICT: a person with interview history is deactivated, never deleted out from under it.
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    added_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    interview: Mapped[Interview] = relationship(back_populates="interviewers")
    user: Mapped[User] = relationship(foreign_keys=[user_id])


class InterviewEvent(Base):
    """Append-only scheduling history. It holds times, statuses and counts, never free text."""

    __tablename__ = "interview_events"
    __table_args__ = (Index("ix_interview_events_interview_created", "interview_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    interview_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("interviews.id", ondelete="CASCADE"))
    event_type: Mapped[InterviewEventType] = mapped_column(
        string_enum(InterviewEventType, "interview_event_type", length=20)
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    actor: Mapped[User | None] = relationship(foreign_keys=[actor_id])


class InterviewFeedback(Base):
    __tablename__ = "interview_feedback"
    __table_args__ = (
        UniqueConstraint("interview_id", "interviewer_id", name="uq_interview_feedback_pair"),
        CheckConstraint(
            "(overall_rating IS NULL OR overall_rating BETWEEN 1 AND 5) AND "
            "(technical_rating IS NULL OR technical_rating BETWEEN 1 AND 5) AND "
            "(communication_rating IS NULL OR communication_rating BETWEEN 1 AND 5) AND "
            "(problem_solving_rating IS NULL OR problem_solving_rating BETWEEN 1 AND 5)",
            name="ratings_in_range",
        ),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint(
            "status <> 'submitted' OR (submitted_at IS NOT NULL AND overall_rating IS NOT NULL)",
            name="submitted_is_complete",
        ),
        Index("ix_interview_feedback_interviewer", "interviewer_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    interview_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("interviews.id", ondelete="CASCADE"))
    interviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    status: Mapped[FeedbackStatus] = mapped_column(
        string_enum(FeedbackStatus, "feedback_status", length=10), default=FeedbackStatus.DRAFT
    )
    overall_rating: Mapped[int | None] = mapped_column(Integer)
    technical_rating: Mapped[int | None] = mapped_column(Integer)
    communication_rating: Mapped[int | None] = mapped_column(Integer)
    problem_solving_rating: Mapped[int | None] = mapped_column(Integer)
    overall_feedback: Mapped[str | None] = mapped_column(Text)
    technical_notes: Mapped[str | None] = mapped_column(Text)
    role_notes: Mapped[str | None] = mapped_column(Text)
    strengths: Mapped[str | None] = mapped_column(Text)
    concerns: Mapped[str | None] = mapped_column(Text)  # "areas for further discussion"
    private_notes: Mapped[str | None] = mapped_column(Text)  # author only, ever
    version: Mapped[int] = mapped_column(Integer, default=1)
    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    scrubbed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, server_default=func.now(), onupdate=func.now()
    )

    interview: Mapped[Interview] = relationship(foreign_keys=[interview_id])
    interviewer: Mapped[User | None] = relationship(foreign_keys=[interviewer_id])
    revisions: Mapped[list["InterviewFeedbackRevision"]] = relationship(
        back_populates="feedback", order_by="InterviewFeedbackRevision.version", viewonly=True
    )


class InterviewFeedbackRevision(Base):
    """What a submitted feedback said before an edit. Append-only; never includes private notes."""

    __tablename__ = "interview_feedback_revisions"
    __table_args__ = (
        UniqueConstraint("feedback_id", "version", name="uq_feedback_revisions_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    feedback_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("interview_feedback.id", ondelete="CASCADE")
    )
    version: Mapped[int] = mapped_column(Integer)  # the version this snapshot represents
    snapshot: Mapped[dict] = mapped_column(JSON)
    edit_reason: Mapped[str | None] = mapped_column(String(300))
    edited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    feedback: Mapped[InterviewFeedback] = relationship(back_populates="revisions")
    edited_by: Mapped[User | None] = relationship(foreign_keys=[edited_by_id])


class HistoryIsAppendOnly(Exception):
    pass


for _model in (InterviewEvent, InterviewFeedbackRevision):

    @event.listens_for(_model, "before_update")
    def _no_update(*_args) -> None:
        raise HistoryIsAppendOnly("This history record cannot be edited")

    @event.listens_for(_model, "before_delete")
    def _no_delete(*_args) -> None:
        raise HistoryIsAppendOnly("This history record cannot be deleted")
