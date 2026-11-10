"""Requirements Coverage records (R4.1).

An assessment is a permanent record of what the pure engine returned for one application at one
moment: the result, the methodology versions and the exact job requirements it used. It is
IMMUTABLE: application code cannot update or delete it through the ORM. The only thing that may
change an assessment is a deliberate privacy scrub (anonymization or resume deletion), which runs as
a dedicated Core UPDATE that removes resume-derived content and keeps the numbers.

A review is a person's judgement about an assessment. It is append-only and lives in its own table,
so it can never overwrite what the algorithm returned.
"""

import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Numeric,
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
from app.models.user import User


class AssessmentStatus(enum.StrEnum):
    SCORED = "scored"
    UNSCORED = "unscored"


class ReviewJudgement(enum.StrEnum):
    AGREE = "agree"
    DISAGREE = "disagree"
    UNSURE = "unsure"


class AdjustmentReason(enum.StrEnum):
    """Why a person treats a requirement as covered although the resume does not list it."""

    EVIDENCED_ELSEWHERE = "evidenced_elsewhere"
    EQUIVALENT_SKILL = "equivalent_skill"
    RESUME_INCOMPLETE = "resume_incomplete"
    OTHER = "other"


class ScrubReason(enum.StrEnum):
    ANONYMIZED = "anonymized"
    RESUME_DELETED = "resume_deleted"


class AssessmentIsImmutable(Exception):
    pass


class ReviewIsAppendOnly(Exception):
    pass


class ScreeningAssessment(Base):
    __tablename__ = "screening_assessments"
    __table_args__ = (
        UniqueConstraint(
            "application_id", "assessment_number", name="uq_screening_assessments_number"
        ),
        # The same inputs for the same resume review are never assessed twice (idempotency).
        UniqueConstraint(
            "application_id",
            "input_fingerprint",
            "resume_id",
            "resume_reviewed_at",
            name="uq_screening_assessments_identity",
        ),
        CheckConstraint("assessment_number >= 1", name="number_positive"),
        CheckConstraint(
            "total_score IS NULL OR (total_score >= 0 AND total_score <= 100)", name="score_range"
        ),
        CheckConstraint("assessed_weight IN (0, 20, 80, 100)", name="assessed_weight_valid"),
        CheckConstraint(
            "(status = 'scored' AND total_score IS NOT NULL AND assessed_weight > 0) OR "
            "(status = 'unscored' AND total_score IS NULL AND assessed_weight = 0)",
            name="status_matches_score",
        ),
        CheckConstraint(
            "input_fingerprint IS NULL OR length(input_fingerprint) = 64", name="fingerprint_length"
        ),
        Index("ix_screening_assessments_application_created", "application_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), index=True
    )
    assessment_number: Mapped[int] = mapped_column(Integer)

    # Which reviewed resume this was based on. The row may later be deleted (SET NULL); the version
    # number and review time stay so the history still says which review it came from.
    resume_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("resumes.id", ondelete="SET NULL"), index=True
    )
    resume_version_number: Mapped[int | None] = mapped_column(Integer)
    resume_reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    input_fingerprint: Mapped[str | None] = mapped_column(String(64))  # NULL after a privacy scrub
    scoring_version: Mapped[str] = mapped_column(String(32))
    alias_table_version: Mapped[str] = mapped_column(String(32))
    weights: Mapped[dict] = mapped_column(JSON)
    job_snapshot: Mapped[dict] = mapped_column(JSON)  # the job's skill lists as they were used

    status: Mapped[AssessmentStatus] = mapped_column(
        string_enum(AssessmentStatus, "assessment_status", length=10)
    )
    total_score: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    assessed_weight: Mapped[int] = mapped_column(Integer)
    criteria: Mapped[list] = mapped_column(
        JSON
    )  # per-criterion points; evidence removed by a scrub
    experience: Mapped[dict | None] = mapped_column(JSON)  # context only; removed by a scrub
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    explanation: Mapped[str] = mapped_column(Text)
    limitations: Mapped[list] = mapped_column(JSON, default=list)

    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), index=True)

    scrubbed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    scrub_reason: Mapped[ScrubReason | None] = mapped_column(
        string_enum(ScrubReason, "scrub_reason", length=16)
    )

    requested_by: Mapped[User | None] = relationship(foreign_keys=[requested_by_id])
    reviews: Mapped[list["ScreeningReview"]] = relationship(
        back_populates="assessment", order_by="ScreeningReview.created_at", viewonly=True
    )


class ScreeningReview(Base):
    __tablename__ = "screening_reviews"
    __table_args__ = (
        CheckConstraint("note IS NULL OR length(note) <= 1000", name="note_length"),
        CheckConstraint(
            "adjustment_reason IS NULL OR adjustments IS NOT NULL OR scrubbed_at IS NOT NULL",
            name="reason_needs_adjustments",
        ),
        Index("ix_screening_reviews_assessment_created", "assessment_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("screening_assessments.id", ondelete="CASCADE"), index=True
    )
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    judgement: Mapped[ReviewJudgement] = mapped_column(
        string_enum(ReviewJudgement, "review_judgement", length=10)
    )
    adjustments: Mapped[list | None] = mapped_column(JSON)  # requirements treated as covered
    adjustment_reason: Mapped[AdjustmentReason | None] = mapped_column(
        string_enum(AdjustmentReason, "adjustment_reason", length=20)
    )
    note: Mapped[str | None] = mapped_column(String(1000))  # staff only; never copied to audit
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    scrubbed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    assessment: Mapped[ScreeningAssessment] = relationship(back_populates="reviews")
    reviewer: Mapped[User | None] = relationship(foreign_keys=[reviewer_id])


@event.listens_for(ScreeningAssessment, "before_update")
def _assessment_no_update(*_args) -> None:
    raise AssessmentIsImmutable("A screening assessment cannot be edited")


@event.listens_for(ScreeningAssessment, "before_delete")
def _assessment_no_delete(*_args) -> None:
    raise AssessmentIsImmutable("A screening assessment cannot be deleted")


@event.listens_for(ScreeningReview, "before_update")
def _review_no_update(*_args) -> None:
    raise ReviewIsAppendOnly("A screening review cannot be edited")


@event.listens_for(ScreeningReview, "before_delete")
def _review_no_delete(*_args) -> None:
    raise ReviewIsAppendOnly("A screening review cannot be deleted")
