import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import DbSession, RequestId, require_roles
from app.models.audit import AuditEventType
from app.models.user import User, UserRole
from app.schemas.privacy import (
    AuditList,
    PurgeRequest,
    PurgeResult,
    RetentionList,
    RetentionStatus,
)
from app.services import audit as audit_service
from app.services import privacy as service

router = APIRouter(prefix="/privacy", tags=["privacy"])

# Who may do what (enforced on the server; the UI only mirrors it):
#   retention review, audit trail, purge PREVIEW .... admin, hr_manager
#   purge for real .................................. admin only (and only if PRIVACY_PURGE_ENABLED)
# Recruiters and employees have no access to any of this.
PRIVACY = (UserRole.ADMIN, UserRole.HR_MANAGER)

PrivacyUser = Annotated[User, Depends(require_roles(*PRIVACY))]


@router.get("/retention", response_model=RetentionList)
def retention(
    db: DbSession,
    actor: PrivacyUser,
    status: RetentionStatus = RetentionStatus.ALL,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    items, total = service.list_retention(db, status=status, page=page, page_size=page_size)
    return RetentionList(
        summary=service.retention_summary(db),
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/audit", response_model=AuditList, response_model_by_alias=True)
def audit_trail(
    db: DbSession,
    actor: PrivacyUser,
    candidate_id: uuid.UUID | None = None,
    event_type: AuditEventType | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    items, total = audit_service.list_events(
        db, candidate_id=candidate_id, event_type=event_type, page=page, page_size=page_size
    )
    return AuditList(items=items, total=total, page=page, page_size=page_size)


@router.post("/purge", response_model=PurgeResult)
def purge(payload: PurgeRequest, db: DbSession, actor: PrivacyUser, request_id: RequestId):
    return service.purge(
        db,
        actor,
        dry_run=payload.dry_run,
        confirm=payload.confirm,
        limit=payload.limit,
        request_id=request_id,
    )
