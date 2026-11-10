import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import DbSession, RequestId, require_roles
from app.models.candidate import CandidateSource
from app.models.user import User, UserRole
from app.schemas.candidate import (
    CandidateCreate,
    CandidateList,
    CandidateRead,
    CandidateUpdate,
    RetentionFilter,
)
from app.schemas.privacy import (
    AnonymizationPreview,
    AnonymizeRequest,
    AnonymizeResult,
    BulkExportRequest,
    ExportRequest,
)
from app.services import candidate as service
from app.services import export as export_service
from app.services import privacy as privacy_service

router = APIRouter(prefix="/candidates", tags=["candidates"])

# Who may do what (enforced here on the server; the UI only mirrors it):
#   read / create / edit ..... admin, hr_manager, recruiter
#   delete (by mistake) ...... admin, hr_manager
#   export, anonymize ........ admin, hr_manager   (privacy actions are wider than recruiting)
# The employee role has no access to candidate data at all.
READ = (UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER)
WRITE = (UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER)
DELETE = (UserRole.ADMIN, UserRole.HR_MANAGER)
PRIVACY = (UserRole.ADMIN, UserRole.HR_MANAGER)

_write_user = require_roles(*WRITE)
WriteUser = Annotated[User, Depends(_write_user)]
ReadUser = Annotated[User, Depends(require_roles(*READ))]
DeleteUser = Annotated[User, Depends(require_roles(*DELETE))]
PrivacyUser = Annotated[User, Depends(require_roles(*PRIVACY))]


def _file(result: tuple[bytes, str, str]) -> Response:
    body, content_type, filename = result
    return Response(
        content=body,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


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
def create_candidate(
    payload: CandidateCreate, db: DbSession, actor: WriteUser, request_id: RequestId
):
    return service.create_candidate(db, actor, payload, request_id)


# Declared before "/{candidate_id}" routes so "export" is never parsed as an ID. POST (not GET)
# keeps the filters out of URLs and logs, and the response is never cached.
@router.post("/export")
def export_candidates(
    payload: BulkExportRequest, db: DbSession, actor: PrivacyUser, request_id: RequestId
):
    return _file(
        export_service.export_many(
            db,
            actor,
            payload.format,
            source=payload.source,
            retention=payload.retention,
            request_id=request_id,
        )
    )


@router.get("/{candidate_id}", response_model=CandidateRead)
def get_candidate(candidate_id: uuid.UUID, db: DbSession, actor: ReadUser, request_id: RequestId):
    return service.view_candidate(db, actor, candidate_id, request_id)


@router.patch("/{candidate_id}", response_model=CandidateRead)
def update_candidate(
    candidate_id: uuid.UUID,
    payload: CandidateUpdate,
    db: DbSession,
    actor: WriteUser,
    request_id: RequestId,
):
    return service.update_candidate(db, actor, candidate_id, payload, request_id)


@router.delete("/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_candidate(
    candidate_id: uuid.UUID, db: DbSession, actor: DeleteUser, request_id: RequestId
):
    service.delete_candidate(db, actor, candidate_id, request_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{candidate_id}/export")
def export_candidate(
    candidate_id: uuid.UUID,
    payload: ExportRequest,
    db: DbSession,
    actor: PrivacyUser,
    request_id: RequestId,
):
    return _file(export_service.export_one(db, actor, candidate_id, payload.format, request_id))


@router.get(
    "/{candidate_id}/anonymization-preview",
    response_model=AnonymizationPreview,
    dependencies=[Depends(require_roles(*PRIVACY))],
)
def anonymization_preview(candidate_id: uuid.UUID, db: DbSession):
    return privacy_service.anonymization_preview(db, candidate_id)


@router.post("/{candidate_id}/anonymize", response_model=AnonymizeResult)
def anonymize_candidate(
    candidate_id: uuid.UUID,
    payload: AnonymizeRequest,
    db: DbSession,
    actor: PrivacyUser,
    request_id: RequestId,
):
    candidate, changed = privacy_service.anonymize_candidate(db, actor, candidate_id, request_id)
    return AnonymizeResult(candidate=candidate, changed=changed)
