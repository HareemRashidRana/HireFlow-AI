"""Company working rules (one settings row) and the holiday calendar. HR and admin change them;
everyone signed in may read them (they are needed to understand one's own attendance and leave)."""

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import security
from app.core.exceptions import ConflictError, NotFoundError
from app.models.user import User
from app.models.workforce import Holiday, WorkSettings
from app.schemas.workforce import HolidayCreate, WorkSettingsUpdate


def get_settings(db: Session) -> WorkSettings:
    """The working rules. The migration inserts the default row; if it is ever missing (a fresh
    test database) it is created with the same defaults."""
    row = db.get(WorkSettings, 1)
    if row is None:
        row = WorkSettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def update_settings(db: Session, actor: User, data: WorkSettingsUpdate) -> WorkSettings:
    row = get_settings(db)
    row.timezone = data.timezone
    row.work_days = list(data.work_days)
    row.work_start = data.work_start
    row.work_end = data.work_end
    row.grace_minutes = data.grace_minutes
    row.max_backdate_days = data.max_backdate_days
    row.updated_by_id = actor.id
    row.updated_at = security.utcnow()
    db.commit()
    db.refresh(row)
    return row


def holiday_dates(db: Session, start: date, end: date) -> set[date]:
    rows = db.scalars(select(Holiday.day).where(Holiday.day >= start, Holiday.day <= end))
    return set(rows)


def holiday_name(db: Session, day: date) -> str | None:
    return db.scalar(select(Holiday.name).where(Holiday.day == day))


def list_holidays(
    db: Session, *, year: int | None = None, start: date | None = None, end: date | None = None
) -> list[Holiday]:
    stmt = select(Holiday).order_by(Holiday.day)
    if year is not None:
        stmt = stmt.where(Holiday.day >= date(year, 1, 1), Holiday.day <= date(year, 12, 31))
    if start is not None:
        stmt = stmt.where(Holiday.day >= start)
    if end is not None:
        stmt = stmt.where(Holiday.day <= end)
    return list(db.scalars(stmt))


def add_holiday(db: Session, actor: User, data: HolidayCreate) -> Holiday:
    holiday = Holiday(day=data.day, name=data.name, created_by_id=actor.id)
    db.add(holiday)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("There is already a holiday on that date.") from None
    return holiday


def delete_holiday(db: Session, holiday_id: uuid.UUID) -> None:
    """Removing a holiday never changes leave that was already approved: those day counts are
    frozen when the request is submitted."""
    holiday = db.get(Holiday, holiday_id)
    if holiday is None:
        raise NotFoundError("Holiday not found")
    db.delete(holiday)
    db.commit()
