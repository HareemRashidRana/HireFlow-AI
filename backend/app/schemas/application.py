import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, StringConstraints

from app.models.application import ApplicationEventType, ApplicationStage
from app.models.candidate import CandidateSource
from app.models.employee import EmploymentType
from app.models.job import JobStatus
from app.models.user import UserRole


def _blank_to_none(value):
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


Note = Annotated[
    Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None,
    BeforeValidator(_blank_to_none),
]
InternalNotes = Annotated[
    Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] | None,
    BeforeValidator(_blank_to_none),
]


class ApplicationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidate_id: uuid.UUID
    job_id: uuid.UUID
    source: CandidateSource | None = None  # defaults to the candidate's own source
    internal_notes: InternalNotes = None


class ApplicationUpdate(BaseModel):
    """PATCH body: only assignment and notes. The stage has its own endpoint, on purpose."""

    model_config = ConfigDict(extra="forbid")

    assigned_recruiter_id: uuid.UUID | None = None  # null unassigns
    internal_notes: InternalNotes = None  # null / blank clears


class StageChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: ApplicationStage
    note: Note = None  # required when rejecting


class ReopenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: Note = None


# ---- read models -----------------------------------------------------------------------------


class CandidateSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    first_name: str
    last_name: str
    email: str


class CandidateDetailSummary(CandidateSummary):
    phone: str | None
    location: str | None
    current_title: str | None
    current_company: str | None
    retain_until: date


class JobSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    department: str
    status: JobStatus


class JobDetailSummary(JobSummary):
    location: str
    employment_type: EmploymentType


class StaffSummary(BaseModel):
    """A staff login, by email only (users have no display name). Never includes secrets."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    role: UserRole


class ApplicationEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_type: ApplicationEventType
    from_value: str | None
    to_value: str | None
    note: str | None
    actor: StaffSummary | None
    created_at: datetime


class _ApplicationBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    stage: ApplicationStage
    source: CandidateSource
    assigned_recruiter: StaffSummary | None
    applied_at: datetime
    stage_changed_at: datetime
    # What the signed-in user may do next (computed by the server from the central workflow).
    allowed_stages: list[ApplicationStage] = []
    can_reopen: bool = False


class ApplicationListItem(_ApplicationBase):
    candidate: CandidateSummary
    job: JobSummary


class ApplicationRead(_ApplicationBase):
    candidate: CandidateDetailSummary
    job: JobDetailSummary
    internal_notes: str | None
    created_at: datetime
    updated_at: datetime
    events: list[ApplicationEventRead]


class ApplicationList(BaseModel):
    items: list[ApplicationListItem]
    total: int
    page: int
    page_size: int
    stage_counts: dict[ApplicationStage, int]


class BoardColumn(BaseModel):
    total: int
    items: list[ApplicationListItem]


class Board(BaseModel):
    columns: dict[ApplicationStage, BoardColumn]
    per_column_limit: int


class RecentApplication(BaseModel):
    id: uuid.UUID
    candidate_name: str
    job_title: str
    stage: ApplicationStage
    applied_at: datetime


class ApplicationSummary(BaseModel):
    total: int
    by_stage: dict[ApplicationStage, int]
    hired: int
    open_jobs_with_applications: int
    recent: list[RecentApplication]
