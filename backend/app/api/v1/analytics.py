"""Recruitment analytics (read-only). Admin, HR manager and recruiter; the employee role has none.

Recruiters can already read every application, job and the employee directory, so the aggregates
reveal nothing new to them. Responses carry counts only: never names, emails, notes or feedback.
"""

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import DbSession, require_roles
from app.models.user import UserRole
from app.schemas.analytics import FilterOptions, JobPerformanceList, Overview
from app.services import analytics as service

router = APIRouter(
    prefix="/analytics",
    tags=["analytics"],
    dependencies=[Depends(require_roles(UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER))],
)

Start = Annotated[date | None, Query(description="First day (inclusive); default 30 days ago")]
End = Annotated[date | None, Query(description="Last day (inclusive); default today")]
Zone = Annotated[str, Query(max_length=64, description="IANA time zone for the day boundaries")]
JobId = Annotated[uuid.UUID | None, Query(description="Only this job")]
Department = Annotated[str | None, Query(max_length=100, description="Only this department")]


@router.get("/overview", response_model=Overview)
def overview(
    db: DbSession,
    start: Start = None,
    end: End = None,
    timezone: Zone = "UTC",
    job_id: JobId = None,
    department: Department = None,
):
    scope = service.make_scope(
        db, start=start, end=end, timezone=timezone, job_id=job_id, department=department
    )
    return service.overview(db, scope)


@router.get("/jobs", response_model=JobPerformanceList)
def jobs(
    db: DbSession,
    start: Start = None,
    end: End = None,
    timezone: Zone = "UTC",
    job_id: JobId = None,
    department: Department = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 10,
):
    scope = service.make_scope(
        db, start=start, end=end, timezone=timezone, job_id=job_id, department=department
    )
    return service.job_performance(db, scope, page=page, page_size=page_size)


@router.get("/filter-options", response_model=FilterOptions)
def filter_options(db: DbSession):
    return service.filter_options(db)
