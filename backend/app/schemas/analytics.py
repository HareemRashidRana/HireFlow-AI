"""Response shapes for recruitment analytics. Aggregates only: no names, emails or notes."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

Granularity = Literal["day", "week", "month"]


class Period(BaseModel):
    start: date
    end: date  # inclusive, in `timezone`
    timezone: str
    granularity: Granularity
    job_id: uuid.UUID | None = None
    department: str | None = None
    generated_at: datetime


class Kpis(BaseModel):
    # Snapshots (right now; the date range does not apply)
    total_employees: int
    active_employees: int
    total_candidates: int
    open_jobs: int
    closed_jobs: int
    upcoming_interviews: int
    # Period figures (the date range applies)
    total_applications: int
    hires: int
    completed_interviews: int


class FunnelStage(BaseModel):
    stage: str
    count: int


class TrendPoint(BaseModel):
    bucket_start: date  # local date on which the bucket starts
    applications: int
    interviews: int
    hires: int


class InterviewStats(BaseModel):
    scheduled: int
    confirmed: int
    completed: int
    cancelled: int
    rescheduled: int
    by_type: dict[str, int]  # scheduled, confirmed and completed interviews only


class SourceCount(BaseModel):
    source: str
    label: str
    count: int


class TimeToHire(BaseModel):
    average_days: float | None
    hires_measured: int  # hires with a recorded hire date
    hires_without_date: int  # hired applications whose history has no hire event


class Activity(BaseModel):
    application_id: uuid.UUID
    event: str
    to_stage: str | None
    job_title: str
    at: datetime


class Overview(BaseModel):
    period: Period
    kpis: Kpis
    funnel: list[FunnelStage]
    trends: list[TrendPoint]
    interviews: InterviewStats
    sources: list[SourceCount]
    time_to_hire: TimeToHire
    recent_activity: list[Activity]


class JobPerformance(BaseModel):
    job_id: uuid.UUID
    title: str
    department: str
    status: str
    applications: int
    interviews: int
    hired: int
    rejected: int
    conversion_rate: float | None  # hired / applications, null when there are no applications


class JobPerformanceList(BaseModel):
    items: list[JobPerformance]
    total: int
    page: int
    page_size: int


class JobOption(BaseModel):
    id: uuid.UUID
    title: str
    department: str
    status: str


class FilterOptions(BaseModel):
    jobs: list[JobOption]
    departments: list[str]
