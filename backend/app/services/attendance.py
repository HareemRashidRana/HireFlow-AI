"""Attendance: check-in / check-out, history, monthly summaries, statistics and HR corrections.

* One record per employee per local day: one check-in and one check-out. A second check-in the same
  day, or a check-in while one is open, is refused (and the database backs that up with unique
  indexes). Overnight shifts work for up to MAX_SHIFT_HOURS, attributed to the day of check-in;
  anything older can only be closed by HR.
* Employees can never edit a record. HR corrections need a reason and write an append-only entry
  holding exactly what changed. Nothing is ever created for a day nobody checked in: absence is
  computed, not stored.
"""

import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import and_, case, exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core import security
from app.core.exceptions import (
    BusinessRuleError,
    ConflictError,
    NotFoundError,
)
from app.models.employee import Employee, EmploymentStatus
from app.models.user import User
from app.models.workforce import (
    AttendanceCorrection,
    AttendanceRecord,
    AttendanceSource,
    LeaveRequest,
    LeaveStatus,
)
from app.schemas.workforce import AttendanceCreate, AttendanceUpdate
from app.services import work_config
from app.services import workforce_rules as rules

PAGE_MAX = 100


# ---- helpers ------------------------------------------------------------------------------------


def employee_ref(employee: Employee) -> dict:
    return {
        "id": employee.id,
        "name": f"{employee.first_name} {employee.last_name}",
        "department": employee.department,
    }


def linked_employee(db: Session, user: User) -> Employee:
    """The employee record this login belongs to. Self-service needs one."""
    if user.employee_id is None:
        raise ConflictError("Your account is not linked to an employee record. Ask HR to link it.")
    employee = db.get(Employee, user.employee_id)
    if employee is None:
        raise ConflictError("Your account is not linked to an employee record. Ask HR to link it.")
    return employee


def lock_employee(db: Session, employee_id: uuid.UUID) -> None:
    """Serialises everything that changes one employee's attendance or leave (a row lock)."""
    db.execute(select(Employee.id).where(Employee.id == employee_id).with_for_update())


def read(record: AttendanceRecord) -> dict:
    return {
        "id": record.id,
        "employee": employee_ref(record.employee),
        "work_date": record.work_date,
        "check_in_at": record.check_in_at,
        "check_out_at": record.check_out_at,
        "worked_minutes": record.worked_minutes,
        "is_late": record.is_late,
        "left_early": record.left_early,
        "source": record.source.value,
        "corrected": record.corrected,
        "timezone": record.timezone,
        "state": "open" if record.check_out_at is None else "closed",
    }


def _evaluate(db: Session, record_date: date, check_in: datetime, check_out: datetime | None):
    s = work_config.get_settings(db)
    holidays = work_config.holiday_dates(db, record_date, record_date)
    return rules.evaluate(
        check_in,
        check_out,
        work_date=record_date,
        tz=s.timezone,
        work_days=list(s.work_days),
        holidays=holidays,
        work_start=s.work_start,
        work_end=s.work_end,
        grace_minutes=s.grace_minutes,
    )


def _load(db: Session, record_id: uuid.UUID) -> AttendanceRecord:
    record = db.scalar(
        select(AttendanceRecord)
        .where(AttendanceRecord.id == record_id)
        .options(joinedload(AttendanceRecord.employee))
    )
    if record is None:
        raise NotFoundError("Attendance record not found")
    return record


def _on_leave(db: Session, employee_id: uuid.UUID, day: date) -> bool:
    return bool(
        db.scalar(
            select(
                exists().where(
                    LeaveRequest.employee_id == employee_id,
                    LeaveRequest.status == LeaveStatus.APPROVED,
                    LeaveRequest.start_date <= day,
                    LeaveRequest.end_date >= day,
                )
            )
        )
    )


# ---- self-service -------------------------------------------------------------------------------


def today_status(db: Session, user: User) -> dict:
    employee = linked_employee(db, user)
    s = work_config.get_settings(db)
    now = security.utcnow()
    today = rules.local_date(now, s.timezone)
    open_record = db.scalar(
        select(AttendanceRecord)
        .where(AttendanceRecord.employee_id == employee.id, AttendanceRecord.check_out_at.is_(None))
        .options(joinedload(AttendanceRecord.employee))
    )
    todays = db.scalar(
        select(AttendanceRecord)
        .where(AttendanceRecord.employee_id == employee.id, AttendanceRecord.work_date == today)
        .options(joinedload(AttendanceRecord.employee))
    )
    record = todays or open_record
    stale = open_record.work_date if open_record and open_record.work_date != today else None
    if record is None:
        state = "not_checked_in"
    else:
        state = "checked_in" if record.check_out_at is None else "checked_out"
    minutes = 0
    if record is not None:
        end = record.check_out_at or now
        minutes = max(0, int((end - record.check_in_at).total_seconds() // 60))
    holidays = work_config.holiday_dates(db, today, today)
    return {
        "state": state,
        "work_date": today,
        "timezone": s.timezone,
        "record": read(record) if record else None,
        "minutes_so_far": minutes,
        "is_working_day": rules.is_working_day(today, list(s.work_days), holidays),
        "holiday_name": work_config.holiday_name(db, today),
        "on_leave": _on_leave(db, employee.id, today),
        "work_start": s.work_start,
        "work_end": s.work_end,
        "grace_minutes": s.grace_minutes,
        "stale_open_from": stale,
    }


def check_in(db: Session, user: User) -> dict:
    employee = linked_employee(db, user)
    if employee.employment_status != EmploymentStatus.ACTIVE:
        raise ConflictError("Only active employees can check in.")
    lock_employee(db, employee.id)
    s = work_config.get_settings(db)
    now = security.utcnow()
    today = rules.local_date(now, s.timezone)

    open_record = db.scalar(
        select(AttendanceRecord).where(
            AttendanceRecord.employee_id == employee.id, AttendanceRecord.check_out_at.is_(None)
        )
    )
    if open_record is not None:
        if open_record.work_date == today:
            raise ConflictError("You are already checked in.")
        raise ConflictError(
            f"You still have an open check-in from {open_record.work_date.isoformat()}. "
            "Ask HR to close it before you check in again."
        )
    if db.scalar(
        select(AttendanceRecord.id).where(
            AttendanceRecord.employee_id == employee.id, AttendanceRecord.work_date == today
        )
    ):
        raise ConflictError("You have already completed your attendance for today.")

    late, _, _ = _evaluate(db, today, now, None)
    record = AttendanceRecord(
        employee_id=employee.id,
        work_date=today,
        check_in_at=now,
        is_late=late,
        left_early=False,
        source=AttendanceSource.SELF,
        corrected=False,
        timezone=s.timezone,
    )
    db.add(record)
    try:
        db.commit()
    except IntegrityError:  # the unique indexes are the last line of defence
        db.rollback()
        raise ConflictError("You are already checked in.") from None
    return read(_load(db, record.id))


def check_out(db: Session, user: User) -> dict:
    employee = linked_employee(db, user)
    lock_employee(db, employee.id)
    record = db.scalar(
        select(AttendanceRecord)
        .where(AttendanceRecord.employee_id == employee.id, AttendanceRecord.check_out_at.is_(None))
        .options(joinedload(AttendanceRecord.employee))
    )
    if record is None:
        raise ConflictError("You are not checked in.")
    now = security.utcnow()
    if now - record.check_in_at > timedelta(hours=rules.MAX_SHIFT_HOURS):
        raise ConflictError(
            f"Your check-in from {record.work_date.isoformat()} is more than "
            f"{rules.MAX_SHIFT_HOURS} hours old. Ask HR to close it."
        )
    late, early, minutes = _evaluate(db, record.work_date, record.check_in_at, now)
    record.check_out_at = now
    record.worked_minutes = minutes
    record.left_early = early
    record.is_late = late
    db.commit()
    return read(_load(db, record.id))


# ---- listing ------------------------------------------------------------------------------------


def list_records(
    db: Session,
    *,
    employee_id: uuid.UUID | None,
    start: date | None,
    end: date | None,
    late: bool | None,
    state: str | None,
    department: str | None,
    page: int,
    page_size: int,
) -> dict:
    page_size = min(page_size, PAGE_MAX)
    conds = []
    if employee_id:
        conds.append(AttendanceRecord.employee_id == employee_id)
    if start:
        conds.append(AttendanceRecord.work_date >= start)
    if end:
        conds.append(AttendanceRecord.work_date <= end)
    if late is not None:
        conds.append(AttendanceRecord.is_late == late)
    if state == "open":
        conds.append(AttendanceRecord.check_out_at.is_(None))
    elif state == "closed":
        conds.append(AttendanceRecord.check_out_at.is_not(None))
    base = select(AttendanceRecord).join(Employee, Employee.id == AttendanceRecord.employee_id)
    if department:
        conds.append(Employee.department == department)
    total = db.scalar(
        select(func.count())
        .select_from(AttendanceRecord)
        .join(Employee, Employee.id == AttendanceRecord.employee_id)
        .where(*conds)
    )
    rows = db.scalars(
        base.where(*conds)
        .options(joinedload(AttendanceRecord.employee))
        .order_by(AttendanceRecord.work_date.desc(), Employee.first_name, AttendanceRecord.id)
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).unique()
    return {
        "items": [read(r) for r in rows],
        "total": total or 0,
        "page": page,
        "page_size": page_size,
    }


# ---- summaries and statistics -------------------------------------------------------------------


def _leave_days_by_employee(
    db: Session, employee_ids: list[uuid.UUID], dates: set[date], first: date, last: date
) -> dict[uuid.UUID, int]:
    """Working days each employee spent on APPROVED leave, counted over `dates`."""
    out: dict[uuid.UUID, int] = dict.fromkeys(employee_ids, 0)
    if not employee_ids or not dates:
        return out
    rows = db.execute(
        select(LeaveRequest.employee_id, LeaveRequest.start_date, LeaveRequest.end_date).where(
            LeaveRequest.employee_id.in_(employee_ids),
            LeaveRequest.status == LeaveStatus.APPROVED,
            LeaveRequest.start_date <= last,
            LeaveRequest.end_date >= first,
        )
    )
    for employee_id, start, end in rows:
        out[employee_id] += sum(1 for d in dates if start <= d <= end)
    return out


def month_summary(
    db: Session, *, month: str, employee_id: uuid.UUID | None, page: int, page_size: int
) -> dict:
    first, last = rules.month_bounds(month)
    s = work_config.get_settings(db)
    today = rules.local_date(security.utcnow(), s.timezone)
    # Days that are over: a working day only counts as missed once it has ended.
    through = min(last, today - timedelta(days=1))
    holidays = work_config.holiday_dates(db, first, last)
    elapsed = (
        set(rules.working_dates(first, through, list(s.work_days), holidays))
        if through >= first
        else set()
    )
    page_size = min(page_size, PAGE_MAX)

    in_month = and_(
        AttendanceRecord.employee_id == Employee.id,
        AttendanceRecord.work_date >= first,
        AttendanceRecord.work_date <= last,
    )
    counted = case((AttendanceRecord.work_date.in_(elapsed or {date.min}), 1), else_=0)
    conds = [Employee.employment_status == EmploymentStatus.ACTIVE]
    if employee_id:
        conds = [Employee.id == employee_id]
    stmt = (
        select(
            Employee,
            func.count(AttendanceRecord.id),
            func.coalesce(func.sum(case((AttendanceRecord.is_late, 1), else_=0)), 0),
            func.coalesce(func.sum(case((AttendanceRecord.left_early, 1), else_=0)), 0),
            func.coalesce(func.sum(AttendanceRecord.worked_minutes), 0),
            func.coalesce(func.sum(counted), 0),
        )
        .select_from(Employee)
        .outerjoin(AttendanceRecord, in_month)
        .where(*conds)
        .group_by(Employee.id)
        .order_by(Employee.first_name, Employee.last_name, Employee.id)
    )
    total = db.scalar(select(func.count()).select_from(Employee).where(*conds)) or 0
    rows = db.execute(stmt.limit(page_size).offset((page - 1) * page_size)).all()
    leave = _leave_days_by_employee(db, [r[0].id for r in rows], elapsed, first, last)
    items = []
    for employee, present, late, early, minutes, attended_elapsed in rows:
        on_leave = leave[employee.id]
        items.append(
            {
                "employee": employee_ref(employee),
                "present_days": int(present),
                "late_days": int(late),
                "early_days": int(early),
                "worked_minutes": int(minutes),
                "expected_days": len(elapsed),
                "leave_days": on_leave,
                "absent_days": max(0, len(elapsed) - on_leave - int(attended_elapsed)),
            }
        )
    totals = {
        key: sum(i[key] for i in items)
        for key in (
            "present_days",
            "late_days",
            "early_days",
            "worked_minutes",
            "leave_days",
            "absent_days",
        )
    }
    return {
        "month": month,
        "working_days_so_far": len(elapsed),
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "totals": totals,
    }


def stats(db: Session, day: date | None = None) -> dict:
    s = work_config.get_settings(db)
    day = day or rules.local_date(security.utcnow(), s.timezone)
    holidays = work_config.holiday_dates(db, day, day)
    working = rules.is_working_day(day, list(s.work_days), holidays)
    active = select(Employee.id).where(Employee.employment_status == EmploymentStatus.ACTIVE)
    active_count = db.scalar(select(func.count()).select_from(active.subquery())) or 0

    has_record = exists().where(
        AttendanceRecord.employee_id == Employee.id, AttendanceRecord.work_date == day
    )
    on_leave_q = exists().where(
        LeaveRequest.employee_id == Employee.id,
        LeaveRequest.status == LeaveStatus.APPROVED,
        LeaveRequest.start_date <= day,
        LeaveRequest.end_date >= day,
    )
    base = Employee.employment_status == EmploymentStatus.ACTIVE
    on_leave = db.scalar(select(func.count()).select_from(Employee).where(base, on_leave_q)) or 0
    leave_no_record = (
        db.scalar(select(func.count()).select_from(Employee).where(base, on_leave_q, ~has_record))
        or 0
    )
    present, late, still_in = db.execute(
        select(
            func.count(),
            func.coalesce(func.sum(case((AttendanceRecord.is_late, 1), else_=0)), 0),
            func.coalesce(func.sum(case((AttendanceRecord.check_out_at.is_(None), 1), else_=0)), 0),
        )
        .select_from(AttendanceRecord)
        .join(Employee, Employee.id == AttendanceRecord.employee_id)
        .where(AttendanceRecord.work_date == day, base)
    ).one()
    expected = active_count if working else 0
    return {
        "date": day,
        "is_working_day": working,
        "holiday_name": work_config.holiday_name(db, day),
        "expected": expected,
        "present": int(present),
        "late": int(late),
        "still_in": int(still_in),
        "checked_out": int(present) - int(still_in),
        "on_leave": int(on_leave),
        "not_checked_in": max(0, expected - int(present) - int(leave_no_record)) if working else 0,
    }


# ---- HR corrections -----------------------------------------------------------------------------


def _snapshot(record: AttendanceRecord) -> dict:
    return {
        "check_in_at": record.check_in_at.isoformat(),
        "check_out_at": record.check_out_at.isoformat() if record.check_out_at else None,
        "worked_minutes": record.worked_minutes,
        "is_late": record.is_late,
        "left_early": record.left_early,
    }


def _record_correction(db, record, actor, kind, reason, before):
    db.add(
        AttendanceCorrection(
            record_id=record.id,
            actor_id=actor.id,
            kind=kind,
            reason=reason,
            before=before,
            after=_snapshot(record),
            created_at=security.utcnow(),
        )
    )


def hr_create(db: Session, actor: User, data: AttendanceCreate) -> dict:
    """HR adds a record for a day the employee did not (or could not) check in. It is flagged as
    HR-entered, carries the reason, and is audited."""
    employee = db.get(Employee, data.employee_id)
    if employee is None:
        raise NotFoundError("Employee not found")
    s = work_config.get_settings(db)
    today = rules.local_date(security.utcnow(), s.timezone)
    if data.work_date > today:
        raise BusinessRuleError("Attendance cannot be recorded for a future date.")
    if rules.local_date(data.check_in_at, s.timezone) != data.work_date:
        raise BusinessRuleError(
            "The check-in must fall on the record's date (in the company time zone)."
        )
    if data.check_out_at is not None and data.check_out_at > security.utcnow():
        raise BusinessRuleError("The check-out time cannot be in the future.")
    if data.check_in_at > security.utcnow():
        raise BusinessRuleError("The check-in time cannot be in the future.")
    lock_employee(db, employee.id)
    if db.scalar(
        select(AttendanceRecord.id).where(
            AttendanceRecord.employee_id == employee.id,
            AttendanceRecord.work_date == data.work_date,
        )
    ):
        raise ConflictError("There is already a record for that day. Correct it instead.")
    late, early, minutes = _evaluate(db, data.work_date, data.check_in_at, data.check_out_at)
    record = AttendanceRecord(
        employee_id=employee.id,
        work_date=data.work_date,
        check_in_at=data.check_in_at,
        check_out_at=data.check_out_at,
        worked_minutes=minutes,
        is_late=late,
        left_early=early,
        source=AttendanceSource.HR,
        corrected=True,
        timezone=s.timezone,
    )
    db.add(record)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ConflictError("That employee already has an open check-in.") from None
    _record_correction(db, record, actor, "created", data.reason, None)
    db.commit()
    return read(_load(db, record.id))


def hr_update(db: Session, actor: User, record_id: uuid.UUID, data: AttendanceUpdate) -> dict:
    record = _load(db, record_id)
    lock_employee(db, record.employee_id)
    db.refresh(record)
    before = _snapshot(record)
    check_in = data.check_in_at or record.check_in_at
    check_out = data.check_out_at if data.check_out_at is not None else record.check_out_at
    s = work_config.get_settings(db)
    now = security.utcnow()
    if check_in > now or (check_out is not None and check_out > now):
        raise BusinessRuleError("A time cannot be in the future.")
    if rules.local_date(check_in, s.timezone) != record.work_date:
        raise BusinessRuleError(
            "The check-in must stay on the record's date (in the company time zone)."
        )
    late, early, minutes = _evaluate(db, record.work_date, check_in, check_out)
    record.check_in_at = check_in
    record.check_out_at = check_out
    record.worked_minutes = minutes
    record.is_late = late
    record.left_early = early
    record.corrected = True
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ConflictError("That change conflicts with another record.") from None
    _record_correction(db, record, actor, "updated", data.reason, before)
    db.commit()
    return read(_load(db, record.id))


def corrections(db: Session, record_id: uuid.UUID) -> list[dict]:
    _load(db, record_id)
    rows = db.scalars(
        select(AttendanceCorrection)
        .where(AttendanceCorrection.record_id == record_id)
        .options(joinedload(AttendanceCorrection.actor))
        .order_by(AttendanceCorrection.created_at, AttendanceCorrection.id)
    )
    return [
        {
            "id": c.id,
            "kind": c.kind,
            "reason": c.reason,
            "actor": {"id": c.actor.id, "email": c.actor.email} if c.actor else None,
            "before": c.before,
            "after": c.after,
            "created_at": c.created_at,
        }
        for c in rows
    ]
