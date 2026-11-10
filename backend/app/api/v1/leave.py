"""Leave.

Anyone signed in with a linked employee record can request leave and see their own requests and
balances. Only Admin and HR Manager decide requests, grant or adjust balances, and see other
people's leave; nobody can decide their own request. All of it is enforced here, not in the UI.
"""

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import CurrentUser, DbSession, require_roles
from app.core.exceptions import NotFoundError
from app.models.employee import Employee
from app.models.user import User, UserRole
from app.models.workforce import LeaveStatus
from app.schemas.workforce import (
    AdjustIn,
    AllocateIn,
    AllocateOut,
    CalendarOut,
    Decision,
    EmployeeBalances,
    LeaveEventRead,
    LeaveList,
    LeaveRead,
    LeaveStats,
    LeaveSubmit,
    LeaveTypeRead,
    LeaveTypeUpdate,
    LeaveTypeWrite,
    PreviewOut,
)
from app.services import attendance as attendance_service
from app.services import leave as service

router = APIRouter(prefix="/leave", tags=["leave"])

HR = (UserRole.ADMIN, UserRole.HR_MANAGER)
HrUser = Annotated[User, Depends(require_roles(*HR))]
_hr = Depends(require_roles(*HR))
Page = Annotated[int, Query(ge=1, le=100_000)]
Size = Annotated[int, Query(ge=1, le=100)]
Year = Annotated[int | None, Query(ge=2000, le=2100)]
Month = Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="YYYY-MM")]


# ---- leave types ---------------------------------------------------------------------------------


@router.get("/types", response_model=list[LeaveTypeRead])
def types(db: DbSession, user: CurrentUser, include_inactive: bool = False):
    include = include_inactive and user.role in HR
    return [service.type_read(t) for t in service.list_types(db, include_inactive=include)]


@router.post(
    "/types", response_model=LeaveTypeRead, status_code=status.HTTP_201_CREATED, dependencies=[_hr]
)
def create_type(db: DbSession, body: LeaveTypeWrite):
    return service.type_read(service.create_type(db, body))


@router.patch("/types/{type_id}", response_model=LeaveTypeRead, dependencies=[_hr])
def update_type(db: DbSession, type_id: uuid.UUID, body: LeaveTypeUpdate):
    return service.type_read(service.update_type(db, type_id, body))


# ---- balances ------------------------------------------------------------------------------------


@router.get("/balances/me", response_model=EmployeeBalances)
def my_balances(db: DbSession, user: CurrentUser, year: Year = None):
    employee = attendance_service.linked_employee(db, user)
    return service.balances_for(db, employee, year or service.current_year(db))


@router.get("/balances", response_model=EmployeeBalances, dependencies=[_hr])
def balances(db: DbSession, employee_id: uuid.UUID, year: Year = None):
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise NotFoundError("Employee not found")
    return service.balances_for(db, employee, year or service.current_year(db))


@router.post("/balances/allocate", response_model=AllocateOut)
def allocate(db: DbSession, actor: HrUser, body: AllocateIn):
    return service.allocate(db, actor, body)


@router.post("/balances/adjust", response_model=EmployeeBalances)
def adjust(db: DbSession, actor: HrUser, body: AdjustIn):
    return service.adjust(db, actor, body)


# ---- requests ------------------------------------------------------------------------------------


@router.get("/preview", response_model=PreviewOut)
def preview(db: DbSession, user: CurrentUser, start_date: date, end_date: date):
    return service.preview(db, start_date, end_date)


@router.post("/requests", response_model=LeaveRead, status_code=status.HTTP_201_CREATED)
def submit(db: DbSession, user: CurrentUser, body: LeaveSubmit):
    return service.submit(db, user, body)


@router.get("/requests/me", response_model=LeaveList)
def my_requests(
    db: DbSession,
    user: CurrentUser,
    status_: Annotated[LeaveStatus | None, Query(alias="status")] = None,
    page: Page = 1,
    page_size: Size = 20,
):
    employee = attendance_service.linked_employee(db, user)
    return service.list_requests(
        db, user, employee_id=employee.id, status=status_, type_id=None, start=None, end=None,
        page=page, page_size=page_size,
    )  # fmt: skip


@router.get("/requests", response_model=LeaveList, dependencies=[_hr])
def requests(
    db: DbSession,
    user: CurrentUser,
    employee_id: uuid.UUID | None = None,
    status_: Annotated[LeaveStatus | None, Query(alias="status")] = None,
    type_id: uuid.UUID | None = None,
    start: date | None = None,
    end: date | None = None,
    page: Page = 1,
    page_size: Size = 20,
):
    return service.list_requests(
        db, user, employee_id=employee_id, status=status_, type_id=type_id, start=start, end=end,
        page=page, page_size=page_size,
    )  # fmt: skip


@router.get("/requests/{request_id}", response_model=LeaveRead)
def get_request(db: DbSession, user: CurrentUser, request_id: uuid.UUID):
    return service.view(db, user, request_id)


@router.get("/requests/{request_id}/history", response_model=list[LeaveEventRead])
def request_history(db: DbSession, user: CurrentUser, request_id: uuid.UUID):
    return service.history(db, user, request_id)


@router.post("/requests/{request_id}/approve", response_model=LeaveRead)
def approve(db: DbSession, actor: HrUser, request_id: uuid.UUID, body: Decision | None = None):
    return service.approve(db, actor, request_id, body.reason if body else "")


@router.post("/requests/{request_id}/reject", response_model=LeaveRead)
def reject(db: DbSession, actor: HrUser, request_id: uuid.UUID, body: Decision):
    return service.reject(db, actor, request_id, body.reason)


@router.post("/requests/{request_id}/withdraw", response_model=LeaveRead)
def withdraw(db: DbSession, user: CurrentUser, request_id: uuid.UUID):
    return service.withdraw(db, user, request_id)


@router.post("/requests/{request_id}/cancel", response_model=LeaveRead)
def cancel(db: DbSession, user: CurrentUser, request_id: uuid.UUID, body: Decision | None = None):
    return service.cancel(db, user, request_id, body.reason if body else "")


# ---- calendar and statistics ---------------------------------------------------------------------


@router.get("/calendar", response_model=CalendarOut)
def calendar(db: DbSession, user: CurrentUser, month: Month):
    return service.calendar(db, user, month)


@router.get("/stats", response_model=LeaveStats, dependencies=[_hr])
def stats(db: DbSession):
    return service.stats(db)
