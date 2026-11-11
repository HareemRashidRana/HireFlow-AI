"""Request and response shapes for attendance, leave and the working-rules configuration."""

import re
import uuid
from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.exceptions import BusinessRuleError
from app.services import workforce_rules as rules

Reason = Annotated[str, Field(min_length=1, max_length=500)]


def _clean(value: str) -> str:
    return value.strip()


# ---- configuration ------------------------------------------------------------------------------


class WorkSettingsRead(BaseModel):
    timezone: str
    work_days: list[int]
    work_start: time
    work_end: time
    grace_minutes: int
    max_backdate_days: int
    updated_at: datetime | None = None


class WorkSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timezone: Annotated[str, Field(max_length=64)]
    work_days: list[int]
    work_start: time
    work_end: time
    grace_minutes: Annotated[int, Field(ge=0, le=240)]
    max_backdate_days: Annotated[int, Field(ge=0, le=366)]

    @field_validator("timezone")
    @classmethod
    def _zone(cls, value: str) -> str:
        try:
            rules.zone(value)
        except BusinessRuleError as e:
            raise ValueError(e.detail) from None
        return value

    @field_validator("work_days")
    @classmethod
    def _days(cls, value: list[int]) -> list[int]:
        if not value or any(d < 0 or d > 6 for d in value) or len(set(value)) != len(value):
            raise ValueError(
                "Choose at least one working day (0 = Monday ... 6 = Sunday), once each."
            )
        return sorted(value)

    @model_validator(mode="after")
    def _hours(self):
        if self.work_end <= self.work_start:
            raise ValueError("The working day must end after it starts.")
        return self


class HolidayCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: date
    name: Annotated[str, Field(min_length=1, max_length=100)]

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = _clean(value)
        if not value:
            raise ValueError("Give the holiday a name.")
        return value


class HolidayRead(BaseModel):
    id: uuid.UUID
    day: date
    name: str


# ---- attendance ---------------------------------------------------------------------------------


class EmployeeRef(BaseModel):
    id: uuid.UUID
    name: str
    department: str


class AttendanceRead(BaseModel):
    id: uuid.UUID
    employee: EmployeeRef
    work_date: date
    check_in_at: datetime
    check_out_at: datetime | None
    worked_minutes: int | None
    is_late: bool
    left_early: bool
    source: str
    corrected: bool
    timezone: str
    state: Literal["open", "closed"]


class AttendanceList(BaseModel):
    items: list[AttendanceRead]
    total: int
    page: int
    page_size: int


class TodayStatus(BaseModel):
    state: Literal["not_checked_in", "checked_in", "checked_out"]
    work_date: date
    timezone: str
    record: AttendanceRead | None
    minutes_so_far: int
    is_working_day: bool
    holiday_name: str | None
    on_leave: bool
    work_start: time
    work_end: time
    grace_minutes: int
    stale_open_from: date | None  # an unclosed check-in from an earlier day, if any


class AttendanceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee_id: uuid.UUID
    work_date: date
    check_in_at: datetime
    check_out_at: datetime | None = None
    reason: Reason

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        value = _clean(value)
        if not value:
            raise ValueError("Say why you are adding this record.")
        return value

    @field_validator("check_in_at", "check_out_at")
    @classmethod
    def _aware(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError(
                "Give the time with a time zone (for example 2026-03-02T09:05:00+05:00)."
            )
        return value


class AttendanceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    check_in_at: datetime | None = None
    check_out_at: datetime | None = None
    reason: Reason

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        value = _clean(value)
        if not value:
            raise ValueError("Say why you are changing this record.")
        return value

    @field_validator("check_in_at", "check_out_at")
    @classmethod
    def _aware(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError(
                "Give the time with a time zone (for example 2026-03-02T09:05:00+05:00)."
            )
        return value

    @model_validator(mode="after")
    def _something(self):
        if self.check_in_at is None and self.check_out_at is None:
            raise ValueError("Change the check-in time, the check-out time, or both.")
        return self


class ActorRef(BaseModel):
    id: uuid.UUID
    email: str


class CorrectionRead(BaseModel):
    id: uuid.UUID
    kind: str
    reason: str
    actor: ActorRef | None
    before: dict | None
    after: dict
    created_at: datetime


class SummaryRow(BaseModel):
    employee: EmployeeRef
    present_days: int
    late_days: int
    early_days: int
    worked_minutes: int
    expected_days: int
    leave_days: int
    absent_days: int


class MonthSummary(BaseModel):
    month: str
    # FINISHED working days (before today): what "absent" is measured against
    working_days_so_far: int
    # Working days up to and including today: the basis for "days present of N"
    working_days_through_today: int
    items: list[SummaryRow]
    total: int
    page: int
    page_size: int
    totals: dict[str, int]


class AttendanceStats(BaseModel):
    date: date
    is_working_day: bool
    holiday_name: str | None
    expected: int
    present: int
    late: int
    still_in: int
    checked_out: int
    on_leave: int
    not_checked_in: int


# ---- leave --------------------------------------------------------------------------------------


class LeaveTypeRead(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    is_paid: bool
    tracks_balance: bool
    default_days: float
    is_active: bool


class LeaveTypeWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: Annotated[str, Field(min_length=2, max_length=30)]
    name: Annotated[str, Field(min_length=1, max_length=60)]
    is_paid: bool = True
    tracks_balance: bool = True
    default_days: Annotated[float, Field(ge=0, le=366)] = 0
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def _code(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[a-z][a-z0-9_]{1,29}", value):
            raise ValueError(
                "Use lower-case letters, digits and underscores, starting with a letter."
            )
        return value

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = _clean(value)
        if not value:
            raise ValueError("Give the leave type a name.")
        return value


class LeaveTypeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=1, max_length=60)] | None = None
    is_paid: bool | None = None
    tracks_balance: bool | None = None
    default_days: Annotated[float, Field(ge=0, le=366)] | None = None
    is_active: bool | None = None


class TypeRef(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    is_paid: bool


class BalanceRow(BaseModel):
    leave_type: TypeRef
    year: int
    entitlement: float  # allocation plus HR adjustments
    used: float  # approved leave, net of cancellations
    pending: float  # reserved by requests awaiting a decision
    available: float  # entitlement - used - pending


class EmployeeBalances(BaseModel):
    employee: EmployeeRef
    year: int
    balances: list[BalanceRow]


class AllocateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    year: Annotated[int, Field(ge=2000, le=2100)]
    employee_id: uuid.UUID | None = None  # one employee, or everyone active


class AllocateOut(BaseModel):
    granted: int
    already_granted: int


class AdjustIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee_id: uuid.UUID
    leave_type_id: uuid.UUID
    year: Annotated[int, Field(ge=2000, le=2100)]
    days: Annotated[float, Field(ge=-366, le=366)]
    reason: Reason

    @field_validator("days")
    @classmethod
    def _nonzero(cls, value: float) -> float:
        if value == 0:
            raise ValueError("Enter a number of days other than zero.")
        return round(value, 1)

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        value = _clean(value)
        if not value:
            raise ValueError("Say why you are adjusting this balance.")
        return value


class PreviewOut(BaseModel):
    start_date: date
    end_date: date
    days: float
    weekends_skipped: int
    holidays_skipped: int


class LeaveSubmit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    leave_type_id: uuid.UUID
    start_date: date
    end_date: date
    reason: Annotated[str, Field(max_length=1000)] = ""

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        return _clean(value)


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: Annotated[str, Field(max_length=500)] = ""

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        return _clean(value)


class ReviewerRef(BaseModel):
    email: str


class LeaveRead(BaseModel):
    id: uuid.UUID
    employee: EmployeeRef
    leave_type: TypeRef
    start_date: date
    end_date: date
    days: float
    reason: str
    status: str
    submitted_at: datetime
    reviewer: ReviewerRef | None
    review_reason: str | None
    decided_at: datetime | None
    cancelled_at: datetime | None
    allowed_actions: list[str]


class LeaveList(BaseModel):
    items: list[LeaveRead]
    total: int
    page: int
    page_size: int


class LeaveEventRead(BaseModel):
    event_type: str
    actor_email: str | None
    note: str | None
    created_at: datetime


class CalendarLeave(BaseModel):
    employee: str
    leave_type: str
    start_date: date
    end_date: date
    days: float


class CalendarOut(BaseModel):
    month: str
    holidays: list[HolidayRead]
    my_leave: list[CalendarLeave]
    team_leave: list[CalendarLeave]  # only for HR and admin; empty for everyone else


class LeaveStats(BaseModel):
    pending_requests: int
    approved_days_this_month: float
    on_leave_today: int
    starting_next_14_days: int


class WorkforceTrendPoint(BaseModel):
    month: str  # "2026-03"
    approved_days: float


class WorkforceOverview(BaseModel):
    date: date
    timezone: str
    is_working_day: bool
    expected: int
    present: int
    late: int
    on_leave: int
    not_checked_in: int
    pending_leave_requests: int
    attendance_rate: float | None  # attended / expected working days this month; null if none yet
    leave_trend: list[WorkforceTrendPoint]
