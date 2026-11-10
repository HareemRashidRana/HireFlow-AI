"""Interviews: scheduling, lifecycle, conflict detection, history, statistics.

Rules this module enforces (each has tests):
  * Times are stored as UTC instants plus the IANA zone they were scheduled in; a local time that
    does not exist or happens twice (daylight saving) is refused, never guessed.
  * Interviewers are active staff accounts. Nobody can be on one interview twice, and nobody can be
    booked into two overlapping interviews (or a candidate into two): the interviewers' user
    rows are locked in a fixed order for the duration of the transaction, so two simultaneous
    requests for the same person are serialised and the second one sees the first.
  * The lifecycle only moves forward through TRANSITIONS. Rescheduling never edits the original: it
    marks it `rescheduled` and creates a linked successor. Cancelled interviews keep everything.
  * Nothing here ever changes an application's stage or its history.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, exists, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core import security
from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.models.application import Application, ApplicationStage
from app.models.audit import AuditEventType
from app.models.candidate import Candidate
from app.models.interview import (
    OCCUPYING,
    OPEN,
    FeedbackStatus,
    Interview,
    InterviewEvent,
    InterviewEventType,
    InterviewFeedback,
    InterviewFeedbackRevision,
    InterviewInterviewer,
    InterviewMode,
    InterviewStatus,
)
from app.models.job import JobPosting
from app.models.user import User, UserRole
from app.services import audit
from app.services import interview_rules as rules

logger = logging.getLogger(__name__)

STAFF = (UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER)
CLOSED_STAGES = (ApplicationStage.HIRED, ApplicationStage.REJECTED, ApplicationStage.WITHDRAWN)
S = InterviewStatus


# ---- loading ---------------------------------------------------------------------------------


def _with_parties(stmt):
    return stmt.options(
        joinedload(Interview.application).joinedload(Application.candidate),
        joinedload(Interview.application).joinedload(Application.job),
        selectinload(Interview.interviewers).joinedload(InterviewInterviewer.user),
        joinedload(Interview.created_by),
        joinedload(Interview.updated_by),
    )


def load_interview(db: Session, interview_id: uuid.UUID) -> Interview:
    interview = db.scalar(
        _with_parties(select(Interview).where(Interview.id == interview_id)).execution_options(
            populate_existing=True
        )
    )
    if interview is None:
        raise NotFoundError("Interview not found")
    return interview


def _staff_ref(user: User | None) -> dict | None:
    return {"id": user.id, "email": user.email, "role": user.role} if user else None


def _feedback_statuses(db: Session, interview_ids: list[uuid.UUID]) -> dict[tuple, str]:
    if not interview_ids:
        return {}
    rows = db.execute(
        select(
            InterviewFeedback.interview_id,
            InterviewFeedback.interviewer_id,
            InterviewFeedback.status,
        ).where(InterviewFeedback.interview_id.in_(interview_ids))
    )
    return {(i, u): s.value for i, u, s in rows}


def _successors(db: Session, interview_ids: list[uuid.UUID]) -> dict[uuid.UUID, uuid.UUID]:
    if not interview_ids:
        return {}
    rows = db.execute(
        select(Interview.rescheduled_from_id, Interview.id).where(
            Interview.rescheduled_from_id.in_(interview_ids)
        )
    )
    return {old: new for old, new in rows}


def allowed_actions(interview: Interview, actor: User, now: datetime) -> list[str]:
    actions = ["view_history"]
    if interview.scrubbed_at is None and interview.status in OPEN:
        actions += ["update", "cancel", "reschedule", "manage_interviewers"]
        if interview.status == S.SCHEDULED:
            actions.append("confirm")
        if now >= interview.starts_at:
            actions.append("complete")
    mine = any(i.user_id == actor.id for i in interview.interviewers)
    if mine and interview.status in (*OPEN, S.COMPLETED) and interview.scrubbed_at is None:
        if interview.status == S.COMPLETED or now >= interview.starts_at:
            actions.append("submit_feedback")
        actions.append("save_feedback_draft")
    return actions


def build_reads(db: Session, interviews: list[Interview], actor: User) -> list[dict]:
    ids = [i.id for i in interviews]
    statuses = _feedback_statuses(db, ids)
    successors = _successors(db, ids)
    now = security.utcnow()
    out = []
    for i in interviews:
        app = i.application
        mine = any(x.user_id == actor.id for x in i.interviewers)
        out.append(
            {
                "id": i.id,
                "application": {
                    "id": app.id,
                    "stage": app.stage.value,
                    "candidate": {
                        "id": app.candidate.id,
                        "first_name": app.candidate.first_name,
                        "last_name": app.candidate.last_name,
                    },
                    "job": {"id": app.job.id, "title": app.job.title},
                },
                "title": i.title,
                "interview_type": i.interview_type,
                "round_number": i.round_number,
                "mode": i.mode,
                "status": i.status,
                "starts_at": i.starts_at,
                "ends_at": i.ends_at,
                "timezone": i.timezone,
                "starts_local": rules.local_text(i.starts_at, i.timezone),
                "ends_local": rules.local_text(i.ends_at, i.timezone),
                "utc_offset": rules.utc_offset(i.starts_at, i.timezone),
                "duration_minutes": int((i.ends_at - i.starts_at).total_seconds() // 60),
                "location": i.location,
                "meeting_url": i.meeting_url,
                "interviewers": [
                    {
                        **_staff_ref(x.user),
                        "feedback_status": statuses.get((i.id, x.user_id), "none"),
                    }
                    for x in i.interviewers
                ],
                "rescheduled_from_id": i.rescheduled_from_id,
                "rescheduled_to_id": successors.get(i.id),
                "cancellation_reason": i.cancellation_reason,
                "cancelled_at": i.cancelled_at,
                "completed_at": i.completed_at,
                "created_by": _staff_ref(i.created_by),
                "updated_by": _staff_ref(i.updated_by),
                "created_at": i.created_at,
                "updated_at": i.updated_at,
                "scrubbed": i.scrubbed_at is not None,
                "allowed_actions": allowed_actions(i, actor, now),
                "my_feedback_status": statuses.get((i.id, actor.id), "none") if mine else None,
            }
        )
    return out


def get_read(db: Session, actor: User, interview_id: uuid.UUID) -> dict:
    return build_reads(db, [load_interview(db, interview_id)], actor)[0]


# ---- validation helpers ----------------------------------------------------------------------


def _lock_application(db: Session, application_id: uuid.UUID) -> None:
    """Serialise everything that books the SAME candidate. Always taken before the interviewers'
    locks (application first, then people in id order), so concurrent requests cannot deadlock."""
    db.execute(select(Application.id).where(Application.id == application_id).with_for_update())


def _staff_users(db: Session, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, User]:
    """Active staff only. The rows are LOCKED (in id order, so two requests cannot deadlock): a
    concurrent request for the same person waits here and then sees this one's interview."""
    found = {
        u.id: u
        for u in db.scalars(
            select(User).where(User.id.in_(user_ids)).order_by(User.id).with_for_update()
        )
    }
    for uid in user_ids:
        user = found.get(uid)
        if user is None or not user.is_active or user.role not in STAFF:
            raise BusinessRuleError(
                "Interviewers must be active HireFlow staff accounts (admin, HR manager or recruiter)."  # noqa: E501
            )
    return found


def _resolve_times(starts, ends, tz_name: str) -> tuple[datetime, datetime]:
    try:
        s, e = rules.resolve_instant(starts, tz_name), rules.resolve_instant(ends, tz_name)
        rules.check_range(s, e)
    except ValueError as exc:
        raise BusinessRuleError(str(exc)) from None
    return s, e


def _fmt(i: Interview) -> str:
    start = rules.to_local(i.starts_at, i.timezone)
    end = rules.to_local(i.ends_at, i.timezone)
    return f"{start:%H:%M}-{end:%H:%M} on {start:%d %b %Y} ({i.timezone})"


def check_conflicts(
    db: Session,
    *,
    users: dict[uuid.UUID, User],
    application_id: uuid.UUID,
    starts: datetime,
    ends: datetime,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """Refuse an overlap for any interviewer or for the candidate. Cancelled and rescheduled
    interviews never block (they no longer happen). Touching ranges (10:00-11:00 then 11:00-12:00)
    do not overlap."""
    overlap = and_(
        Interview.status.in_(OCCUPYING), Interview.starts_at < ends, Interview.ends_at > starts
    )
    skip = [Interview.id != exclude_id] if exclude_id else []
    problems: list[str] = []
    rows = db.execute(
        select(Interview, InterviewInterviewer.user_id)
        .join(InterviewInterviewer, InterviewInterviewer.interview_id == Interview.id)
        .where(InterviewInterviewer.user_id.in_(list(users)), overlap, *skip)
        .order_by(Interview.starts_at)
    ).all()
    for interview, user_id in rows:
        problems.append(
            f'{users[user_id].email} is already booked for "{interview.title}", {_fmt(interview)}'
        )
    for interview in db.scalars(
        select(Interview)
        .where(Interview.application_id == application_id, overlap, *skip)
        .order_by(Interview.starts_at)
    ):
        problems.append(f'the candidate already has "{interview.title}", {_fmt(interview)}')
    if problems:
        shown = "; ".join(problems[:3]) + (
            f" (and {len(problems) - 3} more)" if len(problems) > 3 else ""
        )
        raise ConflictError(f"Scheduling conflict: {shown}.")


def _event(
    db: Session,
    interview: Interview,
    actor: User | None,
    kind: InterviewEventType,
    details: dict | None = None,
):
    db.add(
        InterviewEvent(
            interview_id=interview.id,
            event_type=kind,
            actor_id=actor.id if actor else None,
            details=details or {},
            created_at=security.utcnow(),
        )
    )


def _audit(db, actor, kind: AuditEventType, interview: Interview, request_id, **extra) -> None:
    """Ids, versions and counts only: never titles, notes, links, feedback or candidate details."""
    audit.record(
        db,
        kind,
        actor=actor,
        candidate_id=interview.application.candidate_id,
        metadata={
            "interview_id": str(interview.id),
            "application_id": str(interview.application_id),
            **extra,
        },
        request_id=request_id,
    )


def _next_round(db: Session, application_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.max(Interview.round_number)).where(
                Interview.application_id == application_id
            )
        )
        or 0
    ) + 1


# ---- lifecycle -------------------------------------------------------------------------------


def create_interview(db: Session, actor: User, data, request_id: str | None = None) -> dict:
    application = db.scalar(
        select(Application)
        .where(Application.id == data.application_id)
        .options(joinedload(Application.candidate), joinedload(Application.job))
    )
    if application is None:
        raise NotFoundError("Application not found")
    if application.candidate.anonymized_at is not None:
        raise ConflictError(
            "This candidate was anonymized, so interviews can no longer be scheduled."
        )
    if application.stage in CLOSED_STAGES:
        raise ConflictError(
            "This application is closed (hired, rejected or withdrawn), so interviews can no longer be scheduled."  # noqa: E501
        )
    starts, ends = _resolve_times(data.starts_at, data.ends_at, data.timezone)
    if starts < security.utcnow():
        raise BusinessRuleError("Interviews cannot be scheduled in the past.")
    _lock_application(db, application.id)
    users = _staff_users(db, list(data.interviewer_ids))
    check_conflicts(db, users=users, application_id=application.id, starts=starts, ends=ends)

    interview = Interview(
        application_id=application.id,
        title=data.title,
        interview_type=data.interview_type,
        round_number=data.round_number or _next_round(db, application.id),
        mode=data.mode,
        status=S.SCHEDULED,
        starts_at=starts,
        ends_at=ends,
        timezone=data.timezone,
        location=data.location,
        meeting_url=data.meeting_url,
        created_by_id=actor.id,
        updated_by_id=actor.id,
    )
    interview.application = application
    db.add(interview)
    db.flush()
    for uid in data.interviewer_ids:
        db.add(InterviewInterviewer(interview_id=interview.id, user_id=uid, added_by_id=actor.id))
    _event(
        db,
        interview,
        actor,
        InterviewEventType.CREATED,
        {
            "starts_at": starts.isoformat(),
            "ends_at": ends.isoformat(),
            "timezone": data.timezone,
            "interviewers": len(users),
        },
    )
    _audit(
        db,
        actor,
        AuditEventType.INTERVIEW_CREATED,
        interview,
        request_id,
        interview_type=data.interview_type.value,
        round_number=interview.round_number,
        mode=data.mode.value,
        interviewer_count=len(users),
        minutes=int((ends - starts).total_seconds() // 60),
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError(
            "The interview could not be saved because of a simultaneous change. Please try again."
        ) from None
    return get_read(db, actor, interview.id)


def _require_open(interview: Interview, what: str) -> None:
    if interview.scrubbed_at is not None:
        raise ConflictError("The details of this interview were removed, so it cannot be changed.")
    if interview.status not in OPEN:
        raise ConflictError(f"A {interview.status.value} interview cannot be {what}.")


def update_interview(
    db: Session, actor: User, interview_id: uuid.UUID, data, request_id: str | None = None
) -> dict:
    interview = load_interview(db, interview_id)
    _require_open(interview, "edited")
    changed = []
    for name in data.model_fields_set:
        value = getattr(data, name)
        if name in ("title", "interview_type", "mode", "round_number") and value is None:
            continue  # these cannot be cleared
        if getattr(interview, name) != value:
            setattr(interview, name, value)
            changed.append(name)
    if interview.mode == InterviewMode.IN_PERSON and not interview.location:
        raise BusinessRuleError("Add the location for an in-person interview")
    if not changed:
        return build_reads(db, [interview], actor)[0]
    interview.updated_by_id = actor.id
    _event(db, interview, actor, InterviewEventType.UPDATED, {"fields": sorted(changed)})
    _audit(
        db, actor, AuditEventType.INTERVIEW_UPDATED, interview, request_id, fields=sorted(changed)
    )
    db.commit()
    return get_read(db, actor, interview_id)


def _move(
    db: Session,
    actor: User,
    interview: Interview,
    target: InterviewStatus,
    kind: InterviewEventType,
    audit_kind,
    request_id,
    **fields,
) -> None:
    if not rules.can_transition(interview.status, target):
        raise ConflictError(f"A {interview.status.value} interview cannot become {target.value}.")
    before = interview.status
    interview.status = target
    interview.updated_by_id = actor.id
    for k, v in fields.items():
        setattr(interview, k, v)
    _event(db, interview, actor, kind, {"from": before.value, "to": target.value})
    _audit(db, actor, audit_kind, interview, request_id, status=target.value)


def confirm(
    db: Session, actor: User, interview_id: uuid.UUID, request_id: str | None = None
) -> dict:
    interview = load_interview(db, interview_id)
    _require_open(interview, "confirmed")
    if interview.status != S.SCHEDULED:
        raise ConflictError("This interview is already confirmed.")
    _move(
        db,
        actor,
        interview,
        S.CONFIRMED,
        InterviewEventType.CONFIRMED,
        AuditEventType.INTERVIEW_CONFIRMED,
        request_id,
    )
    db.commit()
    return get_read(db, actor, interview_id)


def complete(
    db: Session, actor: User, interview_id: uuid.UUID, request_id: str | None = None
) -> dict:
    interview = load_interview(db, interview_id)
    _require_open(interview, "completed")
    now = security.utcnow()
    if now < interview.starts_at:
        raise ConflictError("This interview has not started yet, so it cannot be marked completed.")
    _move(
        db,
        actor,
        interview,
        S.COMPLETED,
        InterviewEventType.COMPLETED,
        AuditEventType.INTERVIEW_COMPLETED,
        request_id,
        completed_at=now,
    )
    db.commit()  # note: the application's stage is NOT touched; moving it is a separate, explicit action  # noqa: E501
    return get_read(db, actor, interview_id)


def cancel(
    db: Session, actor: User, interview_id: uuid.UUID, reason: str, request_id: str | None = None
) -> dict:
    interview = load_interview(db, interview_id)
    _require_open(interview, "cancelled")
    _move(
        db,
        actor,
        interview,
        S.CANCELLED,
        InterviewEventType.CANCELLED,
        AuditEventType.INTERVIEW_CANCELLED,
        request_id,
        cancellation_reason=reason,
        cancelled_at=security.utcnow(),
    )
    db.commit()
    return get_read(db, actor, interview_id)


def reschedule(
    db: Session, actor: User, interview_id: uuid.UUID, data, request_id: str | None = None
) -> dict:
    """The original is kept (status `rescheduled`, times and people intact); a linked new interview
    carries the new time. Both are conflict-checked, ignoring the original."""
    old = load_interview(db, interview_id)
    _require_open(old, "rescheduled")
    tz_name = data.timezone or old.timezone
    starts, ends = _resolve_times(data.starts_at, data.ends_at, tz_name)
    if starts < security.utcnow():
        raise BusinessRuleError("Interviews cannot be rescheduled into the past.")
    if (starts, ends, tz_name) == (
        old.starts_at,
        old.ends_at,
        old.timezone,
    ) and data.interviewer_ids is None:
        raise BusinessRuleError("Choose a different time to reschedule.")
    people = (
        list(data.interviewer_ids)
        if data.interviewer_ids is not None
        else [i.user_id for i in old.interviewers]
    )
    _lock_application(db, old.application_id)
    users = _staff_users(db, people)
    check_conflicts(
        db,
        users=users,
        application_id=old.application_id,
        starts=starts,
        ends=ends,
        exclude_id=old.id,
    )

    if not rules.can_transition(old.status, S.RESCHEDULED):
        raise ConflictError(f"A {old.status.value} interview cannot be rescheduled.")
    previous_start = old.starts_at
    old.status = S.RESCHEDULED
    old.updated_by_id = actor.id
    new = Interview(
        application_id=old.application_id,
        title=old.title,
        interview_type=old.interview_type,
        round_number=old.round_number,
        mode=old.mode,
        status=S.SCHEDULED,
        starts_at=starts,
        ends_at=ends,
        timezone=tz_name,
        location=old.location,
        meeting_url=old.meeting_url,
        rescheduled_from_id=old.id,
        created_by_id=actor.id,
        updated_by_id=actor.id,
    )
    new.application = old.application
    db.add(new)
    db.flush()
    for uid in people:
        db.add(InterviewInterviewer(interview_id=new.id, user_id=uid, added_by_id=actor.id))
    _event(
        db,
        new,
        actor,
        InterviewEventType.CREATED,
        {
            "rescheduled_from": str(old.id),
            "starts_at": starts.isoformat(),
            "ends_at": ends.isoformat(),
            "timezone": tz_name,
            "interviewers": len(users),
        },
    )
    _event(
        db,
        old,
        actor,
        InterviewEventType.RESCHEDULED,
        {
            "from": "scheduled/confirmed",
            "to": S.RESCHEDULED.value,
            "from_starts_at": previous_start.isoformat(),
            "to_starts_at": starts.isoformat(),
            "timezone": tz_name,
            "new_interview": str(new.id),
            "has_reason": bool(data.reason),
        },
    )
    _audit(
        db,
        actor,
        AuditEventType.INTERVIEW_RESCHEDULED,
        old,
        request_id,
        new_interview_id=str(new.id),
        interviewer_count=len(users),
        has_reason=bool(data.reason),
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("This interview was already rescheduled by someone else.") from None
    return get_read(db, actor, new.id)


# ---- interviewers ----------------------------------------------------------------------------


def add_interviewer(
    db: Session,
    actor: User,
    interview_id: uuid.UUID,
    user_id: uuid.UUID,
    request_id: str | None = None,
) -> dict:
    interview = load_interview(db, interview_id)
    _require_open(interview, "changed")
    if len(interview.interviewers) >= 10:
        raise BusinessRuleError("An interview can have at most 10 interviewers.")
    if any(i.user_id == user_id for i in interview.interviewers):
        raise ConflictError("This person is already an interviewer on this interview.")
    _lock_application(db, interview.application_id)
    users = _staff_users(db, [user_id])
    check_conflicts(
        db,
        users=users,
        application_id=interview.application_id,
        starts=interview.starts_at,
        ends=interview.ends_at,
        exclude_id=interview.id,
    )
    db.add(InterviewInterviewer(interview_id=interview.id, user_id=user_id, added_by_id=actor.id))
    interview.updated_by_id = actor.id
    _event(
        db,
        interview,
        actor,
        InterviewEventType.INTERVIEWER_ADDED,
        {"interviewers": len(interview.interviewers) + 1},
    )
    _audit(
        db,
        actor,
        AuditEventType.INTERVIEWERS_CHANGED,
        interview,
        request_id,
        added=1,
        removed=0,
        interviewer_count=len(interview.interviewers) + 1,
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("This person is already an interviewer on this interview.") from None
    return get_read(db, actor, interview_id)


def remove_interviewer(
    db: Session,
    actor: User,
    interview_id: uuid.UUID,
    user_id: uuid.UUID,
    request_id: str | None = None,
) -> dict:
    interview = load_interview(db, interview_id)
    _require_open(interview, "changed")
    target = next((i for i in interview.interviewers if i.user_id == user_id), None)
    if target is None:
        raise NotFoundError("This person is not an interviewer on this interview.")
    if len(interview.interviewers) == 1:
        raise BusinessRuleError("An interview needs at least one interviewer.")
    if db.scalar(
        select(InterviewFeedback.id).where(
            InterviewFeedback.interview_id == interview.id,
            InterviewFeedback.interviewer_id == user_id,
        )
    ):
        raise ConflictError(
            "This interviewer already has feedback on this interview, so they cannot be removed."
        )
    db.delete(target)
    interview.updated_by_id = actor.id
    _event(
        db,
        interview,
        actor,
        InterviewEventType.INTERVIEWER_REMOVED,
        {"interviewers": len(interview.interviewers) - 1},
    )
    _audit(
        db,
        actor,
        AuditEventType.INTERVIEWERS_CHANGED,
        interview,
        request_id,
        added=0,
        removed=1,
        interviewer_count=len(interview.interviewers) - 1,
    )
    db.commit()
    return get_read(db, actor, interview_id)


def assignable_staff(db: Session) -> list[dict]:
    users = db.scalars(
        select(User).where(User.is_active.is_(True), User.role.in_(STAFF)).order_by(User.email)
    ).all()
    return [_staff_ref(u) for u in users]


# ---- reading lists ---------------------------------------------------------------------------


def _filters(
    *,
    q=None,
    application_id=None,
    job_id=None,
    interviewer_id=None,
    status=None,
    interview_type=None,
    starts_from=None,
    starts_to=None,
):
    conds = []
    if application_id:
        conds.append(Interview.application_id == application_id)
    if job_id:
        conds.append(Application.job_id == job_id)
    if status:
        conds.append(Interview.status == status)
    if interview_type:
        conds.append(Interview.interview_type == interview_type)
    if starts_from:
        conds.append(Interview.starts_at >= starts_from)
    if starts_to:
        conds.append(Interview.starts_at < starts_to)
    if interviewer_id:
        conds.append(
            exists().where(
                InterviewInterviewer.interview_id == Interview.id,
                InterviewInterviewer.user_id == interviewer_id,
            )
        )
    if q:
        term = q.strip()
        conds.append(
            or_(
                Interview.title.icontains(term, autoescape=True),
                Candidate.first_name.icontains(term, autoescape=True),
                Candidate.last_name.icontains(term, autoescape=True),
                JobPosting.title.icontains(term, autoescape=True),
                (Candidate.first_name + " " + Candidate.last_name).icontains(term, autoescape=True),
            )
        )
    return conds


def list_interviews(
    db: Session,
    actor: User,
    *,
    page: int = 1,
    page_size: int = 20,
    newest_first: bool = False,
    **filters,
) -> tuple[list[dict], int]:
    conds = _filters(**filters)
    base = (
        select(Interview)
        .join(Application, Application.id == Interview.application_id)
        .join(Candidate, Candidate.id == Application.candidate_id)
        .join(JobPosting, JobPosting.id == Application.job_id)
        .where(*conds)
    )
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    order = (
        (Interview.starts_at.desc(), Interview.id)
        if newest_first
        else (Interview.starts_at.asc(), Interview.id)
    )
    rows = (
        db.scalars(
            _with_parties(base).order_by(*order).offset((page - 1) * page_size).limit(page_size)
        )
        .unique()
        .all()
    )
    return build_reads(db, list(rows), actor), total


def history(db: Session, interview_id: uuid.UUID) -> list[dict]:
    load_interview(db, interview_id)
    rows = db.scalars(
        select(InterviewEvent)
        .where(InterviewEvent.interview_id == interview_id)
        .options(joinedload(InterviewEvent.actor))
        .order_by(InterviewEvent.created_at, InterviewEvent.id)
    )
    return [
        {
            "id": e.id,
            "event_type": e.event_type,
            "actor": _staff_ref(e.actor),
            "details": e.details,
            "created_at": e.created_at,
        }
        for e in rows
    ]


def stats(db: Session) -> dict:
    now = security.utcnow()
    by_status = dict.fromkeys((s.value for s in InterviewStatus), 0)
    for status, n in db.execute(select(Interview.status, func.count()).group_by(Interview.status)):
        by_status[status.value] = n
    upcoming_q = (
        select(func.count())
        .select_from(Interview)
        .where(Interview.status.in_(OPEN), Interview.starts_at >= now)
    )
    upcoming = db.scalar(upcoming_q) or 0
    week = db.scalar(upcoming_q.where(Interview.starts_at < now + timedelta(days=7))) or 0
    submitted_exists = exists().where(
        InterviewFeedback.interview_id == InterviewInterviewer.interview_id,
        InterviewFeedback.interviewer_id == InterviewInterviewer.user_id,
        InterviewFeedback.status == FeedbackStatus.SUBMITTED,
    )
    pending = (
        db.scalar(
            select(func.count())
            .select_from(InterviewInterviewer)
            .join(Interview, Interview.id == InterviewInterviewer.interview_id)
            .where(
                Interview.status.in_((*OPEN, S.COMPLETED)),
                Interview.starts_at < now,
                Interview.scrubbed_at.is_(None),
                ~submitted_exists,
            )
        )
        or 0
    )
    submitted = (
        db.scalar(
            select(func.count())
            .select_from(InterviewFeedback)
            .where(InterviewFeedback.status == FeedbackStatus.SUBMITTED)
        )
        or 0
    )
    days: dict[str, int] = {}
    for starts_at, tz in db.execute(
        select(Interview.starts_at, Interview.timezone).where(
            Interview.status.in_(OPEN),
            Interview.starts_at >= now,
            Interview.starts_at < now + timedelta(days=14),
        )
    ):
        key = rules.local_text(starts_at, tz)[:10]
        days[key] = days.get(key, 0) + 1
    return {
        "total": sum(by_status.values()),
        "by_status": by_status,
        "upcoming": upcoming,
        "next_7_days": week,
        "feedback_pending": pending,
        "feedback_submitted": submitted,
        "upcoming_by_day": [{"date": d, "count": days[d]} for d in sorted(days)],
    }


# ---- privacy ---------------------------------------------------------------------------------


def _candidate_interview_ids(db: Session, candidate_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        db.scalars(
            select(Interview.id)
            .join(Application, Application.id == Interview.application_id)
            .where(Application.candidate_id == candidate_id)
        )
    )


def count_for_candidate(db: Session, candidate_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Interview)
            .join(Application, Application.id == Interview.application_id)
            .where(Application.candidate_id == candidate_id, Interview.scrubbed_at.is_(None))
        )
        or 0
    )


def scrub_for_candidate(
    db: Session, actor: User | None, candidate_id: uuid.UUID, request_id: str | None = None
) -> tuple[int, int]:
    """Anonymization: free text written about the person (titles, links, locations, cancellation
    reasons, all feedback text and private notes, and the text of earlier feedback versions) is removed.  # noqa: E501
    Times, statuses, types and ratings stay. Part of the anonymization transaction: the caller commits."""  # noqa: E501
    ids = _candidate_interview_ids(db, candidate_id)
    if not ids:
        return 0, 0
    now = security.utcnow()
    n = (
        db.execute(
            update(Interview)
            .where(Interview.id.in_(ids), Interview.scrubbed_at.is_(None))
            .values(
                title="Interview",
                location=None,
                meeting_url=None,
                scrubbed_at=now,
            )
        ).rowcount
        or 0
    )
    db.execute(
        update(Interview)
        .where(Interview.id.in_(ids), Interview.status == S.CANCELLED)
        .values(cancellation_reason="removed")
    )
    f = (
        db.execute(
            update(InterviewFeedback)
            .where(InterviewFeedback.interview_id.in_(ids), InterviewFeedback.scrubbed_at.is_(None))
            .values(
                overall_feedback=None,
                technical_notes=None,
                role_notes=None,
                strengths=None,
                concerns=None,
                private_notes=None,
                scrubbed_at=now,
            )
        ).rowcount
        or 0
    )
    fb_ids = select(InterviewFeedback.id).where(InterviewFeedback.interview_id.in_(ids))
    db.execute(
        update(InterviewFeedbackRevision)
        .where(InterviewFeedbackRevision.feedback_id.in_(fb_ids))
        .values(snapshot={}, edit_reason=None)
    )
    if n or f:
        audit.record(
            db,
            AuditEventType.INTERVIEW_SCRUBBED,
            actor=actor,
            candidate_id=candidate_id,
            metadata={"interviews": n, "feedback_records": f, "reason": "anonymized"},
            request_id=request_id,
            now=now,
        )
    return n, f


def export_metadata(db: Session, application_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[dict]]:
    """Dates, types and statuses only: no titles, links, feedback or ratings."""
    out: dict[uuid.UUID, list[dict]] = {a: [] for a in application_ids}
    if not application_ids:
        return out
    for i in db.scalars(
        select(Interview)
        .where(Interview.application_id.in_(application_ids))
        .order_by(Interview.starts_at)
    ):
        out[i.application_id].append(
            {
                "round": i.round_number,
                "type": i.interview_type.value,
                "mode": i.mode.value,
                "status": i.status.value,
                "starts_at": i.starts_at.astimezone(UTC),
                "timezone": i.timezone,
            }
        )
    return out
