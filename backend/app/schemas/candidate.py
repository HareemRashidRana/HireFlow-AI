import enum
import uuid
from datetime import date, datetime, timedelta
from typing import Annotated, Any

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.core import security
from app.models.candidate import CandidateSource, ConsentBasis
from app.schemas.employee import Phone


def _blank_to_none(value: Any) -> Any:
    """Optional text fields: an empty or whitespace-only string means "not provided"."""
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
_Text150 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=150)]
OptionalText = Annotated[_Text150 | None, BeforeValidator(_blank_to_none)]
OptionalPhone = Annotated[Phone | None, BeforeValidator(_blank_to_none)]
BasisNote = Annotated[
    Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None,
    BeforeValidator(_blank_to_none),
]


# A browser sends the user's LOCAL calendar date, and for people east of UTC that date is already
# "tomorrow" in UTC for part of every day. One day of slack covers every real time zone (the
# largest offset is UTC+14) while still rejecting dates that are genuinely in the future.
_TIME_ZONE_SLACK = timedelta(days=1)


def _not_in_future(value: date) -> date:
    if value > security.utcnow().date() + _TIME_ZONE_SLACK:
        raise ValueError("The consent / basis date cannot be in the future")
    return value


class _ConsentMixin(BaseModel):
    @field_validator("consent_date", check_fields=False)
    @classmethod
    def _consent_date(cls, v: date | None) -> date | None:
        return _not_in_future(v) if v is not None else v


class CandidateCreate(_ConsentMixin):
    model_config = ConfigDict(extra="forbid")

    first_name: Name
    last_name: Name
    email: EmailStr
    phone: OptionalPhone = None
    location: OptionalText = None
    current_title: OptionalText = None
    current_company: OptionalText = None
    source: CandidateSource
    consent_basis: ConsentBasis
    consent_basis_note: BasisNote = None
    consent_date: date

    @field_validator("email")
    @classmethod
    def _lowercase_email(cls, v: str) -> str:
        return v.lower()  # stored lowercase so uniqueness is case-insensitive

    @model_validator(mode="after")
    def _basis_note(self) -> "CandidateCreate":
        check_basis_note(self.consent_basis, self.consent_basis_note)
        return self


def check_basis_note(basis: ConsentBasis, note: str | None) -> None:
    """Shared by create (schema) and update (service, on merged values). Raises ValueError."""
    if basis == ConsentBasis.OTHER and not note:
        raise ValueError("Explain the basis when you choose 'other'")
    if basis != ConsentBasis.OTHER and note:
        raise ValueError("An explanation is only needed when the basis is 'other'")


_NON_NULLABLE = ("first_name", "last_name", "email", "source", "consent_basis", "consent_date")


class CandidateUpdate(_ConsentMixin):
    """PATCH body: send only what changes. `null` clears the optional fields."""

    model_config = ConfigDict(extra="forbid")

    first_name: Name | None = None
    last_name: Name | None = None
    email: EmailStr | None = None
    phone: OptionalPhone = None
    location: OptionalText = None
    current_title: OptionalText = None
    current_company: OptionalText = None
    source: CandidateSource | None = None
    consent_basis: ConsentBasis | None = None
    consent_basis_note: BasisNote = None
    consent_date: date | None = None

    @field_validator("email")
    @classmethod
    def _lowercase_email(cls, v: str | None) -> str | None:
        return v.lower() if v else v

    @model_validator(mode="after")
    def _no_null_for_required(self) -> "CandidateUpdate":
        for name in _NON_NULLABLE:
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class CandidateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    first_name: str
    last_name: str
    email: str
    phone: str | None
    location: str | None
    current_title: str | None
    current_company: str | None
    source: CandidateSource
    consent_basis: ConsentBasis
    consent_basis_note: str | None
    consent_date: date
    last_activity_at: datetime
    retain_until: date
    anonymized_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CandidateListItem(BaseModel):
    """Lean row for the directory. Phone and consent details are only on the detail view."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    first_name: str
    last_name: str
    email: str
    location: str | None
    current_title: str | None
    current_company: str | None
    source: CandidateSource
    last_activity_at: datetime
    retain_until: date
    created_at: datetime


class CandidateList(BaseModel):
    items: list[CandidateListItem]
    total: int
    page: int
    page_size: int


class RetentionFilter(enum.StrEnum):
    EXPIRING = "expiring"  # retention date within the next 30 days
    EXPIRED = "expired"  # retention date has passed: due for review / erasure
