"""Resume management: upload, versions, parsing, review, download, deletion.

Every state change writes its audit event in the same transaction. Audit metadata holds ids,
counts, field NAMES and codes only. Files are only touched through `resume_storage`, and are
deleted AFTER the database commit (a failure there leaves an orphan that `cleanup_orphans` removes,
never a database row pointing at a file that was already thrown away).
"""

import logging
import uuid
from collections.abc import Iterable
from datetime import timedelta
from typing import BinaryIO

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core import security
from app.core.config import settings
from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.models.application import Application
from app.models.audit import AuditEventType
from app.models.candidate import Candidate
from app.models.resume import Resume, ResumeStatus
from app.models.user import User
from app.schemas.resume import ParsedResume, ResumeReviewRequest, ReviewedResume
from app.services import audit
from app.services import resume_parser as parser
from app.services import resume_storage as storage
from app.services import resume_text as text_extraction
from app.services import resume_validation as validation

logger = logging.getLogger(__name__)  # ids and counts only

PROCESSING_STALE = timedelta(minutes=5)
REMOVED_NAME = "removed"


# ---- helpers -----------------------------------------------------------------------------------


def _with_people(stmt):
    return stmt.options(joinedload(Resume.uploaded_by), joinedload(Resume.reviewed_by))


def get_resume(db: Session, resume_id: uuid.UUID) -> Resume:
    resume = db.scalar(
        _with_people(select(Resume).where(Resume.id == resume_id)).execution_options(
            populate_existing=True
        )
    )
    if resume is None or resume.status == ResumeStatus.REMOVED:
        raise NotFoundError("Resume not found")
    return resume


def _meta(resume: Resume, **extra) -> dict:
    return {"resume_id": str(resume.id), "version": resume.version_number, **extra}


def _record(db, actor, event, resume, *, request_id, **extra) -> None:
    audit.record(
        db,
        event,
        actor=actor,
        candidate_id=resume.candidate_id,
        metadata=_meta(resume, **extra),
        request_id=request_id,
    )


def _candidate(db: Session, candidate_id: uuid.UUID) -> Candidate:
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise NotFoundError("Candidate not found")
    return candidate


def _check_application(
    db: Session, candidate_id: uuid.UUID, application_id: uuid.UUID | None
) -> None:
    if application_id is None:
        return
    app = db.get(Application, application_id)
    if app is None or app.candidate_id != candidate_id:
        # Same answer for "missing" and "someone else's": nothing leaks about other candidates.
        raise BusinessRuleError("That application does not belong to this candidate")


# ---- listing -----------------------------------------------------------------------------------


def list_resumes(
    db: Session,
    candidate_id: uuid.UUID,
    *,
    application_id: uuid.UUID | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Resume], int]:
    _candidate(db, candidate_id)
    stmt = select(Resume).where(
        Resume.candidate_id == candidate_id, Resume.status != ResumeStatus.REMOVED
    )
    if application_id:
        stmt = stmt.where(Resume.application_id == application_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(
        _with_people(stmt)
        .order_by(Resume.version_number.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(items), total


# ---- upload ------------------------------------------------------------------------------------


def _insert_version(
    db: Session,
    actor: User,
    candidate_id,
    application_id,
    *,
    filename,
    detected,
    received,
    key,
    request_id,
) -> Resume:
    for _ in range(3):  # concurrent uploads for the same candidate race for the next version number
        version = (
            db.scalar(
                select(func.max(Resume.version_number)).where(Resume.candidate_id == candidate_id)
            )
            or 0
        ) + 1
        # The newest upload becomes the active one (the database allows only one per candidate).
        db.execute(
            update(Resume)
            .where(Resume.candidate_id == candidate_id, Resume.is_active.is_(True))
            .values(is_active=False)
        )
        resume = Resume(
            candidate_id=candidate_id,
            application_id=application_id,
            version_number=version,
            original_filename=filename,
            storage_key=key,
            mime_type=detected.mime_type,
            extension=detected.extension,
            size_bytes=received.size,
            sha256=received.sha256,
            status=ResumeStatus.PENDING,
            is_active=True,
            uploaded_by_id=actor.id,
        )
        db.add(resume)
        try:
            # The unique constraints can fire at the flush OR the commit: both are handled alike.
            db.flush()
            _record(
                db,
                actor,
                AuditEventType.RESUME_UPLOADED,
                resume,
                request_id=request_id,
                extension=detected.extension,
                size_bytes=received.size,
            )
            db.commit()
            return resume
        except IntegrityError:
            db.rollback()
            if db.scalar(
                select(Resume.id).where(
                    Resume.candidate_id == candidate_id, Resume.sha256 == received.sha256
                )
            ):
                raise ConflictError("This file was already uploaded for this candidate") from None
    raise ConflictError(
        "The upload could not be saved because of simultaneous uploads. Please try again."
    )


def upload_resume(
    db: Session,
    actor: User,
    candidate_id: uuid.UUID,
    *,
    stream: BinaryIO,
    filename: str | None,
    declared_type: str | None,
    application_id: uuid.UUID | None = None,
    request_id: str | None = None,
) -> Resume:
    candidate = _candidate(db, candidate_id)
    if candidate.anonymized_at is not None:
        raise ConflictError("This candidate was anonymized; resumes can no longer be added")
    existing = (
        db.scalar(
            select(func.count())
            .select_from(Resume)
            .where(Resume.candidate_id == candidate_id, Resume.status != ResumeStatus.REMOVED)
        )
        or 0
    )
    if existing >= settings.RESUME_MAX_PER_CANDIDATE:
        raise BusinessRuleError(
            f"A candidate can have at most {settings.RESUME_MAX_PER_CANDIDATE} resumes. "
            "Delete an old one first."
        )
    _check_application(db, candidate_id, application_id)

    safe_name = validation.sanitize_filename(filename)
    received = storage.receive(
        stream, settings.RESUME_MAX_BYTES
    )  # bounded; raises 413 if too large
    try:
        detected = validation.detect(
            safe_name, declared_type, received.size, received.head, received.tmp_path
        )
        duplicate = db.scalar(
            select(Resume.version_number).where(
                Resume.candidate_id == candidate_id, Resume.sha256 == received.sha256
            )
        )
        if duplicate is not None:
            raise ConflictError(
                f"This file was already uploaded for this candidate (version {duplicate})"
            )
    except BaseException:
        storage.discard(received.tmp_path)
        raise

    key = storage.new_key()
    storage.commit(received.tmp_path, key)  # atomic move into private storage
    try:
        resume = _insert_version(
            db,
            actor,
            candidate_id,
            application_id,
            filename=safe_name,
            detected=detected,
            received=received,
            key=key,
            request_id=request_id,
        )
    except BaseException:
        storage.delete(key)  # never leave a file the database does not know about
        raise
    logger.info("Resume uploaded id=%s", resume.id)
    run_parse(
        db, actor, resume.id, request_id=request_id
    )  # upload and parse are separate audit events
    return get_resume(db, resume.id)


# ---- parsing -----------------------------------------------------------------------------------


def run_parse(
    db: Session, actor: User, resume_id: uuid.UUID, *, request_id: str | None = None
) -> Resume:
    """(Re)parse a stored resume. Safe to retry; two simultaneous requests cannot both run."""
    before = get_resume(db, resume_id)
    event = (
        AuditEventType.RESUME_PARSE_RETRIED
        if before.status in (ResumeStatus.FAILED, ResumeStatus.NO_TEXT)
        else AuditEventType.RESUME_PARSED
    )
    now = security.utcnow()
    claim = db.execute(
        update(Resume)
        .where(
            Resume.id == resume_id,
            Resume.status != ResumeStatus.REMOVED,
            or_(
                Resume.status != ResumeStatus.PROCESSING, Resume.updated_at < now - PROCESSING_STALE
            ),
        )
        .values(status=ResumeStatus.PROCESSING, updated_at=now)
    )
    if claim.rowcount != 1:
        db.rollback()
        raise ConflictError("This resume is already being processed")
    db.commit()

    status, code, text_chars, parsed = ResumeStatus.FAILED, "parser_error", None, None
    try:
        path = storage.path_for(before.storage_key or "")
        extracted = text_extraction.extract(
            path,
            before.extension,
            max_chars=settings.RESUME_MAX_TEXT_CHARS,
            max_pages=settings.RESUME_MAX_PDF_PAGES,
        )
        text_chars = len(extracted.text)
        if not extracted.text:
            status, code = (
                ResumeStatus.NO_TEXT,
                "ocr_unavailable",
            )  # image-only: we do not fabricate text
        else:
            parsed = parser.parse_resume(extracted.text, truncated=extracted.truncated)
            status, code = ResumeStatus.PARSED, None
    except text_extraction.ExtractionError as exc:
        code = exc.code
    except Exception:  # never let a hostile file turn into a 500 or leak content
        logger.exception("Unexpected resume parser failure id=%s", resume_id)
        code = "parser_error"

    done = security.utcnow()
    db.execute(
        update(Resume)
        .where(Resume.id == resume_id)
        .values(
            status=status,
            parse_error_code=code,
            text_chars=text_chars,
            parsed_data=parsed,
            parsed_at=done if status == ResumeStatus.PARSED else None,
            updated_at=done,
        )
    )
    _record(db, actor, event, before, request_id=request_id, status=status.value, error_code=code)
    db.commit()
    return get_resume(db, resume_id)


# ---- viewing parsed data, review ---------------------------------------------------------------


def parsed_view(db: Session, actor: User, resume_id: uuid.UUID, request_id: str | None = None):
    resume = get_resume(db, resume_id)
    _record(db, actor, AuditEventType.RESUME_VIEWED, resume, request_id=request_id)
    db.commit()
    resume = get_resume(db, resume_id)
    parsed = reviewed = None
    try:
        parsed = ParsedResume.model_validate(resume.parsed_data) if resume.parsed_data else None
        reviewed = (
            ReviewedResume.model_validate(resume.reviewed_data) if resume.reviewed_data else None
        )
    except Exception:  # data written by a different parser version: show nothing rather than guess
        logger.warning("Stored parse result could not be read id=%s", resume.id)
    return resume, parsed, reviewed


def _baseline(parsed: dict | None) -> dict:
    p = parsed or {}
    g = lambda k: (p.get(k) or {}).get("value")  # noqa: E731
    return {
        "name": g("name"),
        "email": g("email"),
        "phone": g("phone"),
        "skills": list((p.get("skills") or {}).get("values") or []),
        "education": [
            {k: e.get(k) for k in ("institution", "degree", "field", "start_year", "end_year")}
            for e in p.get("education") or []
        ],
        "experience": [
            {k: e.get(k) for k in ("title", "company", "start", "end", "current")}
            for e in p.get("experience") or []
        ],
    }


def review_resume(
    db: Session,
    actor: User,
    resume_id: uuid.UUID,
    data: ResumeReviewRequest,
    request_id: str | None = None,
) -> Resume:
    resume = get_resume(db, resume_id)
    new = data.model_dump(mode="json", exclude={"confirm"})
    old = resume.reviewed_data or _baseline(resume.parsed_data)
    changed = [k for k in new if new[k] != old.get(k)]
    now = security.utcnow()
    resume.reviewed_data = new
    resume.reviewed_at = now
    resume.reviewed_by_id = actor.id
    _record(
        db,
        actor,
        AuditEventType.RESUME_REVIEWED,
        resume,
        request_id=request_id,
        changed_fields=changed,
        count=len(changed),
    )
    db.commit()
    return get_resume(db, resume_id)


# ---- active version, application link, deletion ------------------------------------------------


def activate(
    db: Session, actor: User, resume_id: uuid.UUID, request_id: str | None = None
) -> Resume:
    resume = get_resume(db, resume_id)
    try:
        db.execute(
            update(Resume)
            .where(
                Resume.candidate_id == resume.candidate_id,
                Resume.id != resume.id,
                Resume.is_active.is_(True),
            )
            .values(is_active=False)
        )
        db.execute(update(Resume).where(Resume.id == resume.id).values(is_active=True))
        _record(db, actor, AuditEventType.RESUME_ACTIVATED, resume, request_id=request_id)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError(
            "Another change to this candidate's resumes happened at the same time. Try again."
        ) from None
    return get_resume(db, resume_id)


def set_application(
    db: Session,
    actor: User,
    resume_id: uuid.UUID,
    application_id: uuid.UUID | None,
    request_id: str | None = None,
) -> Resume:
    resume = get_resume(db, resume_id)
    _check_application(db, resume.candidate_id, application_id)
    if resume.application_id != application_id:
        resume.application_id = application_id
        _record(
            db,
            actor,
            AuditEventType.RESUME_UPDATED,
            resume,
            request_id=request_id,
            changed_fields=["application_id"],
        )
        db.commit()
    return get_resume(db, resume_id)


def delete_resume(
    db: Session, actor: User, resume_id: uuid.UUID, request_id: str | None = None
) -> None:
    resume = get_resume(db, resume_id)
    key, was_active, candidate_id = resume.storage_key, resume.is_active, resume.candidate_id
    _record(
        db,
        actor,
        AuditEventType.RESUME_DELETED,
        resume,
        request_id=request_id,
        extension=resume.extension,
    )
    db.delete(resume)
    db.flush()
    if was_active:  # promote the newest remaining resume so the candidate keeps an active one
        newest = db.scalar(
            select(Resume)
            .where(Resume.candidate_id == candidate_id, Resume.status != ResumeStatus.REMOVED)
            .order_by(Resume.version_number.desc())
            .limit(1)
        )
        if newest is not None:
            newest.is_active = True
    db.commit()
    storage.delete(key)  # after the commit: a failure leaves an orphan, never a dangling row


def open_download(db: Session, actor: User, resume_id: uuid.UUID, request_id: str | None = None):
    """Open the stored file and record the download. Returns (handle, resume)."""
    resume = get_resume(db, resume_id)
    try:
        handle = storage.open_for_read(resume.storage_key or "")
    except FileNotFoundError:
        logger.error("Stored resume file is missing id=%s", resume.id)
        raise NotFoundError("The file for this resume is no longer available") from None
    try:
        _record(
            db,
            actor,
            AuditEventType.RESUME_DOWNLOADED,
            resume,
            request_id=request_id,
            extension=resume.extension,
        )
        db.commit()
    except BaseException:
        handle.close()
        raise
    return handle, resume


# ---- integration with candidate deletion, anonymization and purge ------------------------------


def storage_keys(db: Session, candidate_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
    out: dict[uuid.UUID, list[str]] = {}
    ids = list(candidate_ids)
    if not ids:
        return out
    for cid, key in db.execute(
        select(Resume.candidate_id, Resume.storage_key).where(
            Resume.candidate_id.in_(ids), Resume.storage_key.is_not(None)
        )
    ):
        out.setdefault(cid, []).append(key)
    return out


def tombstone_for_candidate(db: Session, candidate_id: uuid.UUID) -> list[str]:
    """Anonymization: the resume files are removed (a CV is inherently identifying). Rows stay as
    bare tombstones (no name, no hash, no parsed data) so history and counts remain intact.
    Returns the storage keys to delete once the transaction has committed."""
    keys = storage_keys(db, [candidate_id]).get(candidate_id, [])
    db.execute(
        update(Resume)
        .where(Resume.candidate_id == candidate_id, Resume.status != ResumeStatus.REMOVED)
        .values(
            status=ResumeStatus.REMOVED,
            storage_key=None,
            original_filename=REMOVED_NAME,
            sha256=None,
            parsed_data=None,
            reviewed_data=None,
            parse_error_code=None,
            text_chars=None,
            is_active=False,
            file_removed_at=security.utcnow(),
            reviewed_by_id=None,
        )
    )
    return keys


def count_for_candidate(db: Session, candidate_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Resume)
            .where(Resume.candidate_id == candidate_id, Resume.status != ResumeStatus.REMOVED)
        )
        or 0
    )


def cleanup_orphans(db: Session, *, dry_run: bool = True) -> dict:
    """Find (and optionally delete) stored files no database row refers to, and stale temp files."""
    known = set(db.scalars(select(Resume.storage_key).where(Resume.storage_key.is_not(None))))
    unreferenced, stale = storage.orphans(known)
    removed = 0
    if not dry_run:
        for path in [*unreferenced, *stale]:
            try:
                path.unlink(missing_ok=True)
                removed += 1
            except OSError:
                logger.warning("Could not remove an orphaned file")
    return {
        "orphaned_files": len(unreferenced),
        "stale_temp_files": len(stale),
        "removed": removed,
        "dry_run": dry_run,
    }
