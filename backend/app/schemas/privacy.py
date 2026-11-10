import enum
import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.audit import AuditEventType
from app.models.candidate import CandidateSource, ConsentBasis
from app.schemas.application import StaffSummary
from app.schemas.candidate import CandidateRead, RetentionFilter

# ---- anonymization ---------------------------------------------------------------------------


class AnonymizationPreview(BaseModel):
    """What anonymizing would do. Field NAMES and counts only: no candidate data is repeated."""

    candidate_id: uuid.UUID
    already_anonymized: bool
    fields_cleared: list[str]
    fields_replaced: list[str]
    fields_kept: list[str]
    application_count: int
    application_notes_cleared: int
    history_notes_cleared: int
    resumes_removed: int = 0  # resume FILES that would be permanently deleted
    assessments_scrubbed: int = 0  # Requirements Coverage records that lose resume-derived content
    interviews_scrubbed: int = 0  # interviews whose notes, links and feedback text are removed


class AnonymizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirm: Literal[True]  # the caller must say so explicitly


class AnonymizeResult(BaseModel):
    candidate: CandidateRead
    changed: bool  # False when it had already been anonymized (the call is idempotent)


# ---- export ----------------------------------------------------------------------------------


class ExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: Literal["csv", "json"] = "csv"


class BulkExportRequest(ExportRequest):
    source: CandidateSource | None = None
    retention: RetentionFilter | None = None


# ---- retention -------------------------------------------------------------------------------


class RetentionStatus(enum.StrEnum):
    ALL = "all"
    EXPIRING = "expiring"
    EXPIRED = "expired"
    ANONYMIZED = "anonymized"


class RetentionItem(BaseModel):
    id: uuid.UUID
    first_name: str
    last_name: str
    email: str
    consent_basis: ConsentBasis
    consent_date: date
    last_activity_at: datetime
    retain_until: date
    anonymized_at: datetime | None
    application_count: int
    status: Literal["active", "expiring", "expired", "anonymized"]
    purge_eligible: bool


class RetentionSummary(BaseModel):
    expiring: int
    expired: int
    anonymized: int
    purge_eligible: int
    expired_with_applications: int  # expired but holding hiring history: anonymize, do not delete
    retention_months: int
    expiring_window_days: int
    purge_enabled: bool


class RetentionList(BaseModel):
    summary: RetentionSummary
    items: list[RetentionItem]
    total: int
    page: int
    page_size: int


# ---- purge -----------------------------------------------------------------------------------


class PurgeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dry_run: bool = True  # previewing is the default; deleting must be asked for
    confirm: str | None = Field(default=None, max_length=20)
    limit: int = Field(default=50, ge=1, le=100)


class PurgeResult(BaseModel):
    dry_run: bool
    purge_enabled: bool
    eligible_total: int
    batch_size: int  # how many this run covers (a dry run: would delete; a real run: did delete)
    candidate_ids: list[uuid.UUID]
    deleted: int
    remaining_eligible: int
    expired_with_applications: int


# ---- audit -----------------------------------------------------------------------------------


class AuditEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_type: AuditEventType
    candidate_id: uuid.UUID | None
    actor: StaffSummary | None
    event_metadata: dict[str, Any] = Field(serialization_alias="metadata")
    request_id: str | None
    created_at: datetime


class AuditList(BaseModel):
    items: list[AuditEventRead]
    total: int
    page: int
    page_size: int
