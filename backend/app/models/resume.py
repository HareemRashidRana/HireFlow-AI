import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    false,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.types import UTCDateTime, string_enum
from app.models.user import User


class ResumeStatus(enum.StrEnum):
    PENDING = "pending"  # stored, not parsed yet
    PROCESSING = "processing"  # a parse is running
    PARSED = "parsed"  # text was extracted and parsed (a human still has to review it)
    NO_TEXT = "no_text"  # readable file but no text, e.g. a scanned / image-only PDF (no OCR)
    FAILED = "failed"  # corrupt, encrypted or otherwise unreadable
    REMOVED = "removed"  # the file was deleted (anonymization); only a tombstone row remains


class Resume(Base):
    """One uploaded resume file (a version) for one candidate.

    The file itself lives in private storage under a random key; the database holds metadata and the
    parsed result. Extracted TEXT is deliberately not stored (data minimisation): it can be re-read
    from the file when needed. `parsed_data` is what the parser found; `reviewed_data` is what a
    person checked or corrected. Neither is ever copied to the candidate's profile automatically.
    """

    __tablename__ = "resumes"
    __table_args__ = (
        UniqueConstraint("candidate_id", "version_number", name="uq_resumes_candidate_id_version"),
        # The same file cannot be uploaded twice for one candidate (NULL after removal: no clash).
        UniqueConstraint("candidate_id", "sha256", name="uq_resumes_candidate_id_sha256"),
        # At most ONE active resume per candidate, enforced by the database.
        Index(
            "uq_resumes_one_active_per_candidate",
            "candidate_id",
            unique=True,
            postgresql_where=text("is_active"),
            sqlite_where=text("is_active"),
        ),
        CheckConstraint("extension IN ('pdf', 'docx')", name="extension_allowed"),
        CheckConstraint("size_bytes > 0", name="size_positive"),
        CheckConstraint("version_number >= 1", name="version_positive"),
        CheckConstraint("NOT is_active OR status <> 'removed'", name="active_not_removed"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # CASCADE: a candidate who is deliberately deleted (only possible with no applications) takes
    # their resume rows with them; the services delete the files in the same operation.
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), index=True
    )
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("applications.id", ondelete="SET NULL"), index=True
    )
    version_number: Mapped[int] = mapped_column(Integer)

    original_filename: Mapped[str] = mapped_column(String(255))  # display only, never a path
    storage_key: Mapped[str | None] = mapped_column(
        String(32), unique=True
    )  # random; NULL once removed
    mime_type: Mapped[str] = mapped_column(
        String(100)
    )  # detected from the content, not the browser
    extension: Mapped[str] = mapped_column(String(8))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str | None] = mapped_column(String(64), index=True)

    status: Mapped[ResumeStatus] = mapped_column(
        string_enum(ResumeStatus, "resume_status"), default=ResumeStatus.PENDING, index=True
    )
    parse_error_code: Mapped[str | None] = mapped_column(
        String(40)
    )  # a code, never document content
    text_chars: Mapped[int | None] = mapped_column(Integer)
    parsed_data: Mapped[dict | None] = mapped_column(JSON)
    parsed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    reviewed_data: Mapped[dict | None] = mapped_column(JSON)
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    file_removed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, server_default=func.now(), onupdate=func.now()
    )

    uploaded_by: Mapped[User | None] = relationship(foreign_keys=[uploaded_by_id])
    reviewed_by: Mapped[User | None] = relationship(foreign_keys=[reviewed_by_id])

    def __repr__(self) -> str:  # no personal data
        return f"<Resume {self.id} v{self.version_number} {self.status}>"
