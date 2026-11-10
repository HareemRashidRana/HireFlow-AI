"""Exporting candidate data (HR / admin). Every exported candidate gets an audit event.

What is exported is limited to what a person would need to see or hand over about themselves:
their contact and role details, how they came to us, the legal basis and dates, retention dates and
a list of the jobs they applied to with stage and dates. NOT exported: staff notes, ratings,
account data, tokens, or anything about other people.
"""

import csv
import io
import json
import uuid
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core import security
from app.core.config import settings
from app.core.exceptions import BusinessRuleError
from app.models.application import Application
from app.models.audit import AuditEventType
from app.models.candidate import Candidate, CandidateSource
from app.models.user import User
from app.schemas.candidate import RetentionFilter
from app.services import audit
from app.services.candidate import EXPIRING_WINDOW_DAYS, get_candidate

CSV_COLUMNS = [
    "id", "first_name", "last_name", "email", "phone", "location", "current_title",
    "current_company", "source", "consent_basis", "consent_basis_note", "consent_date",
    "last_activity_at", "retain_until", "anonymized", "created_at", "application_count",
]
_DANGEROUS_START = ("=", "+", "-", "@", "\t", "\r", "\n")


def csv_safe(value: Any) -> str:
    """A cell that a spreadsheet will treat as text, never as a formula.

    Values starting with = + - @ (or a tab / line break) are prefixed with an apostrophe, the
    standard defence against CSV / formula injection.
    """
    if value is None:
        return ""
    text = value.isoformat() if isinstance(value, datetime | date) else str(value)
    if text.startswith(_DANGEROUS_START):
        return "'" + text
    return text


def _candidate_row(c: Candidate, application_count: int) -> dict[str, Any]:
    return {
        "id": str(c.id),
        "first_name": c.first_name,
        "last_name": c.last_name,
        "email": c.email,
        "phone": c.phone,
        "location": c.location,
        "current_title": c.current_title,
        "current_company": c.current_company,
        "source": c.source.value,
        "consent_basis": c.consent_basis.value,
        "consent_basis_note": c.consent_basis_note,
        "consent_date": c.consent_date,
        "last_activity_at": c.last_activity_at,
        "retain_until": c.retain_until,
        "anonymized": c.anonymized_at is not None,
        "created_at": c.created_at,
        "application_count": application_count,
    }


def _to_csv(rows: list[dict[str, Any]]) -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(CSV_COLUMNS)
    for row in rows:
        writer.writerow([csv_safe(row[col]) for col in CSV_COLUMNS])
    return buffer.getvalue().encode("utf-8-sig")  # BOM so Excel reads UTF-8 names correctly


def _json_default(value: Any) -> str:
    if isinstance(value, datetime | date):
        return value.isoformat()
    raise TypeError(f"Cannot serialise {type(value).__name__}")


def _applications_for(db: Session, candidate_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[dict]]:
    out: dict[uuid.UUID, list[dict]] = {cid: [] for cid in candidate_ids}
    if not candidate_ids:
        return out
    stmt = (
        select(Application)
        .where(Application.candidate_id.in_(candidate_ids))
        .options(joinedload(Application.job))
        .order_by(Application.applied_at)
    )
    for a in db.scalars(stmt).unique():
        out[a.candidate_id].append(
            {
                "job_title": a.job.title,
                "stage": a.stage.value,
                "source": a.source.value,
                "applied_at": a.applied_at,
                "stage_changed_at": a.stage_changed_at,
            }
        )
    return out


def _finish(
    db: Session,
    actor: User,
    candidates: list[Candidate],
    fmt: str,
    scope: str,
    request_id: str | None,
) -> tuple[bytes, str, str]:
    """Build the file, then log one audit event per candidate in the same transaction."""
    apps = _applications_for(db, [c.id for c in candidates])
    rows = [_candidate_row(c, len(apps[c.id])) for c in candidates]
    now = security.utcnow()
    if fmt == "json":
        payload = [{**r, "applications": apps[c.id]} for r, c in zip(rows, candidates, strict=True)]
        body = json.dumps(
            {"exported_at": now, "candidates": payload}, default=_json_default, indent=2
        ).encode("utf-8")
        content_type, ext = "application/json", "json"
    else:
        body, content_type, ext = _to_csv(rows), "text/csv; charset=utf-8", "csv"
    for c in candidates:
        audit.record(
            db,
            AuditEventType.CANDIDATE_EXPORTED,
            actor=actor,
            candidate_id=c.id,
            metadata={"format": fmt, "scope": scope},
            request_id=request_id,
            now=now,
        )
    db.commit()  # if the audit rows cannot be saved, nothing is returned
    # The filename never contains a person's name.
    return body, content_type, f"candidates-{now.date().isoformat()}.{ext}"


def export_one(
    db: Session, actor: User, candidate_id: uuid.UUID, fmt: str, request_id: str | None = None
) -> tuple[bytes, str, str]:
    candidate = get_candidate(db, candidate_id)
    return _finish(db, actor, [candidate], fmt, "single", request_id)


def export_many(
    db: Session,
    actor: User,
    fmt: str,
    *,
    source: CandidateSource | None = None,
    retention: RetentionFilter | None = None,
    request_id: str | None = None,
) -> tuple[bytes, str, str]:
    """Bulk export of current (not anonymized) candidates, refused if it would be too large."""
    today = security.utcnow().date()
    stmt = select(Candidate).where(Candidate.anonymized_at.is_(None))
    if source:
        stmt = stmt.where(Candidate.source == source)
    if retention == RetentionFilter.EXPIRED:
        stmt = stmt.where(Candidate.retain_until < today)
    elif retention == RetentionFilter.EXPIRING:
        stmt = stmt.where(
            Candidate.retain_until >= today,
            Candidate.retain_until <= today + timedelta(days=EXPIRING_WINDOW_DAYS),
        )
    # One more than the limit tells us it is too big without loading everything.
    found = list(
        db.scalars(
            stmt.order_by(Candidate.created_at, Candidate.id).limit(settings.EXPORT_MAX_ROWS + 1)
        )
    )
    if len(found) > settings.EXPORT_MAX_ROWS:
        raise BusinessRuleError(
            f"This export would contain more than {settings.EXPORT_MAX_ROWS} candidates. "
            "Narrow it with the filters and export in parts."
        )
    return _finish(db, actor, found, fmt, "bulk", request_id)
