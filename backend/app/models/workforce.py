"""Attendance and leave: work settings, holidays, attendance records, leave types, requests and the
leave ledger.

Design rules (see docs/ATTENDANCE.md and docs/LEAVE_MANAGEMENT.md):

* A leave BALANCE is never stored. It is the sum of the append-only ledger, so it cannot drift.
* The ledger, leave history and attendance corrections are append-only (enforced here and tested).
* A leave request freezes its working-day count at submission; changing holidays or the work week
  later never rewrites approved leave.
* All instants are timezone-aware UTC. `work_date` and leave dates are LOCAL calendar days in the
  company time zone (work settings), because "the day someone worked" is a local notion.
"""

import enum
import uuid
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
    Uuid,
    event,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.types import UTCDateTime, string_enum


class WorkSettings(Base):
    """The one row of company-wide working rules. `id` is always 1."""

    __tablename__ = "work_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="single_row"),
        CheckConstraint("grace_minutes >= 0 AND grace_minutes <= 240", name="grace_range"),
        CheckConstraint("work_end > work_start", name="day_ends_after_start"),
        CheckConstraint(
            "max_backdate_days >= 0 AND max_backdate_days <= 366", name="backdate_range"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")  # IANA name
    work_days: Mapped[list[int]] = mapped_column(JSON, default=lambda: [0, 1, 2, 3, 4])  # Mon=0
    work_start: Mapped[time] = mapped_column(Time, default=time(9, 0))
    work_end: Mapped[time] = mapped_column(Time, default=time(17, 0))
    grace_minutes: Mapped[int] = mapped_column(Integer, default=10)
    max_backdate_days: Mapped[int] = mapped_column(
        Integer, default=30
    )  # leave may start this far back
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, server_default=func.now(), onupdate=func.now()
    )


class Holiday(Base):
    __tablename__ = "holidays"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    day: Mapped[date] = mapped_column(Date, unique=True)
    name: Mapped[str] = mapped_column(String(100))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())


# ---- attendance ---------------------------------------------------------------------------------


class AttendanceSource(enum.StrEnum):
    SELF = "self"  # the employee checked in themselves
    HR = "hr"  # entered by HR, with a reason, as a correction


class AttendanceRecord(Base):
    """One employee's attendance for one local day: a single check-in and check-out pair."""

    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("employee_id", "work_date", name="uq_attendance_records_employee_date"),
        CheckConstraint(
            "check_out_at IS NULL OR check_out_at > check_in_at", name="checkout_after_checkin"
        ),
        CheckConstraint(
            "worked_minutes IS NULL OR worked_minutes >= 0", name="worked_non_negative"
        ),
        # At most one OPEN (not yet checked out) record per employee: no duplicate active check-ins.
        Index(
            "uq_attendance_records_one_open",
            "employee_id",
            unique=True,
            postgresql_where=text("check_out_at IS NULL"),
            sqlite_where=text("check_out_at IS NULL"),
        ),
        Index("ix_attendance_records_date", "work_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"))
    work_date: Mapped[date] = mapped_column(Date)  # local day in `timezone`
    check_in_at: Mapped[datetime] = mapped_column(UTCDateTime)
    check_out_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    worked_minutes: Mapped[int | None] = mapped_column(Integer)  # set when closed
    is_late: Mapped[bool] = mapped_column(Boolean, default=False)
    left_early: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[AttendanceSource] = mapped_column(
        string_enum(AttendanceSource, "attendance_source", 8), default=AttendanceSource.SELF
    )
    corrected: Mapped[bool] = mapped_column(Boolean, default=False)
    timezone: Mapped[str] = mapped_column(String(64))  # the company zone when it was recorded
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, server_default=func.now(), onupdate=func.now()
    )

    employee = relationship("Employee", foreign_keys=[employee_id])


class AttendanceCorrection(Base):
    """Append-only: who changed an attendance record, why, and exactly what it was before."""

    __tablename__ = "attendance_corrections"
    __table_args__ = (
        CheckConstraint("length(trim(reason)) > 0", name="reason_required"),
        Index("ix_attendance_corrections_record", "record_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    record_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("attendance_records.id", ondelete="RESTRICT")
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(10))  # "created" | "updated"
    reason: Mapped[str] = mapped_column(String(500))
    before: Mapped[dict | None] = mapped_column(JSON)
    after: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    actor = relationship("User", foreign_keys=[actor_id])


# ---- leave --------------------------------------------------------------------------------------


class LeaveStatus(enum.StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    CANCELLED = "cancelled"


class LeaveEventType(enum.StrEnum):
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    CANCELLED = "cancelled"


class LedgerEntryType(enum.StrEnum):
    ALLOCATION = "allocation"  # the year's entitlement, granted once per employee/type/year
    DEDUCTION = "deduction"  # approved leave, once per request
    REVERSAL = "reversal"  # a cancelled approved request giving its days back, once per request
    ADJUSTMENT = "adjustment"  # HR correction, always with a reason


class LeaveType(Base):
    __tablename__ = "leave_types"
    __table_args__ = (CheckConstraint("default_days >= 0", name="default_non_negative"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(30), unique=True)  # "annual", "sick", ...
    name: Mapped[str] = mapped_column(String(60))
    is_paid: Mapped[bool] = mapped_column(Boolean, default=True)
    tracks_balance: Mapped[bool] = mapped_column(Boolean, default=True)  # unpaid does not
    default_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=Decimal("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())


class LeaveRequest(Base):
    __tablename__ = "leave_requests"
    __table_args__ = (
        CheckConstraint("end_date >= start_date", name="range_valid"),
        CheckConstraint("days > 0", name="days_positive"),
        Index("ix_leave_requests_employee_start", "employee_id", "start_date"),
        Index("ix_leave_requests_status", "status"),
        Index("ix_leave_requests_dates", "start_date", "end_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"))
    leave_type_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("leave_types.id", ondelete="RESTRICT")
    )
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    days: Mapped[Decimal] = mapped_column(Numeric(5, 1))  # working days, frozen at submission
    reason: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[LeaveStatus] = mapped_column(
        string_enum(LeaveStatus, "leave_status", 10), default=LeaveStatus.PENDING
    )
    submitted_at: Mapped[datetime] = mapped_column(UTCDateTime)
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    review_reason: Mapped[str | None] = mapped_column(String(500))
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    cancelled_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, server_default=func.now(), onupdate=func.now()
    )

    employee = relationship("Employee", foreign_keys=[employee_id])
    leave_type: Mapped[LeaveType] = relationship(foreign_keys=[leave_type_id])
    reviewer = relationship("User", foreign_keys=[reviewer_id])


class LeaveEvent(Base):
    """Append-only approval history of a request."""

    __tablename__ = "leave_events"
    __table_args__ = (Index("ix_leave_events_request", "request_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("leave_requests.id", ondelete="RESTRICT")
    )
    event_type: Mapped[LeaveEventType] = mapped_column(
        string_enum(LeaveEventType, "leave_event_type", 10)
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    actor = relationship("User", foreign_keys=[actor_id])


class LeaveLedgerEntry(Base):
    """Append-only. Balance = SUM(days) for an employee, leave type and year."""

    __tablename__ = "leave_ledger"
    __table_args__ = (
        CheckConstraint(
            "(entry_type = 'allocation' AND days >= 0)"
            " OR (entry_type = 'deduction' AND days < 0 AND request_id IS NOT NULL)"
            " OR (entry_type = 'reversal' AND days > 0 AND request_id IS NOT NULL)"
            " OR (entry_type = 'adjustment' AND days <> 0)",
            name="entry_shape",
        ),
        # Exactly once: one deduction and one reversal per request, one allocation per year.
        Index(
            "uq_leave_ledger_one_deduction",
            "request_id",
            unique=True,
            postgresql_where=text("entry_type = 'deduction'"),
            sqlite_where=text("entry_type = 'deduction'"),
        ),
        Index(
            "uq_leave_ledger_one_reversal",
            "request_id",
            unique=True,
            postgresql_where=text("entry_type = 'reversal'"),
            sqlite_where=text("entry_type = 'reversal'"),
        ),
        Index(
            "uq_leave_ledger_one_allocation",
            "employee_id",
            "leave_type_id",
            "year",
            unique=True,
            postgresql_where=text("entry_type = 'allocation'"),
            sqlite_where=text("entry_type = 'allocation'"),
        ),
        Index("ix_leave_ledger_balance", "employee_id", "leave_type_id", "year"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"))
    leave_type_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("leave_types.id", ondelete="RESTRICT")
    )
    year: Mapped[int] = mapped_column(Integer)
    entry_type: Mapped[LedgerEntryType] = mapped_column(
        string_enum(LedgerEntryType, "ledger_entry_type", 10)
    )
    days: Mapped[Decimal] = mapped_column(Numeric(6, 1))
    request_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("leave_requests.id", ondelete="RESTRICT")
    )
    reason: Mapped[str | None] = mapped_column(String(500))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())


class HistoryIsAppendOnly(Exception):
    pass


def _forbid(*_args) -> None:
    raise HistoryIsAppendOnly("This history cannot be edited or deleted")


for _model in (AttendanceCorrection, LeaveEvent, LeaveLedgerEntry):
    event.listen(_model, "before_update", _forbid)
    event.listen(_model, "before_delete", _forbid)
