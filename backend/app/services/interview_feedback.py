"""Interview feedback: written by the interviewer, protected, and never machine-generated.

Who can see what (enforced here, not in the UI):
  * A DRAFT is visible only to its author.
  * PRIVATE NOTES are visible only to their author, ever (not even to HR or an admin).
  * SUBMITTED feedback is visible to its author and to HR managers and admins (consolidated view).
    Other staff see only whether feedback exists, never its content.
  * Only an assigned interviewer can write feedback, and only their own.
Submitted feedback is not silently changed: an edit needs a reason, bumps the version and keeps a
revision of what it said before (without the private notes).
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.core import security
from app.core.exceptions import ConflictError, NotFoundError, PermissionDeniedError
from app.models.audit import AuditEventType
from app.models.interview import (
    OPEN,
    FeedbackStatus,
    Interview,
    InterviewFeedback,
    InterviewFeedbackRevision,
    InterviewStatus,
)
from app.models.user import User, UserRole
from app.services import audit
from app.services.interview import _staff_ref, load_interview

MAX_EDITS = 10
CONTENT_FIELDS = (
    "overall_rating",
    "technical_rating",
    "communication_rating",
    "problem_solving_rating",
    "overall_feedback",
    "technical_notes",
    "role_notes",
    "strengths",
    "concerns",
)
VIEW_ALL = (UserRole.ADMIN, UserRole.HR_MANAGER)


def _require_interviewer(interview: Interview, actor: User) -> None:
    if not any(i.user_id == actor.id for i in interview.interviewers):
        raise PermissionDeniedError(
            "Only an interviewer on this interview can write feedback for it."
        )
    if (
        interview.scrubbed_at is not None
        or interview.application.candidate.anonymized_at is not None
    ):
        raise ConflictError(
            "This candidate's details were removed, so feedback can no longer be changed."
        )


def _mine(db: Session, interview_id: uuid.UUID, user_id: uuid.UUID) -> InterviewFeedback | None:
    return db.scalar(
        select(InterviewFeedback).where(
            InterviewFeedback.interview_id == interview_id,
            InterviewFeedback.interviewer_id == user_id,
        )
    )


def _apply(feedback: InterviewFeedback, data) -> None:
    for name in (*CONTENT_FIELDS, "private_notes"):
        setattr(feedback, name, getattr(data, name))


def _meta(interview: Interview, **extra) -> dict:
    return {
        "interview_id": str(interview.id),
        "application_id": str(interview.application_id),
        **extra,
    }


def save_draft(
    db: Session, actor: User, interview_id: uuid.UUID, data, request_id: str | None = None
) -> dict:
    interview = load_interview(db, interview_id)
    _require_interviewer(interview, actor)
    if interview.status not in (*OPEN, InterviewStatus.COMPLETED):
        raise ConflictError("Feedback cannot be added to a cancelled or rescheduled interview.")
    feedback = _mine(db, interview_id, actor.id)
    created = feedback is None
    if feedback is not None and feedback.status == FeedbackStatus.SUBMITTED:
        raise ConflictError(
            "This feedback was already submitted. Use the edit option to change it."
        )
    if feedback is None:
        feedback = InterviewFeedback(interview_id=interview_id, interviewer_id=actor.id)
        db.add(feedback)
    _apply(feedback, data)
    audit.record(
        db,
        AuditEventType.FEEDBACK_DRAFT_SAVED,
        actor=actor,
        candidate_id=interview.application.candidate_id,
        metadata=_meta(interview, created=created),
        request_id=request_id,
    )
    db.commit()
    return _read(_mine(db, interview_id, actor.id), actor, interview)


def submit(
    db: Session, actor: User, interview_id: uuid.UUID, data, request_id: str | None = None
) -> dict:
    interview = load_interview(db, interview_id)
    _require_interviewer(interview, actor)
    if interview.status not in (*OPEN, InterviewStatus.COMPLETED):
        raise ConflictError("Feedback cannot be added to a cancelled or rescheduled interview.")
    if interview.status != InterviewStatus.COMPLETED and security.utcnow() < interview.starts_at:
        raise ConflictError("Feedback can be submitted once the interview has started.")
    feedback = _mine(db, interview_id, actor.id)
    if feedback is not None and feedback.status == FeedbackStatus.SUBMITTED:
        raise ConflictError(
            "This feedback was already submitted. Use the edit option to change it."
        )
    if feedback is None:
        feedback = InterviewFeedback(interview_id=interview_id, interviewer_id=actor.id)
        db.add(feedback)
    _apply(feedback, data)
    feedback.status = FeedbackStatus.SUBMITTED
    feedback.submitted_at = security.utcnow()
    feedback.version = 1
    audit.record(
        db,
        AuditEventType.FEEDBACK_SUBMITTED,
        actor=actor,
        candidate_id=interview.application.candidate_id,
        metadata=_meta(interview, overall_rating=data.overall_rating),
        request_id=request_id,
    )
    db.commit()
    return _read(_mine(db, interview_id, actor.id), actor, interview)


def _snapshot(feedback: InterviewFeedback) -> dict:
    """What the feedback said, WITHOUT the private notes (those are never kept in history)."""
    return {name: getattr(feedback, name) for name in CONTENT_FIELDS}


def edit_submitted(
    db: Session, actor: User, interview_id: uuid.UUID, data, request_id: str | None = None
) -> dict:
    interview = load_interview(db, interview_id)
    _require_interviewer(interview, actor)
    feedback = _mine(db, interview_id, actor.id)
    if feedback is None or feedback.status != FeedbackStatus.SUBMITTED:
        raise ConflictError("There is no submitted feedback to edit. Submit it first.")
    if feedback.version > MAX_EDITS:
        raise ConflictError("This feedback has reached the limit of edits.")
    db.add(
        InterviewFeedbackRevision(
            feedback_id=feedback.id,
            version=feedback.version,
            snapshot=_snapshot(feedback),
            edit_reason=data.edit_reason,
            edited_by_id=actor.id,
            created_at=security.utcnow(),
        )
    )
    _apply(feedback, data)
    feedback.version += 1
    audit.record(
        db,
        AuditEventType.FEEDBACK_EDITED,
        actor=actor,
        candidate_id=interview.application.candidate_id,
        metadata=_meta(interview, version=feedback.version),
        request_id=request_id,
    )
    db.commit()
    return _read(_mine(db, interview_id, actor.id), actor, interview)


def _read(feedback: InterviewFeedback, viewer: User, interview: Interview) -> dict:
    mine = feedback.interviewer_id == viewer.id
    return {
        "id": feedback.id,
        "interview_id": feedback.interview_id,
        "interviewer": _staff_ref(feedback.interviewer),
        "status": feedback.status,
        **{name: getattr(feedback, name) for name in CONTENT_FIELDS},
        "private_notes": feedback.private_notes if mine else None,
        "version": feedback.version,
        "submitted_at": feedback.submitted_at,
        "updated_at": feedback.updated_at,
        "is_mine": mine,
        "scrubbed": feedback.scrubbed_at is not None,
    }


def overview(db: Session, viewer: User, interview_id: uuid.UUID) -> dict:
    """Exactly what `viewer` may see: their own (draft or submitted), plus, for HR and admins, every
    submitted feedback. Nobody else's draft or private notes are ever returned."""
    interview = load_interview(db, interview_id)
    can_all = viewer.role in VIEW_ALL
    rows = db.scalars(
        select(InterviewFeedback)
        .where(InterviewFeedback.interview_id == interview_id)
        .options(joinedload(InterviewFeedback.interviewer))
        .order_by(InterviewFeedback.created_at)
    ).all()
    visible = [
        f
        for f in rows
        if f.interviewer_id == viewer.id or (can_all and f.status == FeedbackStatus.SUBMITTED)
    ]
    submitted_by = {f.interviewer_id for f in rows if f.status == FeedbackStatus.SUBMITTED}
    pending = [_staff_ref(i.user) for i in interview.interviewers if i.user_id not in submitted_by]
    return {
        "interview_id": interview_id,
        "items": [_read(f, viewer, interview) for f in visible],
        "can_view_all": can_all,
        "submitted_count": len(submitted_by),
        "pending_interviewers": pending,
    }


def revisions(
    db: Session, viewer: User, interview_id: uuid.UUID, feedback_id: uuid.UUID
) -> list[dict]:
    load_interview(db, interview_id)
    feedback = db.scalar(
        select(InterviewFeedback).where(
            InterviewFeedback.id == feedback_id, InterviewFeedback.interview_id == interview_id
        )
    )
    if feedback is None or not (
        feedback.interviewer_id == viewer.id
        or (viewer.role in VIEW_ALL and feedback.status == FeedbackStatus.SUBMITTED)
    ):
        raise NotFoundError("Feedback not found")  # same answer for "missing" and "not yours"
    rows = db.scalars(
        select(InterviewFeedbackRevision)
        .where(InterviewFeedbackRevision.feedback_id == feedback.id)
        .options(joinedload(InterviewFeedbackRevision.edited_by))
        .order_by(InterviewFeedbackRevision.version)
    )
    return [
        {
            "version": r.version,
            "snapshot": r.snapshot,
            "edit_reason": r.edit_reason,
            "edited_by": _staff_ref(r.edited_by),
            "created_at": r.created_at,
        }
        for r in rows
    ]


def count_submitted(db: Session) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(InterviewFeedback)
            .where(InterviewFeedback.status == FeedbackStatus.SUBMITTED)
        )
        or 0
    )
