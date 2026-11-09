import uuid
from datetime import datetime
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.models.employee import EmploymentType
from app.models.job import JobStatus

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=150)]
Department = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Location = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)]
# Plain text only. The frontend renders it as text (never as HTML), so markup is inert.
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=10_000)]
Currency = Annotated[
    str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z]{3}$")
]
Money = Annotated[int, Field(ge=0, le=1_000_000_000)]

MAX_SKILLS = 30
MAX_SKILL_LENGTH = 50


def normalise_skills(values: list[str]) -> list[str]:
    """Trim, drop blanks, de-duplicate case-insensitively (keeping first spelling), cap the size."""
    seen: set[str] = set()
    result: list[str] = []
    for raw in values:
        skill = " ".join(raw.split())  # collapse inner whitespace
        if not skill:
            continue
        if len(skill) > MAX_SKILL_LENGTH:
            raise ValueError(f"Each skill must be at most {MAX_SKILL_LENGTH} characters")
        if skill.lower() not in seen:
            seen.add(skill.lower())
            result.append(skill)
    if len(result) > MAX_SKILLS:
        raise ValueError(f"At most {MAX_SKILLS} skills are allowed per list")
    return result


def check_salary(low: int | None, high: int | None, currency: str | None) -> None:
    """Shared by create (schema) and update (service, on the merged values). Raises ValueError."""
    if low is not None and high is not None and low > high:
        raise ValueError("Minimum salary cannot be greater than maximum salary")
    if (low is not None or high is not None) and not currency:
        raise ValueError("Choose a currency for the salary range")
    if low is None and high is None and currency:
        raise ValueError("A currency needs a salary amount")


class _SkillsMixin(BaseModel):
    @field_validator("required_skills", "nice_to_have_skills", check_fields=False)
    @classmethod
    def _skills(cls, v: list[str] | None) -> list[str] | None:
        return normalise_skills(v) if v is not None else v


class JobCreate(_SkillsMixin):
    """New jobs always start as drafts: the status changes only through the status endpoint."""

    model_config = ConfigDict(extra="forbid")

    title: Title
    department: Department
    location: Location
    employment_type: EmploymentType
    description: Description = ""
    required_skills: list[str] = Field(default_factory=list)
    nice_to_have_skills: list[str] = Field(default_factory=list)
    min_experience_years: Annotated[int, Field(ge=0, le=50)] | None = None
    salary_min: Money | None = None
    salary_max: Money | None = None
    salary_currency: Currency | None = None
    openings: Annotated[int, Field(ge=1, le=500)] = 1
    hiring_manager_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _salary(self) -> "JobCreate":
        check_salary(self.salary_min, self.salary_max, self.salary_currency)
        return self


_NON_NULLABLE = (
    "title",
    "department",
    "location",
    "employment_type",
    "description",
    "required_skills",
    "nice_to_have_skills",
    "openings",
)


class JobUpdate(_SkillsMixin):
    """PATCH body: send only what changes. Status is not editable here."""

    model_config = ConfigDict(extra="forbid")

    title: Title | None = None
    department: Department | None = None
    location: Location | None = None
    employment_type: EmploymentType | None = None
    description: Description | None = None
    required_skills: list[str] | None = None
    nice_to_have_skills: list[str] | None = None
    min_experience_years: Annotated[int, Field(ge=0, le=50)] | None = None  # null clears
    salary_min: Money | None = None  # null clears
    salary_max: Money | None = None
    salary_currency: Currency | None = None
    openings: Annotated[int, Field(ge=1, le=500)] | None = None
    hiring_manager_id: uuid.UUID | None = None  # null clears

    @model_validator(mode="after")
    def _no_null_for_required(self) -> "JobUpdate":
        for name in _NON_NULLABLE:
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class JobStatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: JobStatus


class HiringManagerRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    first_name: str
    last_name: str
    job_title: str


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    department: str
    location: str
    employment_type: EmploymentType
    description: str
    required_skills: list[str]
    nice_to_have_skills: list[str]
    min_experience_years: int | None
    salary_min: int | None
    salary_max: int | None
    salary_currency: str | None
    openings: int
    status: JobStatus
    hiring_manager_id: uuid.UUID | None
    hiring_manager: HiringManagerRef | None
    opened_at: datetime | None
    closed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class JobList(BaseModel):
    items: list[JobRead]
    total: int = Field(description="Matching jobs across all pages (after every filter)")
    page: int
    page_size: int
    status_counts: dict[JobStatus, int] = Field(
        description="Jobs per status under the current filters, ignoring the status filter itself"
    )
