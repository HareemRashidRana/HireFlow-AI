import enum
import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import UTCDateTime, string_enum


class CandidateSource(enum.StrEnum):
    REFERRAL = "referral"
    LINKEDIN = "linkedin"
    JOB_BOARD = "job_board"
    AGENCY = "agency"
    DIRECT = "direct"
    OTHER = "other"


class ConsentBasis(enum.StrEnum):
    """Why we are allowed to hold this person's data. Consent is NOT assumed to be the answer."""

    CONSENT = "consent"
    LEGITIMATE_INTEREST = "legitimate_interest"
    PRE_CONTRACT_STEPS = "pre_contract_steps"
    OTHER = "other"


class Candidate(Base):
    """A person who may be hired. Deliberately separate from Employee (no shared table or foreign
    key): someone becomes an employee only through an explicit hiring step, much later.

    Data minimisation: only what recruiters need to contact and assess a person. We do NOT collect
    date of birth, gender, nationality, photo, ID numbers, home address or salary information.
    """

    __tablename__ = "candidates"
    __table_args__ = (
        # "other" is only acceptable if the staff member says what it is. The explanation must be
        # real text: NULL, empty and space-only values are all refused, even by a direct insert that
        # bypasses the API. (TRIM is portable to SQLite; it removes spaces only, and the API strips
        # every kind of whitespace before this constraint is ever reached.)
        CheckConstraint(
            "consent_basis <> 'other' "
            "OR (consent_basis_note IS NOT NULL AND TRIM(consent_basis_note) <> '')",
            name="basis_note_when_other",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)  # stored lowercase
    phone: Mapped[str | None] = mapped_column(String(20))
    location: Mapped[str | None] = mapped_column(String(150))  # city / country only
    current_title: Mapped[str | None] = mapped_column(String(150))
    current_company: Mapped[str | None] = mapped_column(String(150))
    source: Mapped[CandidateSource] = mapped_column(
        string_enum(CandidateSource, "candidate_source")
    )

    # Lawful basis for holding the data, recorded by staff. Not assumed to be consent.
    consent_basis: Mapped[ConsentBasis] = mapped_column(string_enum(ConsentBasis, "consent_basis"))
    consent_basis_note: Mapped[str | None] = mapped_column(String(200))  # required for "other"
    consent_date: Mapped[date] = mapped_column(Date)  # when the basis was established

    # Retention: kept until `retain_until`, which is last_activity_at + CANDIDATE_RETENTION_MONTHS.
    last_activity_at: Mapped[datetime] = mapped_column(UTCDateTime)
    retain_until: Mapped[date] = mapped_column(Date, index=True)
    anonymized_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:  # never include personal data
        return f"<Candidate {self.id}>"
