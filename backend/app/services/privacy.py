"""Candidate privacy: anonymization, retention review and the (manual, opt-in) purge.

Design rules:
  * A candidate who has applications is NEVER deleted. Their hiring history is kept; if the person
    must go, they are anonymized instead (identifying fields removed, history structure kept).
  * Only candidates past their retention date AND with no applications can be purged.
  * Every change here writes its audit event in the same transaction.
  * Audit events hold no personal data (ids, field names, counts).
"""

import logging
import uuid
from datetime import date, timedelta
from typing import Literal

from sqlalchemy import and_, delete, exists, func, select, update
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import settings
from app.core.exceptions import BusinessRuleError, ConflictError, PermissionDeniedError
from app.models.application import Application, ApplicationEvent
from app.models.audit import AuditEventType
from app.models.candidate import Candidate, ConsentBasis
from app.models.user import User, UserRole
from app.schemas.privacy import RetentionStatus
from app.services import audit, resume_storage, screening_service
from app.services import interview as interview_service
from app.services import resume as resume_service
from app.services.candidate import EXPIRING_WINDOW_DAYS, get_candidate

logger = logging.getLogger(__name__)  # ids and counts only, never personal data

PURGE_CONFIRMATION = "PURGE"
ANON_FIRST_NAME = "Anonymized"
ANON_LAST_NAME = "Candidate"
ANON_NOTE = "Removed on anonymization"  # the DB requires some text when the basis is "other"

# Exactly which candidate fields change. Tested, and shown to the user before they confirm.
FIELDS_CLEARED = ["phone", "location", "current_title", "current_company", "consent_basis_note"]
FIELDS_REPLACED = ["first_name", "last_name", "email"]
FIELDS_KEPT = [
    "source", "consent_basis", "consent_date", "last_activity_at", "retain_until", "created_at",
]


def _today() -> date:
    return security.utcnow().date()


# ---- anonymization ---------------------------------------------------------------------------


def _application_counts(db: Session, candidate_id: uuid.UUID) -> tuple[int, int, int]:
    """(applications, applications with notes, history rows with a note)."""
    apps = db.scalar(select(func.count()).where(Application.candidate_id == candidate_id)) or 0
    app_notes = (
        db.scalar(
            select(func.count()).where(
                Application.candidate_id == candidate_id, Application.internal_notes.is_not(None)
            )
        )
        or 0
    )
    history_notes = (
        db.scalar(
            select(func.count())
            .select_from(ApplicationEvent)
            .join(Application, Application.id == ApplicationEvent.application_id)
            .where(Application.candidate_id == candidate_id, ApplicationEvent.note.is_not(None))
        )
        or 0
    )
    return apps, app_notes, history_notes


def anonymization_preview(db: Session, candidate_id: uuid.UUID) -> dict:
    candidate = get_candidate(db, candidate_id)
    apps, app_notes, history_notes = _application_counts(db, candidate.id)
    return {
        "candidate_id": candidate.id,
        "already_anonymized": candidate.anonymized_at is not None,
        "fields_cleared": FIELDS_CLEARED,
        "fields_replaced": FIELDS_REPLACED,
        "fields_kept": FIELDS_KEPT,
        "application_count": apps,
        "application_notes_cleared": app_notes,
        "history_notes_cleared": history_notes,
        "resumes_removed": resume_service.count_for_candidate(db, candidate.id),
        "assessments_scrubbed": screening_service.count_for_candidate(db, candidate.id),
        "interviews_scrubbed": interview_service.count_for_candidate(db, candidate.id),
    }


def anonymize_candidate(
    db: Session, actor: User, candidate_id: uuid.UUID, request_id: str | None = None
) -> tuple[Candidate, bool]:
    """Remove a person's identifying details, keeping the structure of their hiring history.

    Returns (candidate, changed). Calling it again is harmless: nothing changes, nothing new is
    logged. Application records and the history of stage changes are kept; only free text that
    could identify the person (staff notes) is cleared.
    """
    candidate = get_candidate(db, candidate_id)
    if candidate.anonymized_at is not None:
        return candidate, False

    now = security.utcnow()
    note = ANON_NOTE if candidate.consent_basis == ConsentBasis.OTHER else None
    # The WHERE makes this safe under concurrency: of two simultaneous requests only one matches.
    result = db.execute(
        update(Candidate)
        .where(Candidate.id == candidate.id, Candidate.anonymized_at.is_(None))
        .values(
            first_name=ANON_FIRST_NAME,
            last_name=ANON_LAST_NAME,
            email=f"anonymized-{candidate.id}@anonymized.invalid",
            phone=None,
            location=None,
            current_title=None,
            current_company=None,
            consent_basis_note=note,
            anonymized_at=now,
            updated_at=now,
        )
    )
    if result.rowcount != 1:
        db.rollback()
        return get_candidate(db, candidate_id), False

    apps, app_notes, history_notes = _application_counts(db, candidate.id)
    resumes = resume_service.count_for_candidate(db, candidate.id)
    # A CV is inherently identifying, so anonymizing removes the resume FILES (rows stay as bare
    # tombstones). The files are deleted after the commit below.
    resume_keys = resume_service.tombstone_for_candidate(db, candidate.id)
    # Requirements Coverage evidence, adjustments and reviewer notes are resume-derived: remove
    # them (numbers and versions stay). Records its own safe audit event in this transaction.
    screening_service.scrub_for_candidate(db, actor, candidate.id, request_id)
    interview_service.scrub_for_candidate(db, actor, candidate.id, request_id)
    own_apps = select(Application.id).where(Application.candidate_id == candidate.id)
    # Bulk statements (not ORM objects): the one deliberate exception to "history is append-only",
    # limited to the free-text note columns. Stages, event types, actors and timestamps stay.
    db.execute(
        update(Application)
        .where(Application.candidate_id == candidate.id)
        .values(internal_notes=None)
    )
    db.execute(
        update(ApplicationEvent)
        .where(ApplicationEvent.application_id.in_(own_apps))
        .values(note=None)
    )
    audit.record(
        db,
        AuditEventType.CANDIDATE_ANONYMIZED,
        actor=actor,
        candidate_id=candidate.id,
        metadata={
            "applications": apps,
            "application_notes_cleared": app_notes,
            "history_notes_cleared": history_notes,
            "resumes_removed": resumes,
        },
        request_id=request_id,
        now=now,
    )
    db.commit()
    resume_storage.delete_many(resume_keys)  # after the commit; a failure leaves an orphan
    logger.info("Candidate anonymized id=%s", candidate.id)
    return get_candidate(db, candidate_id), True


# ---- retention -------------------------------------------------------------------------------


def _app_count_expr():
    return (
        select(func.count(Application.id))
        .where(Application.candidate_id == Candidate.id)
        .correlate(Candidate)
        .scalar_subquery()
    )


def _no_applications():
    return ~exists().where(Application.candidate_id == Candidate.id).correlate(Candidate)


def _purge_condition(today: date):
    return and_(Candidate.retain_until < today, _no_applications())


def _status_of(c: Candidate, today: date) -> Literal["active", "expiring", "expired", "anonymized"]:
    if c.anonymized_at is not None:
        return "anonymized"
    if c.retain_until < today:
        return "expired"
    if c.retain_until <= today + timedelta(days=EXPIRING_WINDOW_DAYS):
        return "expiring"
    return "active"


def retention_summary(db: Session) -> dict:
    today = _today()
    window = today + timedelta(days=EXPIRING_WINDOW_DAYS)
    live = Candidate.anonymized_at.is_(None)

    def count(*conds) -> int:
        return db.scalar(select(func.count()).select_from(Candidate).where(*conds)) or 0

    expired = count(live, Candidate.retain_until < today)
    return {
        "expiring": count(live, Candidate.retain_until >= today, Candidate.retain_until <= window),
        "expired": expired,
        "anonymized": count(Candidate.anonymized_at.is_not(None)),
        "purge_eligible": count(_purge_condition(today)),
        "expired_with_applications": count(
            live, Candidate.retain_until < today, ~_no_applications()
        ),
        "retention_months": settings.CANDIDATE_RETENTION_MONTHS,
        "expiring_window_days": EXPIRING_WINDOW_DAYS,
        "purge_enabled": settings.PRIVACY_PURGE_ENABLED,
    }


def list_retention(
    db: Session,
    *,
    status: RetentionStatus = RetentionStatus.ALL,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[dict], int]:
    today = _today()
    window = today + timedelta(days=EXPIRING_WINDOW_DAYS)
    count_col = _app_count_expr().label("application_count")
    stmt = select(Candidate, count_col)
    if status == RetentionStatus.EXPIRED:
        stmt = stmt.where(Candidate.anonymized_at.is_(None), Candidate.retain_until < today)
    elif status == RetentionStatus.EXPIRING:
        stmt = stmt.where(
            Candidate.anonymized_at.is_(None),
            Candidate.retain_until >= today,
            Candidate.retain_until <= window,
        )
    elif status == RetentionStatus.ANONYMIZED:
        stmt = stmt.where(Candidate.anonymized_at.is_not(None))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(Candidate.retain_until, Candidate.id)  # soonest to expire first
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    items = []
    for candidate, apps in rows:
        st = _status_of(candidate, today)
        items.append(
            {
                "id": candidate.id,
                "first_name": candidate.first_name,
                "last_name": candidate.last_name,
                "email": candidate.email,
                "consent_basis": candidate.consent_basis,
                "consent_date": candidate.consent_date,
                "last_activity_at": candidate.last_activity_at,
                "retain_until": candidate.retain_until,
                "anonymized_at": candidate.anonymized_at,
                "application_count": apps,
                "status": st,
                "purge_eligible": candidate.retain_until < today and apps == 0,
            }
        )
    return items, total


# ---- purge -----------------------------------------------------------------------------------


def purge(
    db: Session,
    actor: User,
    *,
    dry_run: bool,
    confirm: str | None,
    limit: int,
    request_id: str | None = None,
) -> dict:
    """Permanently delete expired candidates that hold no hiring history, one bounded batch.

    A dry run changes nothing and is open to HR and admin. A real run needs: the admin role, the
    deployment's PRIVACY_PURGE_ENABLED switch, and the exact confirmation word. It is repeatable:
    the DELETE re-checks eligibility itself, so records that stopped qualifying are never touched.
    """
    today = _today()
    summary = retention_summary(db)
    base = {
        "dry_run": dry_run,
        "purge_enabled": settings.PRIVACY_PURGE_ENABLED,
        "eligible_total": summary["purge_eligible"],
        "expired_with_applications": summary["expired_with_applications"],
    }
    batch_ids = list(
        db.scalars(
            select(Candidate.id)
            .where(_purge_condition(today))
            .order_by(Candidate.retain_until, Candidate.id)
            .limit(limit)
        )
    )
    if dry_run:
        return {
            **base,
            "batch_size": len(batch_ids),
            "candidate_ids": batch_ids,
            "deleted": 0,
            "remaining_eligible": base["eligible_total"],
        }

    if actor.role != UserRole.ADMIN:
        raise PermissionDeniedError("Only an administrator can permanently delete candidates.")
    if not settings.PRIVACY_PURGE_ENABLED:
        raise ConflictError(
            "Permanent deletion is turned off for this deployment (PRIVACY_PURGE_ENABLED)."
        )
    if confirm != PURGE_CONFIRMATION:
        raise BusinessRuleError(f"Type {PURGE_CONFIRMATION} to confirm a permanent deletion.")

    # Resume rows go with their candidate (ON DELETE CASCADE, same transaction). Note which files
    # belong to the batch now; only files of candidates that were REALLY deleted are removed after.
    batch_keys = resume_service.storage_keys(db, batch_ids)
    deleted_rows = db.execute(
        delete(Candidate)
        .where(Candidate.id.in_(batch_ids), _purge_condition(today))
        .returning(Candidate.id, Candidate.retain_until, Candidate.anonymized_at)
    ).all()
    for candidate_id, retain_until, anonymized_at in deleted_rows:
        audit.record(
            db,
            AuditEventType.CANDIDATE_PURGED,
            actor=actor,
            candidate_id=candidate_id,
            metadata={
                "reason": "retention_expired",
                "retain_until": retain_until.isoformat(),
                "was_anonymized": anonymized_at is not None,
                "resumes_removed": len(batch_keys.get(candidate_id, [])),
            },
            request_id=request_id,
        )
    db.commit()
    resume_storage.delete_many([k for r in deleted_rows for k in batch_keys.get(r[0], [])])
    logger.info("Retention purge deleted=%s", len(deleted_rows))
    remaining = retention_summary(db)["purge_eligible"]
    return {
        **base,
        "batch_size": len(deleted_rows),
        "candidate_ids": [r[0] for r in deleted_rows],
        "deleted": len(deleted_rows),
        "remaining_eligible": remaining,
    }
