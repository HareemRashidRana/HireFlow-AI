import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    computed_field,
)

from app.models.resume import ResumeStatus
from app.schemas.application import StaffSummary


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


Confidence = Literal["high", "medium", "low"]
_Date = Annotated[str | None, StringConstraints(pattern=r"^\d{4}(-(0[1-9]|1[0-2]))?$")]

# ---- what the parser found (read-only) ---------------------------------------------------------


class ParsedField(BaseModel):
    value: str | None = None
    confidence: Confidence | None = None


class ParsedSkills(BaseModel):
    values: list[str] = []
    confidence: Confidence | None = None
    source: str | None = None


class ParsedEducation(BaseModel):
    degree: str | None = None
    field: str | None = None
    institution: str | None = None
    start_year: int | None = None
    end_year: int | None = None
    confidence: Confidence | None = None


class ParsedExperience(BaseModel):
    title: str | None = None
    company: str | None = None
    start: str | None = None
    end: str | None = None
    current: bool = False
    months: int | None = None
    date_precision: str | None = None
    confidence: Confidence | None = None


class ParsedResume(BaseModel):
    parser_version: int = 1
    name: ParsedField = ParsedField()
    email: ParsedField = ParsedField()
    phone: ParsedField = ParsedField()
    skills: ParsedSkills = ParsedSkills()
    education: list[ParsedEducation] = []
    experience: list[ParsedExperience] = []
    total_experience_months: int | None = None
    total_experience_confidence: Confidence | None = None
    sections_found: list[str] = []
    warnings: list[str] = []


# ---- what a person confirmed or corrected (editable) -------------------------------------------


class ReviewedEducation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    institution: _text(150) = None
    degree: _text(100) = None
    field: _text(100) = None
    start_year: Annotated[int | None, Field(ge=1950, le=2100)] = None
    end_year: Annotated[int | None, Field(ge=1950, le=2100)] = None


class ReviewedExperience(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: _text(150) = None
    company: _text(150) = None
    start: _Date = None
    end: _Date = None
    current: bool = False


class ReviewedResume(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: _text(100) = None
    email: Annotated[EmailStr | None, BeforeValidator(_blank_to_none)] = None
    phone: _text(30) = None
    skills: Annotated[
        list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]],
        Field(max_length=100),
    ] = []
    education: Annotated[list[ReviewedEducation], Field(max_length=20)] = []
    experience: Annotated[list[ReviewedExperience], Field(max_length=30)] = []


class ResumeReviewRequest(ReviewedResume):
    """Saving a review is an explicit human act: `confirm` must be true."""

    confirm: Literal[True]


class ResumeLinkUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    application_id: uuid.UUID | None = None  # null unlinks


# ---- responses ---------------------------------------------------------------------------------


class ResumeRead(BaseModel):
    """File metadata only: never the text, the parsed data, the storage key or any path."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    candidate_id: uuid.UUID
    application_id: uuid.UUID | None
    version_number: int
    original_filename: str
    extension: str
    mime_type: str
    size_bytes: int
    status: ResumeStatus
    parse_error_code: str | None
    text_chars: int | None
    is_active: bool
    created_at: datetime
    uploaded_by: StaffSummary | None
    parsed_at: datetime | None
    reviewed_at: datetime | None
    reviewed_by: StaffSummary | None
    file_removed_at: datetime | None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def reviewed(self) -> bool:
        return self.reviewed_at is not None


class ResumeList(BaseModel):
    items: list[ResumeRead]
    total: int
    page: int
    page_size: int


class ResumeParsedRead(BaseModel):
    resume: ResumeRead
    parsed: ParsedResume | None
    reviewed: ReviewedResume | None
