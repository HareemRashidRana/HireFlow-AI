from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for all ORM models (import them in app/models/__init__.py for Alembic)."""
