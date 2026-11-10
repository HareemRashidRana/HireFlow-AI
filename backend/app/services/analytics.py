"""Recruitment analytics: read-only SQL aggregates over the existing tables.

Nothing here writes, nothing is cached, and nothing returns a person's name or contact details.
See docs/ANALYTICS.md for every definition. The short version:

* The funnel counts CURRENT application stages for applications that arrived in the date range, so
  every application is counted exactly once (a reopened one counts where it is now).
* Hires and time-to-hire come from the append-only "hired" history event, the only reliable record
  of WHEN someone was hired. A hired application without that event is reported, never guessed.
* Dates are whole local days in the requested IANA time zone, converted to UTC instants.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import ColumnElement, Select, case, distinct, func, select
from sqlalchemy.orm import Session

from app.core import security
from app.core.exceptions import BusinessRuleError, NotFoundError
from app.models.application import (
    Application,
    ApplicationEvent,
    ApplicationEventType,
    ApplicationStage,
)
from app.models.candidate import Candidate, CandidateSource
from app.models.employee import Employee, EmploymentStatus
from app.models.interview import OCCUPYING, OPEN, Interview, InterviewStatus
from app.models.job import JobPosting, JobStatus

MAX_DAYS = 731
DEFAULT_DAYS = 30
RECENT_LIMIT = 8
FUNNEL_ORDER = tuple(ApplicationStage)  # applied .. offer, hired, rejected, withdrawn
SOURCE_LABELS = {
    CandidateSource.REFERRAL: "Referral",
    CandidateSource.LINKEDIN: "LinkedIn",
    CandidateSource.JOB_BOARD: "Job board",
    CandidateSource.AGENCY: "Agency",
    CandidateSource.DIRECT: "Direct",
    CandidateSource.OTHER: "Other",
}
UNKNOWN_SOURCE = "unknown"


@dataclass(frozen=True)
class Scope:
    start: date
    end: date  # inclusive
    tz: str
    starts_at: datetime  # UTC, inclusive
    ends_at: datetime  # UTC, exclusive
    granularity: str
    edges: tuple[datetime, ...]  # UTC bucket boundaries; bucket i is [edges[i], edges[i + 1])
    bucket_dates: tuple[date, ...]  # local start date of each bucket
    job_id: uuid.UUID | None
    department: str | None


def _local_midnight(day: date, zone: ZoneInfo) -> datetime:
    return datetime.combine(day, time.min, tzinfo=zone).astimezone(UTC)


def _bucket_starts(start: date, end: date, granularity: str) -> list[date]:
    """Local dates on which each bucket begins. The first bucket begins on `start` itself."""
    starts = [start]
    day = start
    while True:
        if granularity == "day":
            day = day + timedelta(days=1)
        elif granularity == "week":
            day = day + timedelta(days=7 - day.weekday())  # next Monday
        else:
            day = date(day.year + (day.month == 12), day.month % 12 + 1, 1)  # first of next month
        if day > end:
            return starts
        starts.append(day)


def make_scope(
    db: Session,
    *,
    start: date | None,
    end: date | None,
    timezone: str,
    job_id: uuid.UUID | None,
    department: str | None,
) -> Scope:
    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        raise BusinessRuleError("That time zone is not recognised.") from None
    today = datetime.now(zone).date()
    end = end or today
    start = start or end - timedelta(days=DEFAULT_DAYS - 1)
    if start > end:
        raise BusinessRuleError("The start date must not be after the end date.")
    days = (end - start).days + 1
    if days > MAX_DAYS:
        raise BusinessRuleError(f"Choose a range of at most {MAX_DAYS} days.")
    department = (department or "").strip() or None
    if department is not None and len(department) > 100:
        raise BusinessRuleError("The department name is too long.")
    if job_id is not None and db.get(JobPosting, job_id) is None:
        raise NotFoundError("Job not found")

    granularity = "day" if days <= 31 else "week" if days <= 183 else "month"
    bucket_dates = _bucket_starts(start, end, granularity)
    edges = [_local_midnight(d, zone) for d in bucket_dates]
    ends_at = _local_midnight(end + timedelta(days=1), zone)
    edges.append(ends_at)
    return Scope(
        start=start,
        end=end,
        tz=timezone,
        starts_at=edges[0],
        ends_at=ends_at,
        granularity=granularity,
        edges=tuple(edges),
        bucket_dates=tuple(bucket_dates),
        job_id=job_id,
        department=department,
    )


# ---- reusable conditions ----------------------------------------------------------------------


def _job_conditions(scope: Scope) -> list[ColumnElement[bool]]:
    out: list[ColumnElement[bool]] = []
    if scope.job_id is not None:
        out.append(JobPosting.id == scope.job_id)
    if scope.department is not None:
        out.append(JobPosting.department == scope.department)
    return out


def _in_range(column: ColumnElement, scope: Scope) -> list[ColumnElement[bool]]:
    return [column >= scope.starts_at, column < scope.ends_at]


def _bucket(column: ColumnElement, scope: Scope) -> ColumnElement:
    """The index of the bucket a timestamp falls in, computed by the database (no row loading)."""
    return case(*[(column < scope.edges[i + 1], i) for i in range(len(scope.bucket_dates))])


def _seconds_between(db: Session, later: ColumnElement, earlier: ColumnElement) -> ColumnElement:
    if db.get_bind().dialect.name == "postgresql":
        return func.extract("epoch", later - earlier)
    return (func.julianday(later) - func.julianday(earlier)) * 86400.0  # SQLite (tests)


def _cohort(stmt: Select, scope: Scope) -> Select:
    """Applications that arrived in the date range, for the chosen job / department."""
    return (
        stmt.select_from(Application)
        .join(JobPosting, JobPosting.id == Application.job_id)
        .where(*_in_range(Application.applied_at, scope), *_job_conditions(scope))
    )


# ---- the overview -------------------------------------------------------------------------------


def _employees(db: Session, scope: Scope) -> tuple[int, int]:
    stmt = select(
        func.count(),
        func.coalesce(
            func.sum(case((Employee.employment_status == EmploymentStatus.ACTIVE, 1), else_=0)), 0
        ),
    )
    if scope.department is not None:
        stmt = stmt.where(Employee.department == scope.department)
    total, active = db.execute(stmt).one()
    return int(total), int(active)


def _jobs(db: Session, scope: Scope) -> tuple[int, int]:
    stmt = select(JobPosting.status, func.count()).group_by(JobPosting.status)
    stmt = stmt.where(*_job_conditions(scope))
    counts = {status: n for status, n in db.execute(stmt)}
    return counts.get(JobStatus.OPEN, 0), counts.get(JobStatus.CLOSED, 0)


def _candidates(db: Session, scope: Scope) -> int:
    if not _job_conditions(scope):
        return db.scalar(select(func.count()).select_from(Candidate)) or 0
    stmt = (
        select(func.count(distinct(Application.candidate_id)))
        .select_from(Application)
        .join(JobPosting, JobPosting.id == Application.job_id)
        .where(*_job_conditions(scope))
    )
    return db.scalar(stmt) or 0


def _interview_stats(db: Session, scope: Scope) -> tuple[dict, int]:
    by_status = {s: 0 for s in InterviewStatus}
    stmt = (
        select(Interview.status, func.count())
        .select_from(Interview)
        .join(Application, Application.id == Interview.application_id)
        .join(JobPosting, JobPosting.id == Application.job_id)
        .where(*_in_range(Interview.starts_at, scope), *_job_conditions(scope))
        .group_by(Interview.status)
    )
    for status, n in db.execute(stmt):
        by_status[status] = n
    by_type: dict[str, int] = {}
    type_stmt = (
        select(Interview.interview_type, func.count())
        .select_from(Interview)
        .join(Application, Application.id == Interview.application_id)
        .join(JobPosting, JobPosting.id == Application.job_id)
        .where(
            *_in_range(Interview.starts_at, scope),
            *_job_conditions(scope),
            Interview.status.in_(OCCUPYING),
        )
        .group_by(Interview.interview_type)
        .order_by(func.count().desc(), Interview.interview_type)
    )
    for kind, n in db.execute(type_stmt):
        by_type[kind.value] = n
    upcoming = db.scalar(
        select(func.count())
        .select_from(Interview)
        .join(Application, Application.id == Interview.application_id)
        .join(JobPosting, JobPosting.id == Application.job_id)
        .where(
            Interview.status.in_(OPEN),
            Interview.starts_at >= security.utcnow(),
            *_job_conditions(scope),
        )
    )
    stats = {
        "scheduled": by_status[InterviewStatus.SCHEDULED],
        "confirmed": by_status[InterviewStatus.CONFIRMED],
        "completed": by_status[InterviewStatus.COMPLETED],
        "cancelled": by_status[InterviewStatus.CANCELLED],
        "rescheduled": by_status[InterviewStatus.RESCHEDULED],
        "by_type": by_type,
    }
    return stats, upcoming or 0


def _hired_events() -> Select:
    """One row per application hired inside the range (hired is final, so at most one event)."""
    return (
        select(
            ApplicationEvent.application_id.label("application_id"),
            func.min(ApplicationEvent.created_at).label("hired_at"),
        )
        .where(ApplicationEvent.event_type == ApplicationEventType.HIRED)
        .group_by(ApplicationEvent.application_id)
    )


def _hires(db: Session, scope: Scope) -> tuple[int, float | None, int, int]:
    """(hires in range, average days to hire, hires measured, hired without a recorded date)."""
    hired = _hired_events().subquery()
    seconds = _seconds_between(db, hired.c.hired_at, Application.applied_at)
    stmt = (
        select(func.count(), func.avg(seconds))
        .select_from(hired)
        .join(Application, Application.id == hired.c.application_id)
        .join(JobPosting, JobPosting.id == Application.job_id)
        .where(*_in_range(hired.c.hired_at, scope), *_job_conditions(scope))
    )
    count, avg_seconds = db.execute(stmt).one()
    undated = db.scalar(
        _cohort(select(func.count()), scope).where(
            Application.stage == ApplicationStage.HIRED,
            ~Application.id.in_(
                select(ApplicationEvent.application_id).where(
                    ApplicationEvent.event_type == ApplicationEventType.HIRED
                )
            ),
        )
    )
    average = round(float(avg_seconds) / 86400, 1) if avg_seconds is not None else None
    return int(count), average, int(count), int(undated or 0)


def _trends(db: Session, scope: Scope) -> list[dict]:
    n = len(scope.bucket_dates)
    series = {"applications": [0] * n, "interviews": [0] * n, "hires": [0] * n}

    bucket = _bucket(Application.applied_at, scope)
    stmt = _cohort(select(bucket, func.count()), scope).group_by(bucket)
    for i, count in db.execute(stmt):
        series["applications"][i] = count

    bucket = _bucket(Interview.starts_at, scope)
    stmt = (
        select(bucket, func.count())
        .select_from(Interview)
        .join(Application, Application.id == Interview.application_id)
        .join(JobPosting, JobPosting.id == Application.job_id)
        .where(
            *_in_range(Interview.starts_at, scope),
            *_job_conditions(scope),
            Interview.status.in_(OCCUPYING),
        )
        .group_by(bucket)
    )
    for i, count in db.execute(stmt):
        series["interviews"][i] = count

    hired = _hired_events().subquery()
    bucket = _bucket(hired.c.hired_at, scope)
    stmt = (
        select(bucket, func.count())
        .select_from(hired)
        .join(Application, Application.id == hired.c.application_id)
        .join(JobPosting, JobPosting.id == Application.job_id)
        .where(*_in_range(hired.c.hired_at, scope), *_job_conditions(scope))
        .group_by(bucket)
    )
    for i, count in db.execute(stmt):
        series["hires"][i] = count

    return [
        {
            "bucket_start": scope.bucket_dates[i],
            "applications": series["applications"][i],
            "interviews": series["interviews"][i],
            "hires": series["hires"][i],
        }
        for i in range(n)
    ]


def _funnel(db: Session, scope: Scope) -> list[dict]:
    counts = dict.fromkeys(FUNNEL_ORDER, 0)
    stmt = _cohort(select(Application.stage, func.count()), scope).group_by(Application.stage)
    for stage, n in db.execute(stmt):
        counts[stage] = n
    return [{"stage": s.value, "count": counts[s]} for s in FUNNEL_ORDER]


def _sources(db: Session, scope: Scope) -> list[dict]:
    stmt = (
        _cohort(select(Application.source, func.count()), scope)
        .group_by(Application.source)
        .order_by(func.count().desc(), Application.source)
    )
    rows = [
        {"source": s.value, "label": SOURCE_LABELS.get(s, s.value), "count": n}
        for s, n in db.execute(stmt)
        if s is not None
    ]
    missing = db.scalar(_cohort(select(func.count()), scope).where(Application.source.is_(None)))
    if missing:
        label = "Unknown / Not specified"
        rows.append({"source": UNKNOWN_SOURCE, "label": label, "count": missing})
    return rows


def _recent(db: Session, scope: Scope) -> list[dict]:
    stmt = (
        select(
            ApplicationEvent.application_id,
            ApplicationEvent.event_type,
            ApplicationEvent.to_value,
            JobPosting.title,
            ApplicationEvent.created_at,
        )
        .select_from(ApplicationEvent)
        .join(Application, Application.id == ApplicationEvent.application_id)
        .join(JobPosting, JobPosting.id == Application.job_id)
        .where(
            ApplicationEvent.event_type != ApplicationEventType.NOTES_UPDATED,
            *_job_conditions(scope),
        )
        .order_by(ApplicationEvent.created_at.desc(), ApplicationEvent.id)
        .limit(RECENT_LIMIT)
    )
    return [
        {
            "application_id": app_id,
            "event": kind.value,
            "to_stage": to_value,
            "job_title": title,
            "at": at,
        }
        for app_id, kind, to_value, title, at in db.execute(stmt)
    ]


def overview(db: Session, scope: Scope) -> dict:
    total_employees, active_employees = _employees(db, scope)
    open_jobs, closed_jobs = _jobs(db, scope)
    funnel = _funnel(db, scope)
    interview_stats, upcoming = _interview_stats(db, scope)
    hires, average_days, measured, undated = _hires(db, scope)
    return {
        "period": {
            "start": scope.start,
            "end": scope.end,
            "timezone": scope.tz,
            "granularity": scope.granularity,
            "job_id": scope.job_id,
            "department": scope.department,
            "generated_at": security.utcnow(),
        },
        "kpis": {
            "total_employees": total_employees,
            "active_employees": active_employees,
            "total_candidates": _candidates(db, scope),
            "open_jobs": open_jobs,
            "closed_jobs": closed_jobs,
            "upcoming_interviews": upcoming,
            "total_applications": sum(f["count"] for f in funnel),
            "hires": hires,
            "completed_interviews": interview_stats["completed"],
        },
        "funnel": funnel,
        "trends": _trends(db, scope),
        "interviews": interview_stats,
        "sources": _sources(db, scope),
        "time_to_hire": {
            "average_days": average_days,
            "hires_measured": measured,
            "hires_without_date": undated,
        },
        "recent_activity": _recent(db, scope),
    }


# ---- job performance ----------------------------------------------------------------------------


def job_performance(db: Session, scope: Scope, *, page: int, page_size: int) -> dict:
    apps = (
        _cohort(
            select(
                Application.job_id.label("job_id"),
                func.count().label("applications"),
                func.sum(case((Application.stage == ApplicationStage.HIRED, 1), else_=0)).label(
                    "hired"
                ),
                func.sum(case((Application.stage == ApplicationStage.REJECTED, 1), else_=0)).label(
                    "rejected"
                ),
            ),
            scope,
        )
        .group_by(Application.job_id)
        .subquery()
    )
    interviews = (
        _cohort(
            select(Application.job_id.label("job_id"), func.count(Interview.id).label("n")),
            scope,
        )
        .join(Interview, Interview.application_id == Application.id)
        .where(Interview.status.in_(OCCUPYING))
        .group_by(Application.job_id)
        .subquery()
    )
    applications = func.coalesce(apps.c.applications, 0)
    base = (
        select(
            JobPosting.id,
            JobPosting.title,
            JobPosting.department,
            JobPosting.status,
            applications.label("applications"),
            func.coalesce(interviews.c.n, 0).label("interviews"),
            func.coalesce(apps.c.hired, 0).label("hired"),
            func.coalesce(apps.c.rejected, 0).label("rejected"),
        )
        .select_from(JobPosting)
        .outerjoin(apps, apps.c.job_id == JobPosting.id)
        .outerjoin(interviews, interviews.c.job_id == JobPosting.id)
        .where(*_job_conditions(scope))
    )
    total = db.scalar(select(func.count()).select_from(JobPosting).where(*_job_conditions(scope)))
    rows = db.execute(
        base.order_by(applications.desc(), JobPosting.title, JobPosting.id)
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()
    items = [
        {
            "job_id": r.id,
            "title": r.title,
            "department": r.department,
            "status": r.status.value,
            "applications": int(r.applications),
            "interviews": int(r.interviews),
            "hired": int(r.hired),
            "rejected": int(r.rejected),
            "conversion_rate": round(int(r.hired) / int(r.applications), 4)
            if r.applications
            else None,
        }
        for r in rows
    ]
    return {"items": items, "total": total or 0, "page": page, "page_size": page_size}


def filter_options(db: Session) -> dict:
    jobs = db.execute(
        select(JobPosting.id, JobPosting.title, JobPosting.department, JobPosting.status)
        .order_by(JobPosting.title, JobPosting.id)
        .limit(500)
    ).all()
    departments = sorted(
        {d for (d,) in db.execute(select(JobPosting.department).distinct())}
        | {d for (d,) in db.execute(select(Employee.department).distinct())}
    )
    return {
        "jobs": [
            {"id": j.id, "title": j.title, "department": j.department, "status": j.status.value}
            for j in jobs
        ],
        "departments": departments,
    }
