import logging
import uuid
from datetime import date, datetime, time, timedelta

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core import security
from app.core.exceptions import (
    BusinessRuleError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
)
from app.models.application import (
    Application,
    ApplicationEvent,
    ApplicationEventType,
    ApplicationStage,
)
from app.models.candidate import Candidate, CandidateSource
from app.models.job import JobPosting, JobStatus
from app.models.user import User, UserRole
from app.schemas.application import ApplicationCreate, ApplicationUpdate
from app.services import application_workflow as flow
from app.services.candidate import _escape_like, touch_activity

# Personal data is never written to logs: only ids.
logger = logging.getLogger(__name__)

S = ApplicationStage
STAFF_ROLES = (UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER)
BOARD_COLUMN_LIMIT = 25


def _label(stage: S) -> str:
    return stage.value.replace("_", " ")


# ---- loading ---------------------------------------------------------------------------------


def _with_parties(stmt):
    return stmt.options(
        joinedload(Application.candidate),
        joinedload(Application.job),
        joinedload(Application.assigned_recruiter),
    )


def annotate(application: Application, actor: User) -> Application:
    """Attach what `actor` may do next, so the UI never has to re-implement the rules."""
    status = application.job.status
    application.allowed_stages = flow.allowed_targets(application.stage, status, actor.role)
    application.can_reopen = flow.can_reopen(application.stage, status, actor.role)
    return application


def get_application(db: Session, application_id: uuid.UUID, actor: User) -> Application:
    # populate_existing: always reload the row, its parties and its history.
    stmt = (
        _with_parties(select(Application).where(Application.id == application_id))
        .options(selectinload(Application.events).joinedload(ApplicationEvent.actor))
        .execution_options(populate_existing=True)
    )
    application = db.scalar(stmt)
    if application is None:
        raise NotFoundError("Application not found")
    return annotate(application, actor)


# ---- listing ---------------------------------------------------------------------------------


def _filters(
    *,
    q: str | None,
    job_id: uuid.UUID | None,
    candidate_id: uuid.UUID | None,
    recruiter_id: uuid.UUID | None,
    source: CandidateSource | None,
    applied_from: date | None,
    applied_to: date | None,
) -> list:
    conditions = []
    if q and q.strip():
        pattern = f"%{_escape_like(q.strip())}%"
        full_name = Candidate.first_name + " " + Candidate.last_name
        conditions.append(
            or_(
                full_name.ilike(pattern, escape="\\"),
                Candidate.email.ilike(pattern, escape="\\"),
                JobPosting.title.ilike(pattern, escape="\\"),
            )
        )
    if job_id:
        conditions.append(Application.job_id == job_id)
    if candidate_id:
        conditions.append(Application.candidate_id == candidate_id)
    if recruiter_id:
        conditions.append(Application.assigned_recruiter_id == recruiter_id)
    if source:
        conditions.append(Application.source == source)
    if applied_from:
        conditions.append(Application.applied_at >= _day_start(applied_from))
    if applied_to:
        conditions.append(Application.applied_at < _day_start(applied_to + timedelta(days=1)))
    return conditions


def _day_start(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=security.utcnow().tzinfo)


def _joined(stmt):
    return stmt.join(Candidate, Candidate.id == Application.candidate_id).join(
        JobPosting, JobPosting.id == Application.job_id
    )


def list_applications(
    db: Session,
    actor: User,
    *,
    q: str | None = None,
    job_id: uuid.UUID | None = None,
    candidate_id: uuid.UUID | None = None,
    stage: ApplicationStage | None = None,
    recruiter_id: uuid.UUID | None = None,
    source: CandidateSource | None = None,
    applied_from: date | None = None,
    applied_to: date | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Application], int, dict[ApplicationStage, int]]:
    conditions = _filters(
        q=q,
        job_id=job_id,
        candidate_id=candidate_id,
        recruiter_id=recruiter_id,
        source=source,
        applied_from=applied_from,
        applied_to=applied_to,
    )

    # Counts follow the filters but not the stage filter, so the stage tabs always add up.
    counts = {s: 0 for s in S}
    count_stmt = _joined(select(Application.stage, func.count()).select_from(Application))
    for stage_value, n in db.execute(count_stmt.where(*conditions).group_by(Application.stage)):
        counts[stage_value] = n

    listed = list(conditions)
    if stage:
        listed.append(Application.stage == stage)
    base = _joined(select(Application)).where(*listed)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = (
        db.scalars(
            _with_parties(base)
            .order_by(Application.applied_at.desc(), Application.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .unique()
        .all()
    )
    return [annotate(a, actor) for a in items], total, counts


def board(
    db: Session,
    actor: User,
    *,
    q: str | None = None,
    job_id: uuid.UUID | None = None,
    recruiter_id: uuid.UUID | None = None,
    source: CandidateSource | None = None,
) -> dict[ApplicationStage, tuple[int, list[Application]]]:
    conditions = _filters(
        q=q,
        job_id=job_id,
        candidate_id=None,
        recruiter_id=recruiter_id,
        source=source,
        applied_from=None,
        applied_to=None,
    )
    columns: dict[ApplicationStage, tuple[int, list[Application]]] = {}
    for stage in S:
        base = _joined(select(Application)).where(*conditions, Application.stage == stage)
        total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
        items = (
            db.scalars(
                _with_parties(base)
                .order_by(Application.stage_changed_at.desc(), Application.id)
                .limit(BOARD_COLUMN_LIMIT)
            )
            .unique()
            .all()
        )
        columns[stage] = (total, [annotate(a, actor) for a in items])
    return columns


def list_recruiters(db: Session) -> list[User]:
    """Active staff who can be assigned to an application."""
    return list(
        db.scalars(
            select(User)
            .where(User.is_active.is_(True), User.role.in_(STAFF_ROLES))
            .order_by(func.lower(User.email))
        )
    )


def summary(db: Session) -> dict:
    by_stage = {s: 0 for s in S}
    for stage, n in db.execute(select(Application.stage, func.count()).group_by(Application.stage)):
        by_stage[stage] = n
    open_jobs = db.scalar(
        select(func.count(func.distinct(Application.job_id)))
        .join(JobPosting, JobPosting.id == Application.job_id)
        .where(JobPosting.status == JobStatus.OPEN)
    )
    recent = db.execute(
        select(
            Application.id,
            Candidate.first_name,
            Candidate.last_name,
            JobPosting.title,
            Application.stage,
            Application.applied_at,
        )
        .join(Candidate, Candidate.id == Application.candidate_id)
        .join(JobPosting, JobPosting.id == Application.job_id)
        .order_by(Application.applied_at.desc(), Application.id)
        .limit(5)
    ).all()
    return {
        "total": sum(by_stage.values()),
        "by_stage": by_stage,
        "hired": by_stage[S.HIRED],
        "open_jobs_with_applications": open_jobs or 0,
        "recent": [
            {
                "id": r.id,
                "candidate_name": f"{r.first_name} {r.last_name}",
                "job_title": r.title,
                "stage": r.stage,
                "applied_at": r.applied_at,
            }
            for r in recent
        ],
    }


# ---- history ---------------------------------------------------------------------------------


def _record(
    db: Session,
    application: Application,
    actor: User,
    event_type: ApplicationEventType,
    *,
    from_value: str | None = None,
    to_value: str | None = None,
    note: str | None = None,
    now: datetime,
) -> None:
    """Add a history row to the SAME transaction as the change it describes."""
    db.add(
        ApplicationEvent(
            application_id=application.id,
            event_type=event_type,
            from_value=from_value,
            to_value=to_value,
            note=note,
            actor_id=actor.id,
            created_at=now,
        )
    )


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("This candidate already has an application for this job") from None


# ---- create ----------------------------------------------------------------------------------


def create_application(db: Session, actor: User, data: ApplicationCreate) -> Application:
    candidate = db.get(Candidate, data.candidate_id)
    if candidate is None:
        raise BusinessRuleError("Candidate not found")
    if candidate.anonymized_at is not None:
        raise BusinessRuleError("This candidate's data was anonymized and cannot be used")
    job = db.get(JobPosting, data.job_id)
    if job is None:
        raise BusinessRuleError("Job not found")
    if job.status != JobStatus.OPEN:
        raise ConflictError("Applications can only be added to open jobs")
    exists = db.scalar(
        select(Application.id).where(
            Application.candidate_id == candidate.id, Application.job_id == job.id
        )
    )
    if exists:
        raise ConflictError("This candidate already has an application for this job")

    now = security.utcnow()
    application = Application(
        candidate_id=candidate.id,
        job_id=job.id,
        stage=S.APPLIED,
        source=data.source or candidate.source,
        internal_notes=data.internal_notes,
        applied_at=now,
        stage_changed_at=now,
        created_by_id=actor.id,
        created_at=now,
    )
    db.add(application)
    db.flush()
    _record(
        db, application, actor, ApplicationEventType.CREATED, to_value=S.APPLIED.value, now=now
    )
    touch_activity(candidate, now)  # applying is meaningful activity: restarts retention
    _commit(db)
    logger.info("Application created id=%s", application.id)
    return get_application(db, application.id, actor)


# ---- update (assignment and notes only) ------------------------------------------------------


def _validate_recruiter(db: Session, actor: User, current: User | None, new_id: uuid.UUID | None):
    if actor.role == UserRole.RECRUITER:
        # A recruiter may claim an application for themselves or release their own claim.
        claims = new_id == actor.id
        releases = new_id is None and current is not None and current.id == actor.id
        if not (claims or releases):
            raise PermissionDeniedError(
                "Recruiters can only assign applications to themselves. Ask an HR manager."
            )
    if new_id is None:
        return None
    user = db.get(User, new_id)
    if user is None or not user.is_active or user.role not in STAFF_ROLES:
        raise BusinessRuleError("The recruiter must be an active recruiting staff member")
    return user


def update_application(
    db: Session, actor: User, application_id: uuid.UUID, data: ApplicationUpdate
) -> Application:
    application = get_application(db, application_id, actor)
    changes = data.model_dump(exclude_unset=True)
    now = security.utcnow()
    changed = False

    if "assigned_recruiter_id" in changes:
        new_id = changes["assigned_recruiter_id"]
        current = application.assigned_recruiter
        new_user = _validate_recruiter(db, actor, current, new_id)
        if (current.id if current else None) != new_id:
            application.assigned_recruiter_id = new_id
            _record(
                db,
                application,
                actor,
                ApplicationEventType.ASSIGNED,
                from_value=current.email if current else None,
                to_value=new_user.email if new_user else None,
                now=now,
            )
            changed = True

    if "internal_notes" in changes and changes["internal_notes"] != application.internal_notes:
        application.internal_notes = changes["internal_notes"]
        # The note's text stays on the application; history only says that it changed.
        _record(db, application, actor, ApplicationEventType.NOTES_UPDATED, now=now)
        changed = True

    if changed:
        _commit(db)
    return get_application(db, application.id, actor)


# ---- stage changes ---------------------------------------------------------------------------

_EVENT_FOR_TARGET = {
    S.REJECTED: ApplicationEventType.REJECTED,
    S.WITHDRAWN: ApplicationEventType.WITHDRAWN,
    S.HIRED: ApplicationEventType.HIRED,
}


def _move(
    db: Session,
    application: Application,
    actor: User,
    *,
    target: ApplicationStage,
    event_type: ApplicationEventType,
    note: str | None,
) -> Application:
    """Change the stage and write its history row in one transaction.

    The UPDATE only matches if the stage is still what we read, so two people acting on the same
    application at once cannot both succeed (the second gets a 409 instead of silently winning).
    """
    old = application.stage
    now = security.utcnow()
    result = db.execute(
        update(Application)
        .where(Application.id == application.id, Application.stage == old)
        .values(stage=target, stage_changed_at=now, updated_at=now)
    )
    if result.rowcount != 1:
        db.rollback()
        raise ConflictError("This application was just changed by someone else. Refresh and retry.")
    _record(
        db,
        application,
        actor,
        event_type,
        from_value=old.value,
        to_value=target.value,
        note=note,
        now=now,
    )
    touch_activity(application.candidate, now)  # moving an application is meaningful activity
    db.commit()
    logger.info("Application stage id=%s %s -> %s", application.id, old.value, target.value)
    return get_application(db, application.id, actor)


def change_stage(
    db: Session,
    actor: User,
    application_id: uuid.UUID,
    target: ApplicationStage,
    note: str | None,
) -> Application:
    application = get_application(db, application_id, actor)
    current = application.stage

    # Who may do it comes first, so a recruiter cannot probe hiring rules by trial and error.
    if not flow.may_move_to(actor.role, target):
        raise PermissionDeniedError("Only HR managers and admins can mark an application as hired.")
    if target == current:
        raise ConflictError(f"The application is already {_label(current)}")

    job_status = application.job.status
    if target not in flow.workflow_targets(current, job_status):
        if current in flow.TERMINAL:
            reopen_hint = " An HR manager can reopen it." if current in flow.REOPENABLE else ""
            raise ConflictError(f"A {_label(current)} application is final.{reopen_hint}")
        if job_status == JobStatus.CLOSED:
            raise ConflictError(
                "This job is closed. The application can only be rejected or withdrawn."
            )
        raise ConflictError(
            f"An application in {_label(current)} cannot move directly to {_label(target)}"
        )
    if target == S.REJECTED and not note:
        raise BusinessRuleError("Give a reason for rejecting this application")

    event_type = _EVENT_FOR_TARGET.get(target, ApplicationEventType.STAGE_CHANGED)
    return _move(db, application, actor, target=target, event_type=event_type, note=note)


def reopen(
    db: Session, actor: User, application_id: uuid.UUID, note: str | None
) -> Application:
    application = get_application(db, application_id, actor)
    if actor.role not in flow.HR_ROLES:
        raise PermissionDeniedError("Only HR managers and admins can reopen an application.")
    if application.stage == S.HIRED:
        raise ConflictError("A hired application is final and cannot be reopened")
    if application.stage not in flow.REOPENABLE:
        raise ConflictError("Only rejected or withdrawn applications can be reopened")
    if application.job.status == JobStatus.CLOSED:
        raise ConflictError("This job is closed. Reopen the job first.")

    # Back to the stage it was closed from (the history knows), else the start of the pipeline.
    closing = next(
        (
            e
            for e in reversed(application.events)
            if e.event_type in (ApplicationEventType.REJECTED, ApplicationEventType.WITHDRAWN)
        ),
        None,
    )
    restored = S.APPLIED
    if closing and closing.from_value:
        try:
            candidate_stage = S(closing.from_value)
            if candidate_stage in flow.ACTIVE:
                restored = candidate_stage
        except ValueError:
            pass
    return _move(
        db, application, actor, target=restored, event_type=ApplicationEventType.REOPENED, note=note
    )
