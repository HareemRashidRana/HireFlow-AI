import uuid
from datetime import date, datetime, timedelta
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.models.employee import EmploymentStatus, EmploymentType

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
JobTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)]
Department = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
EmployeeCode = Annotated[
    str,
    StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z0-9-]{3,20}$"),
]
Phone = Annotated[
    str, StringConstraints(strip_whitespace=True, pattern=r"^\+?[0-9][0-9 ()\-]{5,18}[0-9]$")
]

# Fields that are optional on PATCH (may be omitted) but can never be set to null.
_NON_NULLABLE = (
    "employee_id",
    "first_name",
    "last_name",
    "work_email",
    "job_title",
    "department",
    "employment_type",
    "employment_status",
    "date_of_joining",
)


def _check_join_date(value: date | None) -> date | None:
    if value is not None and value > date.today() + timedelta(days=366):
        raise ValueError("date_of_joining cannot be more than a year in the future")
    return value


class EmployeeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee_id: EmployeeCode
    first_name: Name
    last_name: Name
    work_email: EmailStr
    phone_number: Phone | None = None
    job_title: JobTitle
    department: Department
    employment_type: EmploymentType
    employment_status: EmploymentStatus = EmploymentStatus.ACTIVE
    date_of_joining: date
    manager_id: uuid.UUID | None = None

    @field_validator("work_email")
    @classmethod
    def _lowercase_email(cls, v: str) -> str:
        return v.lower()  # emails are stored lowercase so uniqueness is case-insensitive

    @field_validator("date_of_joining")
    @classmethod
    def _join_date(cls, v: date) -> date:
        return _check_join_date(v)  # type: ignore[return-value]


class EmployeeUpdate(BaseModel):
    """PATCH body: send only the fields you want to change."""

    model_config = ConfigDict(extra="forbid")

    employee_id: EmployeeCode | None = None
    first_name: Name | None = None
    last_name: Name | None = None
    work_email: EmailStr | None = None
    phone_number: Phone | None = None  # null clears the phone number
    job_title: JobTitle | None = None
    department: Department | None = None
    employment_type: EmploymentType | None = None
    employment_status: EmploymentStatus | None = None
    date_of_joining: date | None = None
    manager_id: uuid.UUID | None = None  # null removes the manager

    @model_validator(mode="after")
    def _no_null_for_required_fields(self) -> "EmployeeUpdate":
        for name in _NON_NULLABLE:
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    @field_validator("work_email")
    @classmethod
    def _lowercase_email(cls, v: str | None) -> str | None:
        return v.lower() if v else v

    @field_validator("date_of_joining")
    @classmethod
    def _join_date(cls, v: date | None) -> date | None:
        return _check_join_date(v)


class EmployeeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_id: str
    first_name: str
    last_name: str
    work_email: str
    phone_number: str | None
    job_title: str
    department: str
    employment_type: EmploymentType
    employment_status: EmploymentStatus
    date_of_joining: date
    manager_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class EmployeeList(BaseModel):
    items: list[EmployeeRead]
    total: int = Field(description="Total matching employees across all pages")
    page: int
    page_size: int
