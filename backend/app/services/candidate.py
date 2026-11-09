import calendar
import logging
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import settings
from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.models.candidate import Candidate, CandidateSource
from app.models.user import User
from app.schemas.candidate import (
    CandidateCreate,
    CandidateUpdate,
    RetentionFilter,
    check_basis_note,
)

# Candidate personal data is never written to logs: only ids.
logger = logging.getLogger(__name__)

EXPIRING_WINDOW_DAYS = 30


def _escape_like(term: str) -> str:
    """Make %, _ and \\ in user input match literally instead of acting as wildcards."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def add_months(start: date, months: int) -> date:
    """Calendar-safe month arithmetic: 31 Aug + 6 months = 28/29 Feb, never an error."""
    index = start.month - 1 + months
    year = start.year + index // 12
    month = index % 12 + 1
    return date(year, month, min(start.day, calendar.monthrange(year, month)[1]))


def touch_activity(candidate: Candidate, now: datetime | None = None) -> None:
    """Record meaningful candidate activity and restart the retention clock.

    Meaningful activity (the caller decides): the candidate being added, their consent / basis being
    re-recorded, and later an application being created or moved. Routine edits of contact details
    deliberately do NOT extend retention, so data cannot be kept alive just by touching it up.
    """
    now = now or security.utcnow()
    candidate.last_activity_at = now
    candidate.retain_until = add_months(now.date(), settings.CANDIDATE_RETENTION_MONTHS)


def get_candidate(db: Session, candidate_id: uuid.UUID) -> Candidate:
    candidate = db.get(Candidate, candidate_id, populate_existing=True)
    if candidate is None:
        raise NotFoundError("Candidate not found")
    return candidate


def list_candidates(
    db: Session,
    *,
    q: str | None = None,
    source: CandidateSource | None = None,
    email: str | None = None,
    retention: RetentionFilter | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Candidate], int]:
    stmt = select(Candidate).where(Candidate.anonymized_at.is_(None))  # erased people never listed

    if q and q.strip():
        pattern = f"%{_escape_like(q.strip())}%"
        full_name = Candidate.first_name + " " + Candidate.last_name
        stmt = stmt.where(
            or_(
                full_name.ilike(pattern, escape="\\"),
                Candidate.email.ilike(pattern, escape="\\"),
                Candidate.current_title.ilike(pattern, escape="\\"),
                Candidate.current_company.ilike(pattern, escape="\\"),
            )
        )
    if source:
        stmt = stmt.where(Candidate.source == source)
    if email and email.strip():
        stmt = stmt.where(func.lower(Candidate.email) == email.strip().lower())

    today = security.utcnow().date()
    if retention == RetentionFilter.EXPIRED:
        stmt = stmt.where(Candidate.retain_until < today)
    elif retention == RetentionFilter.EXPIRING:
        stmt = stmt.where(
            Candidate.retain_until >= today,
            Candidate.retain_until <= today + timedelta(days=EXPIRING_WINDOW_DAYS),
        )

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(
        stmt.order_by(Candidate.created_at.desc(), Candidate.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(items), total


def _email_taken(db: Session, email: str, *, exclude: uuid.UUID | None) -> bool:
    stmt = select(Candidate.id).where(func.lower(Candidate.email) == email.lower())
    if exclude:
        stmt = stmt.where(Candidate.id != exclude)
    return db.scalar(stmt) is not None


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # Only reachable if two requests race past the pre-check.
        raise ConflictError("A candidate with this email already exists") from None


def create_candidate(db: Session, actor: User, data: CandidateCreate) -> Candidate:
    if _email_taken(db, data.email, exclude=None):
        raise ConflictError("A candidate with this email already exists")

    now = security.utcnow()
    candidate = Candidate(**data.model_dump(), created_by_id=actor.id, created_at=now)
    touch_activity(candidate, now)  # adding the candidate is the first activity
    db.add(candidate)
    _commit(db)
    logger.info("Candidate created id=%s", candidate.id)
    return get_candidate(db, candidate.id)


def update_candidate(db: Session, candidate_id: uuid.UUID, data: CandidateUpdate) -> Candidate:
    candidate = get_candidate(db, candidate_id)
    if candidate.anonymized_at is not None:
        raise ConflictError("This candidate's data was anonymized and can no longer be edited")

    changes = data.model_dump(exclude_unset=True)

    if "email" in changes and _email_taken(db, changes["email"], exclude=candidate.id):
        raise ConflictError("A candidate with this email already exists")

    # The basis and its explanation must agree once the change is applied.
    new_basis = changes.get("consent_basis", candidate.consent_basis)
    if "consent_basis" in changes and "consent_basis_note" not in changes:
        # Moving away from "other" drops the old explanation; moving to it needs a new one.
        new_note = candidate.consent_basis_note if new_basis == candidate.consent_basis else None
    else:
        new_note = changes.get("consent_basis_note", candidate.consent_basis_note)
    try:
        check_basis_note(new_basis, new_note)
    except ValueError as exc:
        raise BusinessRuleError(str(exc)) from None
    if {"consent_basis", "consent_basis_note"} & changes.keys():
        changes["consent_basis_note"] = new_note

    for field, value in changes.items():
        setattr(candidate, field, value)

    # Re-recording the basis or its date means the candidate is being actively dealt with again.
    if {"consent_basis", "consent_date"} & changes.keys():
        touch_activity(candidate)

    _commit(db)
    return get_candidate(db, candidate.id)


def delete_candidate(db: Session, candidate_id: uuid.UUID) -> None:
    """Hard delete, for entries made by mistake. (Erasure of a real person is anonymization.)"""
    candidate = get_candidate(db, candidate_id)
    db.delete(candidate)
    db.commit()
    logger.info("Candidate deleted id=%s", candidate_id)
