"""Requirements Coverage endpoints.

Who may do what (enforced here on the server; the UI only mirrors it):
  create, view, review ............ admin, hr_manager, recruiter
  employees ....................... no access at all
Recruiters see every application today (assignment only limits who may ASSIGN), so the same applies
here. Nothing on this router changes an application's stage, and no endpoint accepts a sort or
filter based on a figure: the job overview is always ordered by application date.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import DbSession, RequestId, require_roles
from app.models.user import User, UserRole
from app.schemas.screening import (
    ApplicationScreeningRead,
    AssessmentRead,
    JobScreeningRead,
    MethodologyRead,
    ReviewCreate,
)
from app.services import screening_service as service
from app.services.screening import methodology

router = APIRouter(tags=["screening"])

STAFF = (UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER)
StaffUser = Annotated[User, Depends(require_roles(*STAFF))]


@router.get(
    "/screening/methodology",
    response_model=MethodologyRead,
    dependencies=[Depends(require_roles(*STAFF))],
)
def get_methodology():
    return methodology()


@router.post(
    "/applications/{application_id}/screening",
    response_model=AssessmentRead,
    status_code=status.HTTP_201_CREATED,
)
def create_assessment(
    application_id: uuid.UUID,
    response: Response,
    db: DbSession,
    actor: StaffUser,
    request_id: RequestId,
):
    result = service.create_assessment(db, actor, application_id, request_id)
    if not result["created"]:
        response.status_code = status.HTTP_200_OK  # the identical assessment already existed
    return result


@router.get(
    "/applications/{application_id}/screening",
    response_model=ApplicationScreeningRead,
    dependencies=[Depends(require_roles(*STAFF))],
)
def list_assessments(application_id: uuid.UUID, db: DbSession):
    return service.list_for_application(db, application_id)


@router.get("/screening/{assessment_id}", response_model=AssessmentRead)
def get_assessment(
    assessment_id: uuid.UUID, db: DbSession, actor: StaffUser, request_id: RequestId
):
    return service.get_assessment(db, actor, assessment_id, request_id)


@router.post(
    "/screening/{assessment_id}/reviews",
    response_model=AssessmentRead,
    status_code=status.HTTP_201_CREATED,
)
def add_review(
    assessment_id: uuid.UUID,
    payload: ReviewCreate,
    db: DbSession,
    actor: StaffUser,
    request_id: RequestId,
):
    return service.add_review(db, actor, assessment_id, payload, request_id)


@router.get(
    "/jobs/{job_id}/screening",
    response_model=JobScreeningRead,
    dependencies=[Depends(require_roles(*STAFF))],
)
def job_overview(
    job_id: uuid.UUID,
    db: DbSession,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
):
    # No sort, order or filter parameters exist: applicants are always listed by application date.
    return service.job_overview(db, job_id, page, page_size)
