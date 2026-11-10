import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Index, String, Uuid, event, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.types import UTCDateTime, string_enum
from app.models.user import User


class AuditEventType(enum.StrEnum):
    CANDIDATE_VIEWED = "candidate_viewed"
    CANDIDATE_CREATED = "candidate_created"
    CANDIDATE_UPDATED = "candidate_updated"
    CONSENT_CHANGED = "consent_changed"
    CANDIDATE_EXPORTED = "candidate_exported"
    CANDIDATE_ANONYMIZED = "candidate_anonymized"
    CANDIDATE_DELETED = "candidate_deleted"  # a mistaken entry removed by hand
    CANDIDATE_PURGED = "candidate_purged"  # removed by a retention purge
    RESUME_UPLOADED = "resume_uploaded"
    RESUME_DOWNLOADED = "resume_downloaded"
    RESUME_VIEWED = "resume_viewed"  # parsed data opened
    RESUME_PARSED = "resume_parsed"
    RESUME_PARSE_RETRIED = "resume_parse_retried"
    RESUME_REVIEWED = "resume_reviewed"
    RESUME_ACTIVATED = "resume_activated"
    RESUME_UPDATED = "resume_updated"  # linked to / unlinked from an application
    RESUME_DELETED = "resume_deleted"
    SCREENING_CREATED = "screening_created"
    SCREENING_VIEWED = "screening_viewed"
    SCREENING_REVIEWED = "screening_reviewed"
    SCREENING_SCRUBBED = "screening_scrubbed"  # resume-derived content removed (counts only)


class CandidateAuditEvent(Base):
    """Who did something sensitive to a candidate's data, and when. Append-only.

    It deliberately holds NO personal data: only ids, an event type, field NAMES (never values) and
    a few enum-like facts. `candidate_id` is a plain column, not a foreign key, so the trail
    survives the deletion of the candidate it is about.
    """

    __tablename__ = "candidate_audit_events"
    __table_args__ = (
        Index("ix_candidate_audit_events_candidate_created", "candidate_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    event_type: Mapped[AuditEventType] = mapped_column(
        string_enum(AuditEventType, "audit_event_type", length=24), index=True
    )
    candidate_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)  # intentionally no FK
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    event_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    request_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), index=True)

    actor: Mapped[User | None] = relationship(foreign_keys=[actor_id])


class AuditIsAppendOnly(Exception):
    pass


@event.listens_for(CandidateAuditEvent, "before_update")
def _no_update(*_args) -> None:
    raise AuditIsAppendOnly("Audit records cannot be edited")


@event.listens_for(CandidateAuditEvent, "before_delete")
def _no_delete(*_args) -> None:
    raise AuditIsAppendOnly("Audit records cannot be deleted")
