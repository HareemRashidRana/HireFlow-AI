# Import every model here so Alembic autogenerate can discover it.
from app.models.employee import Employee, EmploymentStatus, EmploymentType

__all__ = ["Employee", "EmploymentStatus", "EmploymentType"]
