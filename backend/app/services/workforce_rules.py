"""Pure rules for attendance and leave: no database access, so they are easy to test exhaustively.

Everything that depends on the company calendar takes the work settings and the holiday dates as
arguments. A leave request freezes its working-day count when it is submitted, so changing these
later never rewrites approved leave.
"""

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.exceptions import BusinessRuleError

MAX_SHIFT_HOURS = 16  # a check-in older than this can only be closed by HR
MAX_LEAVE_SPAN_DAYS = 366
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        raise BusinessRuleError("That time zone is not recognised.") from None


def local_date(instant: datetime, tz: str) -> date:
    return instant.astimezone(zone(tz)).date()


def at_local(day: date, clock: time, tz: str) -> datetime:
    """The UTC instant of `clock` on local `day`. A clock time that does not exist (the hour clocks
    skip) resolves to the instant just after the change, never an error."""
    return datetime.combine(day, clock, tzinfo=zone(tz)).astimezone(UTC)


def is_working_day(day: date, work_days: list[int], holidays: set[date]) -> bool:
    return day.weekday() in work_days and day not in holidays


def working_dates(start: date, end: date, work_days: list[int], holidays: set[date]) -> list[date]:
    out: list[date] = []
    day = start
    while day <= end:
        if is_working_day(day, work_days, holidays):
            out.append(day)
        day += timedelta(days=1)
    return out


def leave_days(
    start: date, end: date, work_days: list[int], holidays: set[date]
) -> tuple[Decimal, int, int]:
    """(working days, weekend/non-working days skipped, holidays skipped) between two dates."""
    if end < start:
        raise BusinessRuleError("The end date must not be before the start date.")
    if (end - start).days + 1 > MAX_LEAVE_SPAN_DAYS:
        raise BusinessRuleError("A leave request can span at most one year.")
    working = skipped_off = skipped_holiday = 0
    day = start
    while day <= end:
        if day in holidays and day.weekday() in work_days:
            skipped_holiday += 1
        elif day.weekday() not in work_days:
            skipped_off += 1
        else:
            working += 1
        day += timedelta(days=1)
    return Decimal(working), skipped_off, skipped_holiday


def evaluate(
    check_in: datetime,
    check_out: datetime | None,
    *,
    work_date: date,
    tz: str,
    work_days: list[int],
    holidays: set[date],
    work_start: time,
    work_end: time,
    grace_minutes: int,
) -> tuple[bool, bool, int | None]:
    """(late?, left early?, minutes worked). Lateness and early departure only apply on a normal
    working day. Minutes are whole minutes, rounded down."""
    working = is_working_day(work_date, work_days, holidays)
    # The grace period runs through the end of its last minute: with 09:00 and 10 minutes, 09:10:59
    # is on time and 09:11:00 is late.
    late = working and check_in >= at_local(work_date, work_start, tz) + timedelta(
        minutes=grace_minutes + 1
    )
    if check_out is None:
        return late, False, None
    if check_out <= check_in:
        raise BusinessRuleError("The check-out time must be after the check-in time.")
    early = working and check_out < at_local(work_date, work_end, tz)
    return late, early, int((check_out - check_in).total_seconds() // 60)


def month_bounds(month: str) -> tuple[date, date]:
    """'2026-03' -> (2026-03-01, 2026-03-31)."""
    try:
        year, number = (int(part) for part in month.split("-"))
        first = date(year, number, 1)
    except (ValueError, TypeError):
        raise BusinessRuleError("Use a month like 2026-03.") from None
    nxt = date(year + (number == 12), number % 12 + 1, 1)
    return first, nxt - timedelta(days=1)
