"""Attendance and leave figures for the HR dashboard. Admin and HR Manager only: unlike recruitment
analytics, these describe the workforce, so recruiters do not get them."""

from fastapi import APIRouter, Depends

from app.api.deps import DbSession, require_roles
from app.models.user import UserRole
from app.schemas.workforce import WorkforceOverview
from app.services import workforce_analytics as service

router = APIRouter(
    prefix="/analytics",
    tags=["analytics"],
    dependencies=[Depends(require_roles(UserRole.ADMIN, UserRole.HR_MANAGER))],
)


@router.get("/workforce", response_model=WorkforceOverview)
def workforce(db: DbSession):
    return service.overview(db)
