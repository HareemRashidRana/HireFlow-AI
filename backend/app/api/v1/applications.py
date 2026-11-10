import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbSession, require_roles
from app.models.application import ApplicationStage
from app.models.candidate import CandidateSource
from app.models.user import User, UserRole
from app.schemas.application import (
    ApplicationCreate,
    ApplicationList,
    ApplicationRead,
    ApplicationSummary,
    ApplicationUpdate,
    Board,
    BoardColumn,
    ReopenRequest,
    StaffSummary,
    StageChange,
)
from app.services import application as service

router = APIRouter(prefix="/applications", tags=["applications"])

# Who may do what (enforced on the server; the UI only mirrors it):
#   read, create, edit notes, move between normal stages, reject, withdraw ... admin, hr, recruiter
#   mark as hired, reopen a rejected / withdrawn application ................. admin, hr
#   assign anyone ............................................................ admin, hr
#   assign to themselves only ................................................ recruiter
# The employee role has no access to recruitment data at all. Applications are never deleted.
READ = (UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER)
WRITE = (UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER)
HR = (UserRole.ADMIN, UserRole.HR_MANAGER)

ReadUser = Annotated[User, Depends(require_roles(*READ))]
WriteUser = Annotated[User, Depends(require_roles(*WRITE))]
HrUser = Annotated[User, Depends(require_roles(*HR))]


@router.get("", response_model=ApplicationList)
def list_applications(
    db: DbSession,
    actor: ReadUser,
    q: Annotated[
        str | None, Query(max_length=100, description="Candidate name or email, or job title")
    ] = None,
    job_id: uuid.UUID | None = None,
    candidate_id: uuid.UUID | None = None,
    stage: ApplicationStage | None = None,
    recruiter_id: uuid.UUID | None = None,
    source: CandidateSource | None = None,
    applied_from: date | None = None,
    applied_to: date | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    items, total, counts = service.list_applications(
        db,
        actor,
        q=q,
        job_id=job_id,
        candidate_id=candidate_id,
        stage=stage,
        recruiter_id=recruiter_id,
        source=source,
        applied_from=applied_from,
        applied_to=applied_to,
        page=page,
        page_size=page_size,
    )
    return ApplicationList(
        items=items, total=total, page=page, page_size=page_size, stage_counts=counts
    )


# Fixed paths are declared before "/{application_id}" so they are not parsed as an ID.
@router.get("/board", response_model=Board)
def pipeline_board(
    db: DbSession,
    actor: ReadUser,
    q: Annotated[str | None, Query(max_length=100)] = None,
    job_id: uuid.UUID | None = None,
    recruiter_id: uuid.UUID | None = None,
    source: CandidateSource | None = None,
):
    columns = service.board(db, actor, q=q, job_id=job_id, recruiter_id=recruiter_id, source=source)
    return Board(
        columns={s: BoardColumn(total=t, items=items) for s, (t, items) in columns.items()},
        per_column_limit=service.BOARD_COLUMN_LIMIT,
    )


@router.get(
    "/summary",
    response_model=ApplicationSummary,
    dependencies=[Depends(require_roles(*READ))],
)
def application_summary(db: DbSession):
    return service.summary(db)


@router.get(
    "/recruiters",
    response_model=list[StaffSummary],
    dependencies=[Depends(require_roles(*READ))],
)
def list_recruiters(db: DbSession):
    return service.list_recruiters(db)


@router.post("", response_model=ApplicationRead, status_code=status.HTTP_201_CREATED)
def create_application(payload: ApplicationCreate, db: DbSession, actor: WriteUser):
    return service.create_application(db, actor, payload)


@router.get("/{application_id}", response_model=ApplicationRead)
def get_application(application_id: uuid.UUID, db: DbSession, actor: ReadUser):
    return service.get_application(db, application_id, actor)


@router.patch("/{application_id}", response_model=ApplicationRead)
def update_application(
    application_id: uuid.UUID, payload: ApplicationUpdate, db: DbSession, actor: WriteUser
):
    return service.update_application(db, actor, application_id, payload)


@router.post("/{application_id}/stage", response_model=ApplicationRead)
def change_stage(application_id: uuid.UUID, payload: StageChange, db: DbSession, actor: WriteUser):
    return service.change_stage(db, actor, application_id, payload.stage, payload.note)


@router.post("/{application_id}/reopen", response_model=ApplicationRead)
def reopen_application(
    application_id: uuid.UUID, payload: ReopenRequest, db: DbSession, actor: HrUser
):
    return service.reopen(db, actor, application_id, payload.note)
