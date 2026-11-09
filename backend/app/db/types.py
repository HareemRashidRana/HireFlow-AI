import enum
from datetime import UTC, datetime

from sqlalchemy import DateTime, Enum
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator


def string_enum(enum_cls: type[enum.StrEnum], name: str, length: int = 20) -> Enum:
    """An enum stored as VARCHAR + CHECK constraint (portable and easy to migrate).

    Values are the lowercase member values (e.g. "on_hold"), not the member names.
    """
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=length,
        values_callable=lambda e: [m.value for m in e],
    )


class UTCDateTime(TypeDecorator[datetime]):
    """timestamptz that always comes back timezone-aware (UTC), on PostgreSQL and SQLite alike."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("Naive datetimes are not allowed; use timezone-aware UTC values")
        return value.astimezone(UTC) if value is not None else None

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
