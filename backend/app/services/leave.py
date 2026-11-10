"""Leave: types, requests, the approval lifecycle and the balance ledger.

Money-like rules, all enforced here and again by the database:

* A balance is never stored: it is the SUM of the append-only ledger (allocation + deductions +
  reversals + HR adjustments). It cannot drift, and every change names who made it and why.
* Approving a request writes exactly one deduction; cancelling an approved one writes exactly one
  reversal. Unique partial indexes make a second of either impossible even under a race.
* Everything that changes one employee's leave takes that employee's row lock first, so two
  simultaneous approvals (or an approval racing a withdrawal) are serialised on PostgreSQL.
* A request freezes its working-day count when it is submitted. Changing holidays or the work week
  afterwards never rewrites approved leave.
* Nobody decides their own request, whatever their role.
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core import security
from app.core.exceptions import (
    BusinessRuleError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
)
from app.models.employee import Employee, EmploymentStatus
from app.models.user import User, UserRole
from app.models.workforce import (
    LeaveEvent,
    LeaveEventType,
    LeaveLedgerEntry,
    LeaveRequest,
    LeaveStatus,
    LeaveType,
    LedgerEntryType,
)
from app.schemas.workforce import (
    AdjustIn,
    AllocateIn,
    LeaveSubmit,
    LeaveTypeUpdate,
    LeaveTypeWrite,
)
from app.services import work_config
from app.services import workforce_rules as rules
from app.services.attendance import employee_ref, linked_employee, lock_employee

HR_ROLES = frozenset({UserRole.ADMIN, UserRole.HR_MANAGER})
PAGE_MAX = 100
ZERO = Decimal("0")


def _f(value: Decimal | None) -> float:
    return float(value or 0)


def is_hr(user: User) -> bool:
    return user.role in HR_ROLES


def _today(db: Session) -> date:
    return rules.local_date(security.utcnow(), work_config.get_settings(db).timezone)


def current_year(db: Session) -> int:
    return _today(db).year


# ---- leave types --------------------------------------------------------------------------------


def type_read(t: LeaveType) -> dict:
    return {
        "id": t.id,
        "code": t.code,
        "name": t.name,
        "is_paid": t.is_paid,
        "tracks_balance": t.tracks_balance,
        "default_days": _f(t.default_days),
        "is_active": t.is_active,
    }


def type_ref(t: LeaveType) -> dict:
    return {"id": t.id, "code": t.code, "name": t.name, "is_paid": t.is_paid}


def list_types(db: Session, *, include_inactive: bool) -> list[LeaveType]:
    stmt = select(LeaveType).order_by(LeaveType.name, LeaveType.id)
    if not include_inactive:
        stmt = stmt.where(LeaveType.is_active.is_(True))
    return list(db.scalars(stmt))


def get_type(db: Session, type_id: uuid.UUID, *, active: bool = False) -> LeaveType:
    leave_type = db.get(LeaveType, type_id)
    if leave_type is None:
        raise NotFoundError("Leave type not found")
    if active and not leave_type.is_active:
        raise BusinessRuleError("That leave type is no longer available.")
    return leave_type


def create_type(db: Session, data: LeaveTypeWrite) -> LeaveType:
    leave_type = LeaveType(
        code=data.code,
        name=data.name,
        is_paid=data.is_paid,
        # Unpaid-style types never carry a balance, so they cannot deduct paid leave.
        tracks_balance=data.tracks_balance and data.is_paid,
        default_days=Decimal(str(data.default_days)),
        is_active=data.is_active,
    )
    db.add(leave_type)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("A leave type with that code already exists.") from None
    return leave_type


def update_type(db: Session, type_id: uuid.UUID, data: LeaveTypeUpdate) -> LeaveType:
    leave_type = get_type(db, type_id)
    changes = data.model_dump(exclude_unset=True)
    if "default_days" in changes:
        changes["default_days"] = Decimal(str(changes["default_days"]))
    for field, value in changes.items():
        setattr(leave_type, field, value)
    if not leave_type.is_paid:
        leave_type.tracks_balance = False
    db.commit()
    return leave_type


# ---- balances -----------------------------------------------------------------------------------


def ledger_balance(db: Session, employee_id: uuid.UUID, type_id: uuid.UUID, year: int) -> Decimal:
    total = db.scalar(
        select(func.coalesce(func.sum(LeaveLedgerEntry.days), 0)).where(
            LeaveLedgerEntry.employee_id == employee_id,
            LeaveLedgerEntry.leave_type_id == type_id,
            LeaveLedgerEntry.year == year,
        )
    )
    return Decimal(total or 0)


def pending_days(
    db: Session,
    employee_id: uuid.UUID,
    type_id: uuid.UUID,
    year: int,
    exclude: uuid.UUID | None = None,
) -> Decimal:
    stmt = select(func.coalesce(func.sum(LeaveRequest.days), 0)).where(
        LeaveRequest.employee_id == employee_id,
        LeaveRequest.leave_type_id == type_id,
        LeaveRequest.status == LeaveStatus.PENDING,
        LeaveRequest.start_date >= date(year, 1, 1),
        LeaveRequest.start_date <= date(year, 12, 31),
    )
    if exclude:
        stmt = stmt.where(LeaveRequest.id != exclude)
    return Decimal(db.scalar(stmt) or 0)


def balance_rows(db: Session, employee_id: uuid.UUID, year: int) -> list[dict]:
    types = [t for t in list_types(db, include_inactive=False) if t.tracks_balance]
    sums: dict[tuple[uuid.UUID, str], Decimal] = {}
    for type_id, kind, total in db.execute(
        select(
            LeaveLedgerEntry.leave_type_id,
            LeaveLedgerEntry.entry_type,
            func.sum(LeaveLedgerEntry.days),
        )
        .where(LeaveLedgerEntry.employee_id == employee_id, LeaveLedgerEntry.year == year)
        .group_by(LeaveLedgerEntry.leave_type_id, LeaveLedgerEntry.entry_type)
    ):
        sums[(type_id, kind.value)] = Decimal(total)
    pending: dict[uuid.UUID, Decimal] = {
        type_id: Decimal(total)
        for type_id, total in db.execute(
            select(LeaveRequest.leave_type_id, func.sum(LeaveRequest.days))
            .where(
                LeaveRequest.employee_id == employee_id,
                LeaveRequest.status == LeaveStatus.PENDING,
                LeaveRequest.start_date >= date(year, 1, 1),
                LeaveRequest.start_date <= date(year, 12, 31),
            )
            .group_by(LeaveRequest.leave_type_id)
        )
    }
    rows = []
    for t in types:
        get = lambda kind, t=t: sums.get((t.id, kind), ZERO)  # noqa: E731
        entitlement = get("allocation") + get("adjustment")
        used = -(get("deduction") + get("reversal"))
        reserved = pending.get(t.id, ZERO)
        rows.append(
            {
                "leave_type": type_ref(t),
                "year": year,
                "entitlement": _f(entitlement),
                "used": _f(used),
                "pending": _f(reserved),
                "available": _f(entitlement - used - reserved),
            }
        )
    return rows


def balances_for(db: Session, employee: Employee, year: int) -> dict:
    return {
        "employee": employee_ref(employee),
        "year": year,
        "balances": balance_rows(db, employee.id, year),
    }


def allocate(db: Session, actor: User, data: AllocateIn) -> dict:
    """Grant each active employee the default entitlement of every balance-tracked leave type for a
    year. Idempotent: anyone who already has that year's allocation is skipped."""
    types = [
        t for t in list_types(db, include_inactive=False) if t.tracks_balance and t.default_days > 0
    ]
    stmt = select(Employee.id).where(Employee.employment_status == EmploymentStatus.ACTIVE)
    if data.employee_id:
        if db.get(Employee, data.employee_id) is None:
            raise NotFoundError("Employee not found")
        stmt = select(Employee.id).where(Employee.id == data.employee_id)
    employee_ids = list(db.scalars(stmt.order_by(Employee.id)))
    existing = set(
        db.execute(
            select(LeaveLedgerEntry.employee_id, LeaveLedgerEntry.leave_type_id).where(
                LeaveLedgerEntry.year == data.year,
                LeaveLedgerEntry.entry_type == LedgerEntryType.ALLOCATION,
            )
        ).all()
    )
    granted = skipped = 0
    for employee_id in employee_ids:
        for t in types:
            if (employee_id, t.id) in existing:
                skipped += 1
                continue
            db.add(
                LeaveLedgerEntry(
                    employee_id=employee_id,
                    leave_type_id=t.id,
                    year=data.year,
                    entry_type=LedgerEntryType.ALLOCATION,
                    days=t.default_days,
                    reason=f"{data.year} entitlement",
                    actor_id=actor.id,
                )
            )
            granted += 1
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("Another allocation ran at the same time. Please try again.") from None
    return {"granted": granted, "already_granted": skipped}


def adjust(db: Session, actor: User, data: AdjustIn) -> dict:
    employee = db.get(Employee, data.employee_id)
    if employee is None:
        raise NotFoundError("Employee not found")
    leave_type = get_type(db, data.leave_type_id)
    if not leave_type.tracks_balance:
        raise BusinessRuleError("That leave type does not have a balance to adjust.")
    lock_employee(db, employee.id)
    delta = Decimal(str(data.days))
    if ledger_balance(db, employee.id, leave_type.id, data.year) + delta < 0:
        raise BusinessRuleError("That adjustment would make the balance negative.")
    db.add(
        LeaveLedgerEntry(
            employee_id=employee.id,
            leave_type_id=leave_type.id,
            year=data.year,
            entry_type=LedgerEntryType.ADJUSTMENT,
            days=delta,
            reason=data.reason,
            actor_id=actor.id,
        )
    )
    db.commit()
    return balances_for(db, employee, data.year)


# ---- requests -----------------------------------------------------------------------------------


def preview(db: Session, start: date, end: date) -> dict:
    s = work_config.get_settings(db)
    holidays = work_config.holiday_dates(db, start, end)
    days, off, holiday = rules.leave_days(start, end, list(s.work_days), holidays)
    return {
        "start_date": start,
        "end_date": end,
        "days": _f(days),
        "weekends_skipped": off,
        "holidays_skipped": holiday,
    }


def _load(db: Session, request_id: uuid.UUID, *, fresh: bool = False) -> LeaveRequest:
    stmt = (
        select(LeaveRequest)
        .where(LeaveRequest.id == request_id)
        .options(
            joinedload(LeaveRequest.employee),
            joinedload(LeaveRequest.leave_type),
            joinedload(LeaveRequest.reviewer),
        )
    )
    if fresh:
        stmt = stmt.execution_options(populate_existing=True)
    request = db.scalar(stmt)
    if request is None:
        raise NotFoundError("Leave request not found")
    return request


def allowed_actions(request: LeaveRequest, viewer: User, today: date) -> list[str]:
    owner = viewer.employee_id is not None and viewer.employee_id == request.employee_id
    actions: list[str] = []
    if request.status == LeaveStatus.PENDING:
        if owner:
            actions.append("withdraw")
        if is_hr(viewer) and not owner:
            actions += ["approve", "reject"]
    elif request.status == LeaveStatus.APPROVED and request.start_date > today:
        if owner or is_hr(viewer):
            actions.append("cancel")
    return actions


def read(request: LeaveRequest, viewer: User, today: date) -> dict:
    return {
        "id": request.id,
        "employee": employee_ref(request.employee),
        "leave_type": type_ref(request.leave_type),
        "start_date": request.start_date,
        "end_date": request.end_date,
        "days": _f(request.days),
        "reason": request.reason,
        "status": request.status.value,
        "submitted_at": request.submitted_at,
        "reviewer": {"email": request.reviewer.email} if request.reviewer else None,
        "review_reason": request.review_reason,
        "decided_at": request.decided_at,
        "cancelled_at": request.cancelled_at,
        "allowed_actions": allowed_actions(request, viewer, today),
    }


def _event(db, request, kind, actor, note=None) -> None:
    db.add(
        LeaveEvent(
            request_id=request.id,
            event_type=kind,
            actor_id=actor.id,
            note=note or None,
            created_at=security.utcnow(),
        )
    )


def get_for(db: Session, viewer: User, request_id: uuid.UUID) -> LeaveRequest:
    """Owner or HR only. Anyone else gets 'not found', so ids cannot be probed."""
    request = _load(db, request_id)
    owner = viewer.employee_id is not None and viewer.employee_id == request.employee_id
    if not (owner or is_hr(viewer)):
        raise NotFoundError("Leave request not found")
    return request


def view(db: Session, viewer: User, request_id: uuid.UUID) -> dict:
    return read(get_for(db, viewer, request_id), viewer, _today(db))


def submit(db: Session, user: User, data: LeaveSubmit) -> dict:
    employee = linked_employee(db, user)
    if employee.employment_status != EmploymentStatus.ACTIVE:
        raise ConflictError("Only active employees can request leave.")
    leave_type = get_type(db, data.leave_type_id, active=True)
    s = work_config.get_settings(db)
    today = _today(db)
    if data.end_date < data.start_date:
        raise BusinessRuleError("The end date must not be before the start date.")
    if data.start_date.year != data.end_date.year:
        raise BusinessRuleError(
            "A leave request cannot span two calendar years. Submit one per year."
        )
    if data.start_date < today - timedelta(days=s.max_backdate_days):
        raise BusinessRuleError(
            f"Leave cannot start more than {s.max_backdate_days} days in the past. Ask HR."
        )
    holidays = work_config.holiday_dates(db, data.start_date, data.end_date)
    days, _, _ = rules.leave_days(data.start_date, data.end_date, list(s.work_days), holidays)
    if days <= 0:
        raise BusinessRuleError("That range has no working days (only weekends or holidays).")

    lock_employee(db, employee.id)
    clash = db.scalar(
        select(LeaveRequest)
        .where(
            LeaveRequest.employee_id == employee.id,
            LeaveRequest.status.in_((LeaveStatus.PENDING, LeaveStatus.APPROVED)),
            LeaveRequest.start_date <= data.end_date,
            LeaveRequest.end_date >= data.start_date,
        )
        .order_by(LeaveRequest.start_date)
    )
    if clash is not None:
        raise ConflictError(
            f"You already have {clash.status.value} leave from {clash.start_date.isoformat()} "
            f"to {clash.end_date.isoformat()} that overlaps these dates."
        )
    year = data.start_date.year
    if leave_type.tracks_balance:
        available = ledger_balance(db, employee.id, leave_type.id, year) - pending_days(
            db, employee.id, leave_type.id, year
        )
        if available < days:
            raise BusinessRuleError(
                f"Not enough {leave_type.name.lower()} balance: {float(available):g} day(s) "
                f"available, {float(days):g} requested."
            )
    request = LeaveRequest(
        employee_id=employee.id,
        leave_type_id=leave_type.id,
        start_date=data.start_date,
        end_date=data.end_date,
        days=days,
        reason=data.reason,
        status=LeaveStatus.PENDING,
        submitted_at=security.utcnow(),
    )
    db.add(request)
    db.flush()
    _event(db, request, LeaveEventType.SUBMITTED, user)
    db.commit()
    return read(_load(db, request.id), user, today)


def _decide_guard(request: LeaveRequest, actor: User) -> None:
    if actor.employee_id is not None and actor.employee_id == request.employee_id:
        raise PermissionDeniedError("You cannot decide your own leave request.")


def approve(db: Session, actor: User, request_id: uuid.UUID, note: str) -> dict:
    request = _load(db, request_id)
    _decide_guard(request, actor)
    lock_employee(db, request.employee_id)
    request = _load(db, request_id, fresh=True)  # re-read now that nobody else can be mid-change
    if request.status != LeaveStatus.PENDING:
        raise ConflictError(f"This request is already {request.status.value}.")
    leave_type = request.leave_type
    year = request.start_date.year
    if leave_type.tracks_balance:
        if ledger_balance(db, request.employee_id, leave_type.id, year) < request.days:
            raise ConflictError(
                "The employee no longer has enough balance to approve this request."
            )
        db.add(
            LeaveLedgerEntry(
                employee_id=request.employee_id,
                leave_type_id=leave_type.id,
                year=year,
                entry_type=LedgerEntryType.DEDUCTION,
                days=-request.days,
                request_id=request.id,
                reason=(
                    f"Approved {request.start_date.isoformat()} to {request.end_date.isoformat()}"
                ),
                actor_id=actor.id,
            )
        )
    request.status = LeaveStatus.APPROVED
    request.reviewer_id = actor.id
    request.review_reason = note or None
    request.decided_at = security.utcnow()
    _event(db, request, LeaveEventType.APPROVED, actor, note)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("This request has already been approved.") from None
    return read(_load(db, request_id, fresh=True), actor, _today(db))


def reject(db: Session, actor: User, request_id: uuid.UUID, reason: str) -> dict:
    if not reason:
        raise BusinessRuleError("Say why you are rejecting this request.")
    request = _load(db, request_id)
    _decide_guard(request, actor)
    lock_employee(db, request.employee_id)
    request = _load(db, request_id, fresh=True)
    if request.status != LeaveStatus.PENDING:
        raise ConflictError(f"This request is already {request.status.value}.")
    request.status = LeaveStatus.REJECTED
    request.reviewer_id = actor.id
    request.review_reason = reason
    request.decided_at = security.utcnow()
    _event(db, request, LeaveEventType.REJECTED, actor, reason)
    db.commit()
    return read(_load(db, request_id, fresh=True), actor, _today(db))


def withdraw(db: Session, user: User, request_id: uuid.UUID) -> dict:
    request = get_for(db, user, request_id)
    if user.employee_id != request.employee_id:
        raise PermissionDeniedError("Only the employee can withdraw their own request.")
    lock_employee(db, request.employee_id)
    request = _load(db, request_id, fresh=True)
    if request.status != LeaveStatus.PENDING:
        raise ConflictError(
            f"This request is already {request.status.value}, so it cannot be withdrawn."
        )
    request.status = LeaveStatus.WITHDRAWN
    request.cancelled_at = security.utcnow()
    _event(db, request, LeaveEventType.WITHDRAWN, user)
    db.commit()
    return read(_load(db, request_id, fresh=True), user, _today(db))


def cancel(db: Session, actor: User, request_id: uuid.UUID, reason: str) -> dict:
    """Cancel APPROVED leave that has not started. The deducted days are given back through a
    reversal entry. Once leave has begun, HR corrects the balance with an adjustment instead."""
    request = get_for(db, actor, request_id)
    owner = actor.employee_id == request.employee_id
    if not owner and not reason:
        raise BusinessRuleError("Say why you are cancelling this leave.")
    lock_employee(db, request.employee_id)
    request = _load(db, request_id, fresh=True)
    if request.status != LeaveStatus.APPROVED:
        raise ConflictError("Only approved leave can be cancelled.")
    if request.start_date <= _today(db):
        raise ConflictError(
            "This leave has already started, so it cannot be cancelled. HR can adjust the balance."
        )
    if request.leave_type.tracks_balance:
        db.add(
            LeaveLedgerEntry(
                employee_id=request.employee_id,
                leave_type_id=request.leave_type_id,
                year=request.start_date.year,
                entry_type=LedgerEntryType.REVERSAL,
                days=request.days,
                request_id=request.id,
                reason=reason or "Cancelled by the employee",
                actor_id=actor.id,
            )
        )
    request.status = LeaveStatus.CANCELLED
    request.cancelled_at = security.utcnow()
    _event(db, request, LeaveEventType.CANCELLED, actor, reason)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("This leave has already been cancelled.") from None
    return read(_load(db, request_id, fresh=True), actor, _today(db))


def history(db: Session, viewer: User, request_id: uuid.UUID) -> list[dict]:
    get_for(db, viewer, request_id)
    rows = db.scalars(
        select(LeaveEvent)
        .where(LeaveEvent.request_id == request_id)
        .options(joinedload(LeaveEvent.actor))
        .order_by(LeaveEvent.created_at, LeaveEvent.id)
    )
    return [
        {
            "event_type": e.event_type.value,
            "actor_email": e.actor.email if e.actor else None,
            "note": e.note,
            "created_at": e.created_at,
        }
        for e in rows
    ]


def list_requests(
    db: Session,
    viewer: User,
    *,
    employee_id: uuid.UUID | None,
    status: LeaveStatus | None,
    type_id: uuid.UUID | None,
    start: date | None,
    end: date | None,
    page: int,
    page_size: int,
) -> dict:
    page_size = min(page_size, PAGE_MAX)
    conds = []
    if employee_id:
        conds.append(LeaveRequest.employee_id == employee_id)
    if status:
        conds.append(LeaveRequest.status == status)
    if type_id:
        conds.append(LeaveRequest.leave_type_id == type_id)
    if start:
        conds.append(LeaveRequest.end_date >= start)
    if end:
        conds.append(LeaveRequest.start_date <= end)
    total = db.scalar(select(func.count()).select_from(LeaveRequest).where(*conds)) or 0
    rows = db.scalars(
        select(LeaveRequest)
        .where(*conds)
        .options(
            joinedload(LeaveRequest.employee),
            joinedload(LeaveRequest.leave_type),
            joinedload(LeaveRequest.reviewer),
        )
        .order_by(LeaveRequest.submitted_at.desc(), LeaveRequest.id)
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).unique()
    today = _today(db)
    return {
        "items": [read(r, viewer, today) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ---- calendar and statistics ---------------------------------------------------------------------


def _calendar_row(request: LeaveRequest) -> dict:
    return {
        "employee": f"{request.employee.first_name} {request.employee.last_name}",
        "leave_type": request.leave_type.name,
        "start_date": request.start_date,
        "end_date": request.end_date,
        "days": _f(request.days),
    }


def calendar(db: Session, viewer: User, month: str) -> dict:
    first, last = rules.month_bounds(month)
    overlapping = (
        LeaveRequest.status == LeaveStatus.APPROVED,
        LeaveRequest.start_date <= last,
        LeaveRequest.end_date >= first,
    )
    load = (joinedload(LeaveRequest.employee), joinedload(LeaveRequest.leave_type))
    mine = []
    if viewer.employee_id is not None:
        mine = [
            _calendar_row(r)
            for r in db.scalars(
                select(LeaveRequest)
                .where(LeaveRequest.employee_id == viewer.employee_id, *overlapping)
                .options(*load)
                .order_by(LeaveRequest.start_date)
            ).unique()
        ]
    team = []
    if is_hr(viewer):
        team = [
            _calendar_row(r)
            for r in db.scalars(
                select(LeaveRequest)
                .where(*overlapping)
                .options(*load)
                .order_by(LeaveRequest.start_date, LeaveRequest.id)
                .limit(500)
            ).unique()
        ]
    holidays = work_config.list_holidays(db, start=first, end=last)
    return {
        "month": month,
        "holidays": [{"id": h.id, "day": h.day, "name": h.name} for h in holidays],
        "my_leave": mine,
        "team_leave": team,
    }


def stats(db: Session) -> dict:
    today = _today(db)
    first = date(today.year, today.month, 1)
    last = rules.month_bounds(f"{today.year}-{today.month:02d}")[1]
    approved = LeaveRequest.status == LeaveStatus.APPROVED
    pending = db.scalar(
        select(func.count())
        .select_from(LeaveRequest)
        .where(LeaveRequest.status == LeaveStatus.PENDING)
    )
    approved_days = db.scalar(
        select(func.coalesce(func.sum(LeaveRequest.days), 0)).where(
            approved, LeaveRequest.start_date >= first, LeaveRequest.start_date <= last
        )
    )
    on_leave = db.scalar(
        select(func.count(func.distinct(LeaveRequest.employee_id)))
        .join(Employee, Employee.id == LeaveRequest.employee_id)
        .where(
            approved,
            LeaveRequest.start_date <= today,
            LeaveRequest.end_date >= today,
            Employee.employment_status == EmploymentStatus.ACTIVE,
        )
    )
    soon = db.scalar(
        select(func.count())
        .select_from(LeaveRequest)
        .where(
            approved,
            LeaveRequest.start_date >= today,
            LeaveRequest.start_date < today + timedelta(days=14),
        )
    )
    return {
        "pending_requests": pending or 0,
        "approved_days_this_month": _f(approved_days),
        "on_leave_today": on_leave or 0,
        "starting_next_14_days": soon or 0,
    }
