import uuid
from datetime import datetime

from sqlalchemy import Boolean, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import UTCDateTime


class LoginAttempt(Base):
    """Failed/successful sign-in attempts, used for account lockout and per-IP rate limiting.

    Tracked per *identifier hash* (SHA-256 of the lowercased email), not per user row, so unknown
    emails are throttled exactly like real ones and responses never reveal which accounts exist.
    Rows are pruned after 24 hours.
    """

    __tablename__ = "login_attempts"
    __table_args__ = (
        # Serve the lockout / rate-limit lookups, which run on every sign-in:
        #   WHERE identifier_hash = ? AND succeeded = false AND created_at > ?   (equality + range)
        #   WHERE ip_address      = ? AND succeeded = false AND created_at > ?
        # The leading column also covers plain "identifier_hash = ?" / "ip_address = ?" lookups
        # (unlock and clear-on-success deletes), so no single-column indexes are needed for them.
        Index("ix_login_attempts_identifier_created", "identifier_hash", "created_at"),
        Index("ix_login_attempts_ip_created", "ip_address", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    identifier_hash: Mapped[str] = mapped_column(String(64))
    ip_address: Mapped[str] = mapped_column(String(45))
    succeeded: Mapped[bool] = mapped_column(Boolean)
    # Own index: used by the 24-hour pruning DELETE (created_at < cutoff).
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
