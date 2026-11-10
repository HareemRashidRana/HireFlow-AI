"""Working rules and the holiday calendar. Anyone signed in can read them; only Admin and HR Manager
change them."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import CurrentUser, DbSession, require_roles
from app.models.user import User, UserRole
from app.schemas.workforce import (
    HolidayCreate,
    HolidayRead,
    WorkSettingsRead,
    WorkSettingsUpdate,
)
from app.services import work_config as service

router = APIRouter(tags=["work-config"])

HrUser = Annotated[User, Depends(require_roles(UserRole.ADMIN, UserRole.HR_MANAGER))]


@router.get("/work-settings", response_model=WorkSettingsRead)
def get_settings(db: DbSession, user: CurrentUser):
    return service.get_settings(db)


@router.put("/work-settings", response_model=WorkSettingsRead)
def update_settings(db: DbSession, actor: HrUser, body: WorkSettingsUpdate):
    return service.update_settings(db, actor, body)


@router.get("/holidays", response_model=list[HolidayRead])
def holidays(db: DbSession, user: CurrentUser, year: Annotated[int, Query(ge=2000, le=2100)]):
    return [
        {"id": h.id, "day": h.day, "name": h.name} for h in service.list_holidays(db, year=year)
    ]


@router.post("/holidays", response_model=HolidayRead, status_code=status.HTTP_201_CREATED)
def add_holiday(db: DbSession, actor: HrUser, body: HolidayCreate):
    h = service.add_holiday(db, actor, body)
    return {"id": h.id, "day": h.day, "name": h.name}


@router.delete("/holidays/{holiday_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_holiday(db: DbSession, actor: HrUser, holiday_id: uuid.UUID):
    service.delete_holiday(db, holiday_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
