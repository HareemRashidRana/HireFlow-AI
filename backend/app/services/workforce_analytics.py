"""Attendance and leave figures for the HR dashboard. Read-only SQL over the real tables; nothing is
cached and no individual is named."""

from datetime import date, timedelta

from sqlalchemy import extract, func, select
from sqlalchemy.orm import Session

from app.core import security
from app.models.employee import Employee, EmploymentStatus
from app.models.workforce import AttendanceRecord, LeaveRequest, LeaveStatus
from app.services import attendance, work_config
from app.services import workforce_rules as rules

TREND_MONTHS = 6


def _month_start(day: date, back: int) -> date:
    index = day.year * 12 + day.month - 1 - back
    return date(index // 12, index % 12 + 1, 1)


def overview(db: Session) -> dict:
    s = work_config.get_settings(db)
    today = rules.local_date(security.utcnow(), s.timezone)
    day = attendance.stats(db, today)
    pending = db.scalar(
        select(func.count())
        .select_from(LeaveRequest)
        .where(LeaveRequest.status == LeaveStatus.PENDING)
    )

    # Month to date, counting only days that are over (today is excluded until tomorrow).
    first = date(today.year, today.month, 1)
    through = today - timedelta(days=1)
    rate = None
    if through >= first:
        holidays = work_config.holiday_dates(db, first, through)
        elapsed = rules.working_dates(first, through, list(s.work_days), holidays)
        active = Employee.employment_status == EmploymentStatus.ACTIVE
        headcount = db.scalar(select(func.count()).select_from(Employee).where(active)) or 0
        leave_days = 0
        if elapsed:
            for start, end in db.execute(
                select(LeaveRequest.start_date, LeaveRequest.end_date)
                .join(Employee, Employee.id == LeaveRequest.employee_id)
                .where(
                    active,
                    LeaveRequest.status == LeaveStatus.APPROVED,
                    LeaveRequest.start_date <= through,
                    LeaveRequest.end_date >= first,
                )
            ):
                leave_days += sum(1 for d in elapsed if start <= d <= end)
        expected = len(elapsed) * headcount - leave_days
        if expected > 0:
            attended = db.scalar(
                select(func.count())
                .select_from(AttendanceRecord)
                .join(Employee, Employee.id == AttendanceRecord.employee_id)
                .where(active, AttendanceRecord.work_date.in_(elapsed))
            )
            rate = round(min(1.0, (attended or 0) / expected), 4)

    start = _month_start(today, TREND_MONTHS - 1)
    totals = {
        (int(y), int(m)): float(total)
        for y, m, total in db.execute(
            select(
                extract("year", LeaveRequest.start_date),
                extract("month", LeaveRequest.start_date),
                func.sum(LeaveRequest.days),
            )
            .where(LeaveRequest.status == LeaveStatus.APPROVED, LeaveRequest.start_date >= start)
            .group_by(
                extract("year", LeaveRequest.start_date), extract("month", LeaveRequest.start_date)
            )
        )
    }
    trend = []
    for back in range(TREND_MONTHS - 1, -1, -1):
        m = _month_start(today, back)
        trend.append(
            {
                "month": f"{m.year}-{m.month:02d}",
                "approved_days": totals.get((m.year, m.month), 0.0),
            }
        )
    return {
        "date": today,
        "timezone": s.timezone,
        "is_working_day": day["is_working_day"],
        "expected": day["expected"],
        "present": day["present"],
        "late": day["late"],
        "on_leave": day["on_leave"],
        "not_checked_in": day["not_checked_in"],
        "pending_leave_requests": pending or 0,
        "attendance_rate": rate,
        "leave_trend": trend,
    }
