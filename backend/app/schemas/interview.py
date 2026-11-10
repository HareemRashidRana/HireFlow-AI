"""Interview API shapes.

Responses carry no candidate contact details (name and the job only). There is no field here that
scores, ranks or orders people.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.models.interview import (
    FeedbackStatus,
    InterviewEventType,
    InterviewMode,
    InterviewStatus,
    InterviewType,
)
from app.models.user import UserRole
from app.services import interview_rules as rules

MAX_INTERVIEWERS = 10


def _blank_to_none(value):
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def _text(max_length: int):
    return Annotated[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=max_length)] | None,
        BeforeValidator(_blank_to_none),
    ]


Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)]
Rating = Annotated[int, Field(ge=1, le=5)] | None


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Schedule(_Base):
    @field_validator("timezone", check_fields=False)
    @classmethod
    def _zone(cls, v: str | None):
        if v is not None:
            rules.zone(v)  # raises ValueError -> 422
        return v


class InterviewCreate(_Schedule):
    application_id: uuid.UUID
    title: Title
    interview_type: InterviewType
    mode: InterviewMode
    # A plain local time ("2026-11-20T10:00") is read in `timezone`; a value with an offset is
    # converted as it is.
    starts_at: datetime
    ends_at: datetime
    timezone: str
    location: _text(255) = None
    meeting_url: _text(500) = None
    round_number: Annotated[int, Field(ge=1, le=20)] | None = None  # default: the next round
    interviewer_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=MAX_INTERVIEWERS)]

    @field_validator("meeting_url")
    @classmethod
    def _url(cls, v):
        return rules.clean_meeting_url(v)

    @model_validator(mode="after")
    def _place(self):
        if len(set(self.interviewer_ids)) != len(self.interviewer_ids):
            raise ValueError("Each interviewer can be added only once")
        if self.mode == InterviewMode.IN_PERSON and not self.location:
            raise ValueError("Add the location for an in-person interview")
        return self


class InterviewUpdate(_Base):
    """Details only. Times change through a reschedule; the status through its own actions."""

    title: Title | None = None
    interview_type: InterviewType | None = None
    mode: InterviewMode | None = None
    location: _text(255) = None
    meeting_url: _text(500) = None
    round_number: Annotated[int, Field(ge=1, le=20)] | None = None

    @field_validator("meeting_url")
    @classmethod
    def _url(cls, v):
        return rules.clean_meeting_url(v)


class RescheduleRequest(_Schedule):
    starts_at: datetime
    ends_at: datetime
    timezone: str | None = None  # default: the interview's current zone
    reason: _text(300) = None
    interviewer_ids: (
        Annotated[list[uuid.UUID], Field(min_length=1, max_length=MAX_INTERVIEWERS)] | None
    ) = None


class CancelRequest(_Base):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class InterviewerAdd(_Base):
    user_id: uuid.UUID


class FeedbackContent(_Base):
    overall_rating: Rating = None
    technical_rating: Rating = None
    communication_rating: Rating = None
    problem_solving_rating: Rating = None
    overall_feedback: _text(4000) = None
    technical_notes: _text(4000) = None
    role_notes: _text(4000) = None
    strengths: _text(4000) = None
    concerns: _text(4000) = None
    private_notes: _text(4000) = None


class FeedbackSubmit(FeedbackContent):
    """Submitting needs an overall rating and overall feedback written by the interviewer."""

    @model_validator(mode="after")
    def _complete(self):
        if self.overall_rating is None:
            raise ValueError("Choose an overall rating before submitting")
        if not self.overall_feedback:
            raise ValueError("Write the overall feedback before submitting")
        return self


class FeedbackEdit(FeedbackSubmit):
    """Changing submitted feedback always needs a reason; the previous version is kept."""

    edit_reason: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)
    ]


# ---- responses ---------------------------------------------------------------------------------


class StaffRef(BaseModel):
    id: uuid.UUID
    email: str
    role: UserRole


class InterviewerRead(StaffRef):
    feedback_status: Literal["none", "draft", "submitted"]


class CandidateRef(BaseModel):
    id: uuid.UUID
    first_name: str
    last_name: str  # never an email or phone


class JobRef(BaseModel):
    id: uuid.UUID
    title: str


class ApplicationRef(BaseModel):
    id: uuid.UUID
    stage: str
    candidate: CandidateRef
    job: JobRef


class InterviewRead(BaseModel):
    id: uuid.UUID
    application: ApplicationRef
    title: str
    interview_type: InterviewType
    round_number: int
    mode: InterviewMode
    status: InterviewStatus
    starts_at: datetime
    ends_at: datetime
    timezone: str
    starts_local: str
    ends_local: str
    utc_offset: str
    duration_minutes: int
    location: str | None
    meeting_url: str | None
    interviewers: list[InterviewerRead]
    rescheduled_from_id: uuid.UUID | None
    rescheduled_to_id: uuid.UUID | None
    cancellation_reason: str | None
    cancelled_at: datetime | None
    completed_at: datetime | None
    created_by: StaffRef | None
    updated_by: StaffRef | None
    created_at: datetime
    updated_at: datetime
    scrubbed: bool
    allowed_actions: list[str]  # what THIS user may do next: the UI never re-implements the rules
    my_feedback_status: Literal["none", "draft", "submitted"] | None  # None when not an interviewer


class InterviewList(BaseModel):
    items: list[InterviewRead]
    total: int
    page: int
    page_size: int


class EventRead(BaseModel):
    id: uuid.UUID
    event_type: InterviewEventType
    actor: StaffRef | None
    details: dict
    created_at: datetime


class FeedbackRead(BaseModel):
    id: uuid.UUID
    interview_id: uuid.UUID
    interviewer: StaffRef | None
    status: FeedbackStatus
    overall_rating: int | None
    technical_rating: int | None
    communication_rating: int | None
    problem_solving_rating: int | None
    overall_feedback: str | None
    technical_notes: str | None
    role_notes: str | None
    strengths: str | None
    concerns: str | None
    private_notes: str | None  # only ever filled for the author
    version: int
    submitted_at: datetime | None
    updated_at: datetime
    is_mine: bool
    scrubbed: bool


class FeedbackOverview(BaseModel):
    interview_id: uuid.UUID
    items: list[FeedbackRead]
    can_view_all: bool  # HR and admin see every submitted feedback; others only their own
    submitted_count: int
    pending_interviewers: list[StaffRef]  # interviewers with no submitted feedback yet


class RevisionRead(BaseModel):
    version: int
    snapshot: dict
    edit_reason: str | None
    edited_by: StaffRef | None
    created_at: datetime


class StatusCounts(BaseModel):
    scheduled: int = 0
    confirmed: int = 0
    completed: int = 0
    cancelled: int = 0
    rescheduled: int = 0


class DayCount(BaseModel):
    date: str
    count: int


class InterviewStats(BaseModel):
    total: int
    by_status: StatusCounts
    upcoming: int
    next_7_days: int
    feedback_pending: int
    feedback_submitted: int
    upcoming_by_day: list[DayCount]


class RatingOption(BaseModel):
    value: int
    label: str
    description: str


class RatingArea(BaseModel):
    key: str
    label: str
    required_to_submit: bool


class RatingScale(BaseModel):
    scale: list[RatingOption]
    areas: list[RatingArea]
