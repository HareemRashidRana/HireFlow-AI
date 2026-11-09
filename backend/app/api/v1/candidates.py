import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import DbSession, require_roles
from app.models.candidate import CandidateSource
from app.models.user import User, UserRole
from app.schemas.candidate import (
    CandidateCreate,
    CandidateList,
    CandidateRead,
    CandidateUpdate,
    RetentionFilter,
)
from app.services import candidate as service

router = APIRouter(prefix="/candidates", tags=["candidates"])

# Who may do what (enforced here on the server; the UI only mirrors it):
#   read / create / edit ..... admin, hr_manager, recruiter
#   delete ................... admin, hr_manager
# The employee role has no access to candidate data at all.
READ = (UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER)
WRITE = (UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER)
DELETE = (UserRole.ADMIN, UserRole.HR_MANAGER)

_write_user = require_roles(*WRITE)
WriteUser = Annotated[User, Depends(_write_user)]


@router.get("", response_model=CandidateList, dependencies=[Depends(require_roles(*READ))])
def list_candidates(
    db: DbSession,
    q: Annotated[
        str | None, Query(max_length=100, description="Search name, email, title or company")
    ] = None,
    source: CandidateSource | None = None,
    email: Annotated[str | None, Query(max_length=255, description="Exact email match")] = None,
    retention: RetentionFilter | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    items, total = service.list_candidates(
        db, q=q, source=source, email=email, retention=retention, page=page, page_size=page_size
    )
    return CandidateList(items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=CandidateRead, status_code=status.HTTP_201_CREATED)
def create_candidate(payload: CandidateCreate, db: DbSession, actor: WriteUser):
    return service.create_candidate(db, actor, payload)


@router.get(
    "/{candidate_id}", response_model=CandidateRead, dependencies=[Depends(require_roles(*READ))]
)
def get_candidate(candidate_id: uuid.UUID, db: DbSession):
    return service.get_candidate(db, candidate_id)


@router.patch("/{candidate_id}", response_model=CandidateRead, dependencies=[Depends(_write_user)])
def update_candidate(candidate_id: uuid.UUID, payload: CandidateUpdate, db: DbSession):
    return service.update_candidate(db, candidate_id, payload)


@router.delete(
    "/{candidate_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(*DELETE))],
)
def delete_candidate(candidate_id: uuid.UUID, db: DbSession):
    service.delete_candidate(db, candidate_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
