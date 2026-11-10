"""Requirements Coverage API shapes.

There is deliberately no field here that ranks, recommends or labels a person, and no sort or
filter parameter that uses a figure. Review input is a person's own judgement; it is stored
separately from the algorithm's result.
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
    model_validator,
)

from app.models.screening import AdjustmentReason, ReviewJudgement
from app.schemas.application import StaffSummary

MAX_ADJUSTMENTS = 30
Freshness = Literal["current", "outdated", "scrubbed"]
Blocker = Literal["no_active_resume", "resume_not_reviewed", "candidate_anonymized"]


def _blank_to_none(value):
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


Note = Annotated[
    Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] | None,
    BeforeValidator(_blank_to_none),
]
Requirement = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]


class ReviewCreate(BaseModel):
    """A person's judgement of one assessment. It never changes the assessment itself."""

    model_config = ConfigDict(extra="forbid")

    judgement: ReviewJudgement
    # Requirements the person counts as covered although the resume does not list them. This
    # produces a separate adjusted figure and always needs a reason.
    adjustments: Annotated[list[Requirement], Field(max_length=MAX_ADJUSTMENTS)] = []
    adjustment_reason: AdjustmentReason | None = None
    note: Note = None

    @model_validator(mode="after")
    def _adjustments_need_a_reason(self):
        if len(set(self.adjustments)) != len(self.adjustments):
            raise ValueError("Each requirement can be adjusted only once")
        if self.adjustments and self.adjustment_reason is None:
            raise ValueError("Choose a reason for the adjustment")
        if not self.adjustments and self.adjustment_reason is not None:
            raise ValueError("A reason is only used together with an adjustment")
        return self


# ---- responses ---------------------------------------------------------------------------------


class SkillEvidenceRead(BaseModel):
    requirement: str
    status: Literal["listed", "not listed"]
    matched_text: str | None = None
    matched_via: Literal["exact", "alias"] | None = None


class CriterionRead(BaseModel):
    key: Literal["required_skills", "preferred_skills"]
    label: str
    nominal_weight: int
    effective_weight: float | None
    status: Literal["assessed", "not_assessed"]
    reason_code: str | None
    reason: str | None
    listed: int
    total: int
    points: float | None
    evidence: list[SkillEvidenceRead] | None = None  # None once a privacy scrub removed it


class ExperienceRead(BaseModel):
    dated_months: int
    dated_text: str
    positions_total: int
    positions_counted: int
    positions_not_counted: int
    approximate: bool
    notes: list[str]
    note: str  # always: "context only, not a relevance assessment"


class WarningRead(BaseModel):
    code: str
    text: str


class FreshnessRead(BaseModel):
    state: Freshness
    reasons: list[str]
    reason_texts: list[str]


class ResumeSourceRead(BaseModel):
    version_number: int | None
    reviewed_at: datetime | None
    still_exists: bool


class ReviewRead(BaseModel):
    id: uuid.UUID
    judgement: ReviewJudgement
    adjustments: list[str] | None
    adjustment_reason: AdjustmentReason | None
    adjusted_total: float | None  # the separate, person-adjusted figure; the original is unchanged
    note: str | None
    reviewer: StaffSummary | None
    created_at: datetime
    scrubbed: bool


class AssessmentRead(BaseModel):
    id: uuid.UUID
    application_id: uuid.UUID
    assessment_number: int
    created_at: datetime
    requested_by: StaffSummary | None
    scoring_version: str
    alias_table_version: str
    weights: dict[str, int]
    job_requirements: dict[str, list[str]]
    status: Literal["scored", "unscored"]
    total_score: float | None
    assessed_weight: int
    criteria: list[CriterionRead]
    experience: ExperienceRead | None
    warnings: list[WarningRead]
    explanation: str
    limitations: list[str]
    resume: ResumeSourceRead
    freshness: FreshnessRead
    scrubbed: bool
    scrub_reason: str | None
    reviews: list[ReviewRead]
    unlisted_requirements: list[str]  # what an adjustment may mark as covered
    created: bool = True  # False when an identical assessment already existed


class AssessmentSummary(BaseModel):
    id: uuid.UUID
    assessment_number: int
    created_at: datetime
    scoring_version: str
    status: Literal["scored", "unscored"]
    total_score: float | None
    assessed_weight: int
    freshness: Freshness
    scrubbed: bool
    review_count: int
    requested_by: StaffSummary | None


class ReadinessRead(BaseModel):
    can_assess: bool
    blocker: Blocker | None
    blocker_text: str | None


class ApplicationScreeningRead(BaseModel):
    application_id: uuid.UUID
    readiness: ReadinessRead
    job_requirements: dict[str, list[str]]
    items: list[AssessmentSummary]  # newest first; never ordered by figure
    total: int


class JobScreeningItem(BaseModel):
    """One applicant's screening STATE. No figure is shown here, on purpose."""

    application_id: uuid.UUID
    candidate_id: uuid.UUID
    candidate_name: str
    stage: str
    applied_at: datetime
    state: Literal["not_assessed", "current", "outdated", "scrubbed", "cannot_assess"]
    blocker: Blocker | None
    assessment_count: int
    last_assessed_at: datetime | None


class JobScreeningRead(BaseModel):
    job_id: uuid.UUID
    items: list[JobScreeningItem]  # ordered by application date, always
    total: int
    page: int
    page_size: int


class MethodologyRead(BaseModel):
    name: str
    scoring_version: str
    alias_table_version: str
    summary: str
    weights: dict[str, int]
    how_it_works: list[str]
    limitations: list[str]
    experience_note: str
    not_used: list[str]
