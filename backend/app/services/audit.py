"""Writing the candidate audit trail.

`record()` only ADDS a row to the caller's session. It never commits, so the audit event and the
business operation it describes are saved together or not at all. If writing the event fails, the
operation fails with it: a sensitive action cannot succeed without its audit record.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.core import security
from app.models.audit import AuditEventType, CandidateAuditEvent
from app.models.user import User

# Metadata may hold ids, field NAMES and small enum-like facts. These keys would mean personal data
# or secrets are about to be logged, so they are refused outright (a programming error, not input).
FORBIDDEN_KEYS = frozenset(
    {
        "email", "name", "first_name", "last_name", "phone", "location", "company", "title",
        "q", "query", "search", "note", "notes", "password", "token", "secret", "resume", "cv",
        "address", "value", "values", "old", "new",
        # resumes: never a file name, file content or parsed data
        "text", "content", "filename", "original_filename", "file_name", "parsed", "parsed_data",
        "reviewed_data", "data",
    }
)
_MAX_TEXT = 100


def _check(value: Any) -> Any:
    if isinstance(value, bool | int | float) or value is None:
        return value
    if isinstance(value, str):
        if len(value) > _MAX_TEXT:
            raise ValueError("Audit metadata text is too long to be a field name or enum value")
        return value
    if isinstance(value, list | tuple):
        return [_check(v) for v in value]
    raise ValueError(f"Unsupported audit metadata type: {type(value).__name__}")


def clean_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, value in (metadata or {}).items():
        if key.lower() in FORBIDDEN_KEYS:
            raise ValueError(f"Audit metadata may not contain '{key}'")
        cleaned[key] = _check(value)
    return cleaned


def record(
    db: Session,
    event_type: AuditEventType,
    *,
    actor: User | None,
    candidate_id: uuid.UUID | None,
    metadata: dict[str, Any] | None = None,
    request_id: str | None = None,
    now: datetime | None = None,
) -> CandidateAuditEvent:
    event = CandidateAuditEvent(
        event_type=event_type,
        candidate_id=candidate_id,
        actor_id=actor.id if actor else None,
        event_metadata=clean_metadata(metadata),
        request_id=request_id,
        created_at=now or security.utcnow(),
    )
    db.add(event)
    return event


def list_events(
    db: Session,
    *,
    candidate_id: uuid.UUID | None = None,
    event_type: AuditEventType | None = None,
    actor_id: uuid.UUID | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[CandidateAuditEvent], int]:
    stmt = select(CandidateAuditEvent)
    if candidate_id:
        stmt = stmt.where(CandidateAuditEvent.candidate_id == candidate_id)
    if event_type:
        stmt = stmt.where(CandidateAuditEvent.event_type == event_type)
    if actor_id:
        stmt = stmt.where(CandidateAuditEvent.actor_id == actor_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(
        stmt.options(joinedload(CandidateAuditEvent.actor))
        .order_by(CandidateAuditEvent.created_at.desc(), CandidateAuditEvent.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(items), total
