"""Attendance. Every signed-in person with a linked employee record can check in and out and read
their OWN history. Only Admin and HR Manager see anyone else's, view statistics or make corrections.
Employees can never edit a record: there is no route for it."""

import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import CurrentUser, DbSession, require_roles
from app.models.user import User, UserRole
from app.schemas.workforce import (
    AttendanceCreate,
    AttendanceList,
    AttendanceRead,
    AttendanceStats,
    AttendanceUpdate,
    CorrectionRead,
    MonthSummary,
    TodayStatus,
)
from app.services import attendance as service

router = APIRouter(prefix="/attendance", tags=["attendance"])

HR = (UserRole.ADMIN, UserRole.HR_MANAGER)
HrUser = Annotated[User, Depends(require_roles(*HR))]
Page = Annotated[int, Query(ge=1, le=100_000)]
Size = Annotated[int, Query(ge=1, le=100)]
Month = Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="YYYY-MM")]


# ---- self-service (own record only; the employee is always taken from the login) ----------------


@router.get("/me/today", response_model=TodayStatus)
def my_today(db: DbSession, user: CurrentUser):
    return service.today_status(db, user)


@router.post("/check-in", response_model=AttendanceRead, status_code=status.HTTP_201_CREATED)
def check_in(db: DbSession, user: CurrentUser):
    return service.check_in(db, user)


@router.post("/check-out", response_model=AttendanceRead)
def check_out(db: DbSession, user: CurrentUser):
    return service.check_out(db, user)


@router.get("/me/records", response_model=AttendanceList)
def my_records(
    db: DbSession,
    user: CurrentUser,
    start: date | None = None,
    end: date | None = None,
    late: bool | None = None,
    page: Page = 1,
    page_size: Size = 20,
):
    employee = service.linked_employee(db, user)
    return service.list_records(
        db, employee_id=employee.id, start=start, end=end, late=late, state=None,
        department=None, page=page, page_size=page_size,
    )  # fmt: skip


@router.get("/me/summary", response_model=MonthSummary)
def my_summary(db: DbSession, user: CurrentUser, month: Month):
    employee = service.linked_employee(db, user)
    return service.month_summary(db, month=month, employee_id=employee.id, page=1, page_size=1)


# ---- HR ------------------------------------------------------------------------------------------


@router.get("/stats", response_model=AttendanceStats, dependencies=[Depends(require_roles(*HR))])
def stats(db: DbSession, day: Annotated[date | None, Query(alias="date")] = None):
    return service.stats(db, day)


@router.get("/records", response_model=AttendanceList, dependencies=[Depends(require_roles(*HR))])
def records(
    db: DbSession,
    employee_id: uuid.UUID | None = None,
    start: date | None = None,
    end: date | None = None,
    late: bool | None = None,
    state: Literal["open", "closed"] | None = None,
    department: Annotated[str | None, Query(max_length=100)] = None,
    page: Page = 1,
    page_size: Size = 20,
):
    return service.list_records(
        db, employee_id=employee_id, start=start, end=end, late=late, state=state,
        department=department, page=page, page_size=page_size,
    )  # fmt: skip


@router.get("/summary", response_model=MonthSummary, dependencies=[Depends(require_roles(*HR))])
def summary(
    db: DbSession,
    month: Month,
    employee_id: uuid.UUID | None = None,
    page: Page = 1,
    page_size: Size = 25,
):
    return service.month_summary(
        db, month=month, employee_id=employee_id, page=page, page_size=page_size
    )


@router.post("/records", response_model=AttendanceRead, status_code=status.HTTP_201_CREATED)
def add_record(db: DbSession, actor: HrUser, body: AttendanceCreate):
    return service.hr_create(db, actor, body)


@router.patch("/records/{record_id}", response_model=AttendanceRead)
def correct_record(db: DbSession, actor: HrUser, record_id: uuid.UUID, body: AttendanceUpdate):
    return service.hr_update(db, actor, record_id, body)


@router.get(
    "/records/{record_id}/corrections",
    response_model=list[CorrectionRead],
    dependencies=[Depends(require_roles(*HR))],
)
def record_corrections(db: DbSession, record_id: uuid.UUID):
    return service.corrections(db, record_id)
