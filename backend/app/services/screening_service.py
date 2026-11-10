"""Requirements Coverage: creating, reading, reviewing and scrubbing assessments.

This is the only place where the pure engine (app.services.screening) meets the database. It:
  * reads the job's skill lists and the ACTIVE resume's human-reviewed data (never parsed_data),
  * stores what the engine returns as an immutable record,
  * records people's reviews separately, and
  * removes resume-derived content when a candidate is anonymized or a resume is deleted.

It never touches an application's stage or history, never ranks, and never filters by a figure.
"""

import importlib
import logging
import uuid
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core import security
from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.models.application import Application
from app.models.audit import AuditEventType
from app.models.job import JobPosting
from app.models.resume import Resume, ResumeStatus
from app.models.screening import (
    AssessmentStatus,
    ScreeningAssessment,
    ScreeningReview,
    ScrubReason,
)
from app.models.user import User
from app.services import audit
from app.services.screening import (
    ReviewedDataError,
    compute_coverage,
    input_fingerprint,
    profile_from_reviewed,
    requirements_from_job,
)
from app.services.screening.adjust import adjusted_total, unlisted_requirements
from app.services.screening.aliases import ALIAS_TABLE_VERSION
from app.services.screening.experience import format_months
from app.services.screening.normalize import canonical_skill

# The package also exports a function called `methodology`, which would shadow the submodule on a
# plain `from ... import`; the module is loaded by its full name instead.
text = importlib.import_module("app.services.screening.methodology")

logger = logging.getLogger(__name__)

MAX_ASSESSMENTS_PER_APPLICATION = 50
_NUMBER_RETRIES = 4

BLOCKER_TEXT = {
    "no_active_resume": "This candidate has no active resume. Upload a resume first.",
    "resume_not_reviewed": (
        "The active resume has not been reviewed yet. Review its details first: automatic "
        "readings that nobody reviewed are never used."
    ),
    "candidate_anonymized": "This candidate was anonymized, so no new assessment can be made.",
}
FRESHNESS_TEXT = {
    "job_requirements_changed": "The job's skill requirements changed after this was assessed.",
    "resume_changed": "A different resume is now the active resume.",
    "resume_reviewed_again": "The resume was reviewed again after this was assessed.",
    "resume_unavailable": "There is no reviewed active resume to compare with any more.",
    "methodology_changed": "The methodology has been updated since this was assessed.",
    "inputs_changed": "The inputs used for this assessment have changed.",
}


# ---- loading ---------------------------------------------------------------------------------


def _application(db: Session, application_id: uuid.UUID) -> Application:
    application = db.scalar(
        select(Application)
        .where(Application.id == application_id)
        .options(joinedload(Application.candidate), joinedload(Application.job))
        .execution_options(populate_existing=True)
    )
    if application is None:
        raise NotFoundError("Application not found")
    return application


def _active_resume(db: Session, candidate_id: uuid.UUID) -> Resume | None:
    return db.scalar(
        select(Resume).where(
            Resume.candidate_id == candidate_id,
            Resume.is_active.is_(True),
            Resume.status != ResumeStatus.REMOVED,
        )
    )


def _blocker(application: Application, resume: Resume | None) -> str | None:
    if application.candidate.anonymized_at is not None:
        return "candidate_anonymized"
    if resume is None:
        return "no_active_resume"
    if resume.reviewed_data is None or resume.reviewed_at is None:
        return "resume_not_reviewed"
    return None


def _keys(values) -> set[str]:
    found = (canonical_skill(v) for v in (values or ()))
    return {c[0] for c in found if c is not None}


def _freshness(
    assessment: ScreeningAssessment, application: Application, resume: Resume | None
) -> tuple[str, list[str]]:
    """("current" | "outdated" | "scrubbed", reasons). Never re-scores anything."""
    if assessment.scrubbed_at is not None:
        return "scrubbed", []
    reasons: list[str] = []
    if (
        assessment.scoring_version != text.SCORING_VERSION
        or assessment.alias_table_version != ALIAS_TABLE_VERSION
    ):
        reasons.append("methodology_changed")
    snap = assessment.job_snapshot
    job = application.job
    if _keys(snap.get("required_skills")) != _keys(job.required_skills) or _keys(
        snap.get("nice_to_have_skills")
    ) != _keys(job.nice_to_have_skills):
        reasons.append("job_requirements_changed")
    if resume is None or resume.reviewed_data is None or resume.reviewed_at is None:
        reasons.append("resume_unavailable")
    elif resume.id != assessment.resume_id:
        reasons.append("resume_changed")
    elif resume.reviewed_at != assessment.resume_reviewed_at:
        reasons.append("resume_reviewed_again")
    elif not reasons:
        try:
            now = input_fingerprint(
                requirements_from_job(job.required_skills, job.nice_to_have_skills),
                profile_from_reviewed(resume.reviewed_data),
            )
        except ReviewedDataError:
            now = None
        if now != assessment.input_fingerprint:
            reasons.append("inputs_changed")
    return ("outdated" if reasons else "current"), reasons


# ---- reading ---------------------------------------------------------------------------------


def _staff(user: User | None) -> dict | None:
    return {"id": user.id, "email": user.email, "role": user.role} if user else None


def _review_read(review: ScreeningReview, criteria: list[dict]) -> dict:
    adjusted = None
    if review.adjustments and review.scrubbed_at is None:
        value = adjusted_total(criteria, review.adjustments)
        adjusted = float(value) if value is not None else None
    return {
        "id": review.id,
        "judgement": review.judgement,
        "adjustments": review.adjustments,
        "adjustment_reason": review.adjustment_reason,
        "adjusted_total": adjusted,
        "note": review.note,
        "reviewer": _staff(review.reviewer),
        "created_at": review.created_at,
        "scrubbed": review.scrubbed_at is not None,
    }


def _experience_read(raw: dict | None) -> dict | None:
    if raw is None:
        return None
    return {**raw, "dated_text": format_months(raw["dated_months"]), "note": text.EXPERIENCE_NOTE}


def _read(
    assessment: ScreeningAssessment,
    application: Application,
    resume: Resume | None,
    created: bool = True,
) -> dict:
    state, reasons = _freshness(assessment, application, resume)
    criteria = assessment.criteria
    return {
        "id": assessment.id,
        "application_id": assessment.application_id,
        "assessment_number": assessment.assessment_number,
        "created_at": assessment.created_at,
        "requested_by": _staff(assessment.requested_by),
        "scoring_version": assessment.scoring_version,
        "alias_table_version": assessment.alias_table_version,
        "weights": assessment.weights,
        "job_requirements": {
            "required": list(assessment.job_snapshot.get("required_skills", [])),
            "preferred": list(assessment.job_snapshot.get("nice_to_have_skills", [])),
        },
        "status": assessment.status.value,
        "total_score": float(assessment.total_score)
        if assessment.total_score is not None
        else None,
        "assessed_weight": assessment.assessed_weight,
        "criteria": criteria,
        "experience": _experience_read(assessment.experience),
        "warnings": [{"code": c, "text": text.WARNINGS.get(c, c)} for c in assessment.warnings],
        "explanation": assessment.explanation,
        "limitations": assessment.limitations,
        "resume": {
            "version_number": assessment.resume_version_number,
            "reviewed_at": assessment.resume_reviewed_at,
            "still_exists": assessment.resume_id is not None,
        },
        "freshness": {
            "state": state,
            "reasons": reasons,
            "reason_texts": [FRESHNESS_TEXT[r] for r in reasons],
        },
        "scrubbed": assessment.scrubbed_at is not None,
        "scrub_reason": assessment.scrub_reason.value if assessment.scrub_reason else None,
        "reviews": [_review_read(r, criteria) for r in assessment.reviews],
        "unlisted_requirements": [] if assessment.scrubbed_at else unlisted_requirements(criteria),
        "created": created,
    }


def _load_assessment(db: Session, assessment_id: uuid.UUID) -> ScreeningAssessment:
    assessment = db.scalar(
        select(ScreeningAssessment)
        .where(ScreeningAssessment.id == assessment_id)
        .options(
            joinedload(ScreeningAssessment.requested_by),
            selectinload(ScreeningAssessment.reviews).joinedload(ScreeningReview.reviewer),
        )
        .execution_options(populate_existing=True)
    )
    if assessment is None:
        raise NotFoundError("Assessment not found")
    return assessment


def get_assessment(
    db: Session, actor: User, assessment_id: uuid.UUID, request_id: str | None = None
) -> dict:
    assessment = _load_assessment(db, assessment_id)
    application = _application(db, assessment.application_id)
    resume = _active_resume(db, application.candidate_id)
    audit.record(
        db,
        AuditEventType.SCREENING_VIEWED,
        actor=actor,
        candidate_id=application.candidate_id,
        metadata={"assessment_id": str(assessment.id), "application_id": str(application.id)},
        request_id=request_id,
    )
    result = _read(assessment, application, resume, created=False)
    db.commit()
    return result


def list_for_application(db: Session, application_id: uuid.UUID) -> dict:
    application = _application(db, application_id)
    resume = _active_resume(db, application.candidate_id)
    blocker = _blocker(application, resume)
    rows = db.scalars(
        select(ScreeningAssessment)
        .where(ScreeningAssessment.application_id == application_id)
        .options(joinedload(ScreeningAssessment.requested_by))
        .order_by(ScreeningAssessment.assessment_number.desc())
    ).all()
    review_counts = (
        dict(
            db.execute(
                select(ScreeningReview.assessment_id, func.count())
                .where(ScreeningReview.assessment_id.in_([r.id for r in rows]))
                .group_by(ScreeningReview.assessment_id)
            ).all()
        )
        if rows
        else {}
    )
    items = []
    for a in rows:
        state, _ = _freshness(a, application, resume)
        items.append(
            {
                "id": a.id,
                "assessment_number": a.assessment_number,
                "created_at": a.created_at,
                "scoring_version": a.scoring_version,
                "status": a.status.value,
                "total_score": float(a.total_score) if a.total_score is not None else None,
                "assessed_weight": a.assessed_weight,
                "freshness": state,
                "scrubbed": a.scrubbed_at is not None,
                "review_count": review_counts.get(a.id, 0),
                "requested_by": _staff(a.requested_by),
            }
        )
    return {
        "application_id": application_id,
        "readiness": {
            "can_assess": blocker is None,
            "blocker": blocker,
            "blocker_text": BLOCKER_TEXT.get(blocker) if blocker else None,
        },
        "job_requirements": {
            "required": list(application.job.required_skills or []),
            "preferred": list(application.job.nice_to_have_skills or []),
        },
        "items": items,
        "total": len(items),
    }


# ---- creating --------------------------------------------------------------------------------


def _existing_identity(
    db: Session, application_id: uuid.UUID, fingerprint: str, resume: Resume
) -> ScreeningAssessment | None:
    return db.scalar(
        select(ScreeningAssessment).where(
            ScreeningAssessment.application_id == application_id,
            ScreeningAssessment.input_fingerprint == fingerprint,
            ScreeningAssessment.resume_id == resume.id,
            ScreeningAssessment.resume_reviewed_at == resume.reviewed_at,
        )
    )


def create_assessment(
    db: Session, actor: User, application_id: uuid.UUID, request_id: str | None = None
) -> dict:
    application = _application(db, application_id)
    resume = _active_resume(db, application.candidate_id)
    blocker = _blocker(application, resume)
    if blocker:
        raise ConflictError(BLOCKER_TEXT[blocker])
    assert resume is not None  # narrowed by _blocker
    try:
        profile = profile_from_reviewed(resume.reviewed_data)  # reviewed data only; strict shape
    except ReviewedDataError:
        raise ConflictError(BLOCKER_TEXT["resume_not_reviewed"]) from None
    job: JobPosting = application.job
    requirements = requirements_from_job(job.required_skills, job.nice_to_have_skills)
    fingerprint = input_fingerprint(requirements, profile)

    existing = _existing_identity(db, application_id, fingerprint, resume)
    if existing is not None:  # idempotent: the same inputs were already assessed
        return _read(_load_assessment(db, existing.id), application, resume, created=False)

    count = db.scalar(
        select(func.count())
        .select_from(ScreeningAssessment)
        .where(ScreeningAssessment.application_id == application_id)
    )
    if (count or 0) >= MAX_ASSESSMENTS_PER_APPLICATION:
        raise ConflictError("This application has reached the limit of stored assessments")

    result = compute_coverage(requirements, profile, today=security.utcnow().date())
    data = result.to_dict()
    for _ in range(_NUMBER_RETRIES):
        number = (
            db.scalar(
                select(func.max(ScreeningAssessment.assessment_number)).where(
                    ScreeningAssessment.application_id == application_id
                )
            )
            or 0
        ) + 1
        assessment = ScreeningAssessment(
            application_id=application_id,
            assessment_number=number,
            resume_id=resume.id,
            resume_version_number=resume.version_number,
            resume_reviewed_at=resume.reviewed_at,
            input_fingerprint=fingerprint,
            scoring_version=result.scoring_version,
            alias_table_version=result.alias_table_version,
            weights={
                "required_skills": text.WEIGHT_REQUIRED,
                "preferred_skills": text.WEIGHT_PREFERRED,
            },
            job_snapshot={
                "required_skills": list(job.required_skills or []),
                "nice_to_have_skills": list(job.nice_to_have_skills or []),
            },
            status=AssessmentStatus(result.status),
            total_score=result.total,
            assessed_weight=result.assessed_weight,
            criteria=data["criteria"],
            experience=data["experience"],
            warnings=list(result.warnings),
            explanation=result.explanation,
            limitations=list(result.limitations),
            requested_by_id=actor.id,
            created_at=security.utcnow(),
        )
        try:
            db.add(assessment)
            db.flush()
            audit.record(
                db,
                AuditEventType.SCREENING_CREATED,
                actor=actor,
                candidate_id=application.candidate_id,
                metadata=_created_metadata(assessment, data),
                request_id=request_id,
            )
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            again = _existing_identity(db, application_id, fingerprint, resume)
            if again is not None:  # someone else just created the identical assessment
                return _read(
                    _load_assessment(db, again.id), _application(db, application_id), resume, False
                )
            application = _application(db, application_id)
            resume = _active_resume(db, application.candidate_id)
            if resume is None or _blocker(application, resume):
                raise ConflictError(
                    "The resume changed while the assessment was being made"
                ) from None
    else:
        raise ConflictError("The assessment could not be saved because of simultaneous requests")
    logger.info("Screening assessment created id=%s", assessment.id)
    return _read(_load_assessment(db, assessment.id), application, resume, created=True)


def _created_metadata(assessment: ScreeningAssessment, data: dict) -> dict:
    """Ids, versions and counts only: never skill names, evidence or resume content."""
    meta: dict = {
        "assessment_id": str(assessment.id),
        "application_id": str(assessment.application_id),
        "assessment_number": assessment.assessment_number,
        "scoring_version": assessment.scoring_version,
        "alias_table_version": assessment.alias_table_version,
        "status": assessment.status.value,
        "total_score": float(assessment.total_score)
        if assessment.total_score is not None
        else None,
        "assessed_weight": assessment.assessed_weight,
        "resume_version": assessment.resume_version_number,
    }
    for criterion in data["criteria"]:
        prefix = "required" if criterion["key"] == "required_skills" else "preferred"
        meta[f"{prefix}_listed"] = criterion["listed"]
        meta[f"{prefix}_total"] = criterion["total"]
    return meta


# ---- reviewing -------------------------------------------------------------------------------


def add_review(
    db: Session, actor: User, assessment_id: uuid.UUID, data, request_id: str | None = None
) -> dict:
    assessment = _load_assessment(db, assessment_id)
    application = _application(db, assessment.application_id)
    if assessment.scrubbed_at is not None:
        raise ConflictError(
            "This assessment's resume details were removed, so it cannot be reviewed"
        )
    adjustments = list(data.adjustments)
    if adjustments:
        allowed = set(unlisted_requirements(assessment.criteria))
        unknown = [a for a in adjustments if a not in allowed]
        if unknown:
            raise BusinessRuleError(
                "Only requirements that are not listed in this assessment can be adjusted"
            )
    review = ScreeningReview(
        assessment_id=assessment.id,
        reviewer_id=actor.id,
        judgement=data.judgement,
        adjustments=adjustments or None,
        adjustment_reason=data.adjustment_reason,
        note=data.note,
        created_at=security.utcnow(),
    )
    db.add(review)
    db.flush()
    audit.record(
        db,
        AuditEventType.SCREENING_REVIEWED,
        actor=actor,
        candidate_id=application.candidate_id,
        metadata={
            "assessment_id": str(assessment.id),
            "application_id": str(application.id),
            "judgement": data.judgement.value,
            "adjustment_count": len(adjustments),
            "adjustment_reason": data.adjustment_reason.value if data.adjustment_reason else None,
            "has_note": data.note is not None,
        },
        request_id=request_id,
    )
    db.commit()
    resume = _active_resume(db, application.candidate_id)
    return _read(_load_assessment(db, assessment.id), application, resume, created=False)


# ---- job overview ----------------------------------------------------------------------------


def job_overview(db: Session, job_id: uuid.UUID, page: int, page_size: int) -> dict:
    """Each applicant's screening STATE, newest application first. Never ordered by a figure."""
    if db.get(JobPosting, job_id) is None:
        raise NotFoundError("Job not found")
    base = select(Application).where(Application.job_id == job_id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    apps = (
        db.scalars(
            base.options(joinedload(Application.candidate), joinedload(Application.job))
            .order_by(Application.applied_at.desc(), Application.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .unique()
        .all()
    )
    candidate_ids = [a.candidate_id for a in apps]
    resumes = (
        {
            r.candidate_id: r
            for r in db.scalars(
                select(Resume).where(
                    Resume.candidate_id.in_(candidate_ids),
                    Resume.is_active.is_(True),
                    Resume.status != ResumeStatus.REMOVED,
                )
            )
        }
        if apps
        else {}
    )
    assessments: dict[uuid.UUID, list[ScreeningAssessment]] = {}
    if apps:
        for a in db.scalars(
            select(ScreeningAssessment)
            .where(ScreeningAssessment.application_id.in_([x.id for x in apps]))
            .order_by(ScreeningAssessment.assessment_number)
        ):
            assessments.setdefault(a.application_id, []).append(a)
    items = []
    for app in apps:
        resume = resumes.get(app.candidate_id)
        mine = assessments.get(app.id, [])
        blocker = _blocker(app, resume)
        if mine:
            states = [_freshness(a, app, resume)[0] for a in mine]
            state = (
                "current"
                if "current" in states
                else ("scrubbed" if all(s == "scrubbed" for s in states) else "outdated")
            )
        else:
            state = "cannot_assess" if blocker else "not_assessed"
        c = app.candidate
        items.append(
            {
                "application_id": app.id,
                "candidate_id": c.id,
                "candidate_name": f"{c.first_name} {c.last_name}",
                "stage": app.stage.value,
                "applied_at": app.applied_at,
                "state": state,
                "blocker": blocker if not mine else None,
                "assessment_count": len(mine),
                "last_assessed_at": mine[-1].created_at if mine else None,
            }
        )
    return {"job_id": job_id, "items": items, "total": total, "page": page, "page_size": page_size}


# ---- privacy: removing resume-derived content --------------------------------------------------


def _strip_evidence(criteria: list[dict]) -> list[dict]:
    return [{k: v for k, v in c.items() if k != "evidence"} | {"evidence": None} for c in criteria]


def _scrub(
    db: Session, assessment_ids: list[uuid.UUID], reason: ScrubReason, now: datetime
) -> tuple[int, int]:
    """Core UPDATEs (not ORM flushes): the one sanctioned way an assessment row ever changes."""
    if not assessment_ids:
        return 0, 0
    rows = db.execute(
        select(ScreeningAssessment.id, ScreeningAssessment.criteria).where(
            ScreeningAssessment.id.in_(assessment_ids), ScreeningAssessment.scrubbed_at.is_(None)
        )
    ).all()
    for assessment_id, criteria in rows:
        db.execute(
            update(ScreeningAssessment)
            .where(ScreeningAssessment.id == assessment_id)
            .values(
                criteria=_strip_evidence(criteria),
                experience=None,
                input_fingerprint=None,  # a hash of resume-derived skills is itself derived data
                scrubbed_at=now,
                scrub_reason=reason,
            )
        )
    scrubbed_ids = [r[0] for r in rows]
    reviews = 0
    if scrubbed_ids:
        reviews = (
            db.execute(
                update(ScreeningReview)
                .where(
                    ScreeningReview.assessment_id.in_(scrubbed_ids),
                    ScreeningReview.scrubbed_at.is_(None),
                )
                .values(adjustments=None, note=None, scrubbed_at=now)
            ).rowcount
            or 0
        )
    return len(rows), reviews


def _record_scrub(db, actor, candidate_id, assessments, reviews, reason, request_id, now) -> None:
    if assessments or reviews:
        audit.record(
            db,
            AuditEventType.SCREENING_SCRUBBED,
            actor=actor,
            candidate_id=candidate_id,
            metadata={"assessments": assessments, "reviews": reviews, "reason": reason.value},
            request_id=request_id,
            now=now,
        )


def count_for_candidate(db: Session, candidate_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(ScreeningAssessment)
            .join(Application, Application.id == ScreeningAssessment.application_id)
            .where(
                Application.candidate_id == candidate_id, ScreeningAssessment.scrubbed_at.is_(None)
            )
        )
        or 0
    )


def scrub_for_candidate(
    db: Session, actor: User | None, candidate_id: uuid.UUID, request_id: str | None = None
) -> tuple[int, int]:
    """Anonymization: remove resume-derived content from every assessment of this candidate.
    The caller commits (it is part of the anonymization transaction)."""
    ids = list(
        db.scalars(
            select(ScreeningAssessment.id)
            .join(Application, Application.id == ScreeningAssessment.application_id)
            .where(Application.candidate_id == candidate_id)
        )
    )
    now = security.utcnow()
    assessments, reviews = _scrub(db, ids, ScrubReason.ANONYMIZED, now)
    _record_scrub(
        db, actor, candidate_id, assessments, reviews, ScrubReason.ANONYMIZED, request_id, now
    )
    return assessments, reviews


def scrub_for_resume(
    db: Session,
    actor: User | None,
    resume_id: uuid.UUID,
    candidate_id: uuid.UUID,
    request_id: str | None = None,
) -> tuple[int, int]:
    """A resume is being deleted: assessments built from it lose their resume-derived content."""
    ids = list(
        db.scalars(select(ScreeningAssessment.id).where(ScreeningAssessment.resume_id == resume_id))
    )
    now = security.utcnow()
    assessments, reviews = _scrub(db, ids, ScrubReason.RESUME_DELETED, now)
    _record_scrub(
        db, actor, candidate_id, assessments, reviews, ScrubReason.RESUME_DELETED, request_id, now
    )
    return assessments, reviews


# ---- export (metadata only) ------------------------------------------------------------------


def export_metadata(db: Session, application_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[dict]]:
    """Per application: numbers, versions and dates. No evidence, snapshots or reviewer notes."""
    out: dict[uuid.UUID, list[dict]] = {a: [] for a in application_ids}
    if not application_ids:
        return out
    judgements: dict[uuid.UUID, dict[str, int]] = {}
    for assessment_id, judgement, n in db.execute(
        select(ScreeningReview.assessment_id, ScreeningReview.judgement, func.count())
        .join(ScreeningAssessment, ScreeningAssessment.id == ScreeningReview.assessment_id)
        .where(ScreeningAssessment.application_id.in_(application_ids))
        .group_by(ScreeningReview.assessment_id, ScreeningReview.judgement)
    ):
        judgements.setdefault(assessment_id, {})[judgement.value] = n
    for a in db.scalars(
        select(ScreeningAssessment)
        .where(ScreeningAssessment.application_id.in_(application_ids))
        .order_by(ScreeningAssessment.application_id, ScreeningAssessment.assessment_number)
    ):
        out[a.application_id].append(
            {
                "assessment_number": a.assessment_number,
                "assessed_at": a.created_at,
                "scoring_version": a.scoring_version,
                "alias_table_version": a.alias_table_version,
                "status": a.status.value,
                "requirements_coverage": float(a.total_score)
                if a.total_score is not None
                else None,
                "assessed_weight": a.assessed_weight,
                "resume_version": a.resume_version_number,
                "scrubbed": a.scrubbed_at is not None,
                "reviews": judgements.get(a.id, {}),
            }
        )
    return out
