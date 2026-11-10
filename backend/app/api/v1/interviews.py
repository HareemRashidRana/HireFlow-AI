"""Interview endpoints.

Who may do what (enforced here on the server; the UI only mirrors it):
  schedule, edit, confirm, complete, cancel, reschedule, manage interviewers, view, list,
  statistics, history ........................... admin, hr_manager, recruiter
  write feedback ................................ only an assigned interviewer, for their own
  read submitted feedback ....................... its author, hr_manager, admin
  read drafts and private notes ................. the author only
The employee role has no access at all. Nothing here changes an application's stage, and no endpoint
sorts or ranks by a score (interviews are ordered by their start time only).
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import DbSession, RequestId, require_roles
from app.core.exceptions import NotFoundError
from app.models.application import Application
from app.models.interview import InterviewStatus, InterviewType
from app.models.user import User, UserRole
from app.schemas.interview import (
    CancelRequest,
    EventRead,
    FeedbackContent,
    FeedbackEdit,
    FeedbackOverview,
    FeedbackRead,
    FeedbackSubmit,
    InterviewCreate,
    InterviewerAdd,
    InterviewList,
    InterviewRead,
    InterviewStats,
    InterviewUpdate,
    RatingScale,
    RescheduleRequest,
    RevisionRead,
    StaffRef,
)
from app.services import interview as service
from app.services import interview_feedback as feedback_service
from app.services import interview_rules as rules

router = APIRouter(tags=["interviews"])

STAFF = (UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER)
StaffUser = Annotated[User, Depends(require_roles(*STAFF))]
_staff = Depends(require_roles(*STAFF))


# ---- reference data (declared before /{interview_id} so the words are not read as ids) -------


@router.get("/interviews/rating-scale", response_model=RatingScale, dependencies=[_staff])
def rating_scale():
    return {"scale": list(rules.RATING_SCALE), "areas": list(rules.RATING_AREAS)}


@router.get("/interviews/stats", response_model=InterviewStats, dependencies=[_staff])
def stats(db: DbSession):
    return service.stats(db)


@router.get("/interviews/interviewers", response_model=list[StaffRef], dependencies=[_staff])
def assignable_interviewers(db: DbSession):
    return service.assignable_staff(db)


# ---- interviews ------------------------------------------------------------------------------


@router.get("/interviews", response_model=InterviewList)
def list_interviews(
    db: DbSession,
    actor: StaffUser,
    q: Annotated[
        str | None, Query(max_length=100, description="Interview, candidate or job title")
    ] = None,
    application_id: uuid.UUID | None = None,
    job_id: uuid.UUID | None = None,
    interviewer_id: Annotated[str | None, Query(description="A user id, or 'me'")] = None,
    status_: Annotated[InterviewStatus | None, Query(alias="status")] = None,
    interview_type: InterviewType | None = None,
    starts_from: datetime | None = None,
    starts_to: datetime | None = None,
    order: Literal["asc", "desc"] = "asc",  # by start time only
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    who: uuid.UUID | None = None
    if interviewer_id:
        who = actor.id if interviewer_id == "me" else _uuid(interviewer_id)
    items, total = service.list_interviews(
        db,
        actor,
        page=page,
        page_size=page_size,
        newest_first=order == "desc",
        q=q,
        application_id=application_id,
        job_id=job_id,
        interviewer_id=who,
        status=status_,
        interview_type=interview_type,
        starts_from=starts_from,
        starts_to=starts_to,
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def _uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise NotFoundError("Interviewer not found") from None


@router.post("/interviews", response_model=InterviewRead, status_code=status.HTTP_201_CREATED)
def create_interview(
    payload: InterviewCreate, db: DbSession, actor: StaffUser, request_id: RequestId
):
    return service.create_interview(db, actor, payload, request_id)


@router.get("/applications/{application_id}/interviews", response_model=InterviewList)
def interviews_for_application(
    application_id: uuid.UUID,
    db: DbSession,
    actor: StaffUser,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
):
    if db.get(Application, application_id) is None:
        raise NotFoundError("Application not found")
    items, total = service.list_interviews(
        db, actor, application_id=application_id, page_size=page_size
    )
    return {"items": items, "total": total, "page": 1, "page_size": page_size}


@router.get("/interviews/{interview_id}", response_model=InterviewRead)
def get_interview(interview_id: uuid.UUID, db: DbSession, actor: StaffUser):
    return service.get_read(db, actor, interview_id)


@router.patch("/interviews/{interview_id}", response_model=InterviewRead)
def update_interview(
    interview_id: uuid.UUID,
    payload: InterviewUpdate,
    db: DbSession,
    actor: StaffUser,
    request_id: RequestId,
):
    return service.update_interview(db, actor, interview_id, payload, request_id)


@router.post("/interviews/{interview_id}/confirm", response_model=InterviewRead)
def confirm(interview_id: uuid.UUID, db: DbSession, actor: StaffUser, request_id: RequestId):
    return service.confirm(db, actor, interview_id, request_id)


@router.post("/interviews/{interview_id}/complete", response_model=InterviewRead)
def complete(interview_id: uuid.UUID, db: DbSession, actor: StaffUser, request_id: RequestId):
    return service.complete(db, actor, interview_id, request_id)


@router.post("/interviews/{interview_id}/cancel", response_model=InterviewRead)
def cancel(
    interview_id: uuid.UUID,
    payload: CancelRequest,
    db: DbSession,
    actor: StaffUser,
    request_id: RequestId,
):
    return service.cancel(db, actor, interview_id, payload.reason, request_id)


@router.post(
    "/interviews/{interview_id}/reschedule",
    response_model=InterviewRead,
    status_code=status.HTTP_201_CREATED,
)
def reschedule(
    interview_id: uuid.UUID,
    payload: RescheduleRequest,
    db: DbSession,
    actor: StaffUser,
    request_id: RequestId,
):
    """Returns the NEW interview. The original stays, marked `rescheduled`, with its history."""
    return service.reschedule(db, actor, interview_id, payload, request_id)


@router.post(
    "/interviews/{interview_id}/interviewers",
    response_model=InterviewRead,
    status_code=status.HTTP_201_CREATED,
)
def add_interviewer(
    interview_id: uuid.UUID,
    payload: InterviewerAdd,
    db: DbSession,
    actor: StaffUser,
    request_id: RequestId,
):
    return service.add_interviewer(db, actor, interview_id, payload.user_id, request_id)


@router.delete("/interviews/{interview_id}/interviewers/{user_id}", response_model=InterviewRead)
def remove_interviewer(
    interview_id: uuid.UUID,
    user_id: uuid.UUID,
    db: DbSession,
    actor: StaffUser,
    request_id: RequestId,
):
    return service.remove_interviewer(db, actor, interview_id, user_id, request_id)


@router.get(
    "/interviews/{interview_id}/history", response_model=list[EventRead], dependencies=[_staff]
)
def interview_history(interview_id: uuid.UUID, db: DbSession):
    return service.history(db, interview_id)


# ---- feedback --------------------------------------------------------------------------------


@router.get("/interviews/{interview_id}/feedback", response_model=FeedbackOverview)
def feedback_overview(interview_id: uuid.UUID, db: DbSession, actor: StaffUser):
    return feedback_service.overview(db, actor, interview_id)


@router.put("/interviews/{interview_id}/feedback", response_model=FeedbackRead)
def save_feedback_draft(
    interview_id: uuid.UUID,
    payload: FeedbackContent,
    db: DbSession,
    actor: StaffUser,
    request_id: RequestId,
):
    return feedback_service.save_draft(db, actor, interview_id, payload, request_id)


@router.post(
    "/interviews/{interview_id}/feedback/submit",
    response_model=FeedbackRead,
    status_code=status.HTTP_201_CREATED,
)
def submit_feedback(
    interview_id: uuid.UUID,
    payload: FeedbackSubmit,
    db: DbSession,
    actor: StaffUser,
    request_id: RequestId,
):
    return feedback_service.submit(db, actor, interview_id, payload, request_id)


@router.patch("/interviews/{interview_id}/feedback", response_model=FeedbackRead)
def edit_feedback(
    interview_id: uuid.UUID,
    payload: FeedbackEdit,
    db: DbSession,
    actor: StaffUser,
    request_id: RequestId,
):
    return feedback_service.edit_submitted(db, actor, interview_id, payload, request_id)


@router.get(
    "/interviews/{interview_id}/feedback/{feedback_id}/revisions", response_model=list[RevisionRead]
)
def feedback_revisions(
    interview_id: uuid.UUID, feedback_id: uuid.UUID, db: DbSession, actor: StaffUser
):
    return feedback_service.revisions(db, actor, interview_id, feedback_id)


@router.delete(
    "/interviews/{interview_id}",
    status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
    include_in_schema=False,
)
def no_delete(interview_id: uuid.UUID):
    """Interviews are cancelled, never deleted: the history must survive."""
    return Response(status_code=status.HTTP_405_METHOD_NOT_ALLOWED)
