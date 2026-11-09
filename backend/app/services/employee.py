import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.models.employee import Employee, EmploymentStatus, EmploymentType
from app.schemas.employee import EmployeeCreate, EmployeeUpdate


def _escape_like(term: str) -> str:
    """Make %, _ and \\ in user input match literally instead of acting as wildcards."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def get_employee(db: Session, employee_pk: uuid.UUID) -> Employee:
    employee = db.get(Employee, employee_pk)
    if employee is None:
        raise NotFoundError("Employee not found")
    return employee


def list_employees(
    db: Session,
    *,
    q: str | None = None,
    department: str | None = None,
    employment_status: EmploymentStatus | None = None,
    employment_type: EmploymentType | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Employee], int]:
    stmt = select(Employee)

    if q and q.strip():
        pattern = f"%{_escape_like(q.strip())}%"
        full_name = Employee.first_name + " " + Employee.last_name
        stmt = stmt.where(
            or_(
                full_name.ilike(pattern, escape="\\"),
                Employee.work_email.ilike(pattern, escape="\\"),
                Employee.employee_id.ilike(pattern, escape="\\"),
            )
        )
    if department:
        stmt = stmt.where(func.lower(Employee.department) == department.strip().lower())
    if employment_status:
        stmt = stmt.where(Employee.employment_status == employment_status)
    if employment_type:
        stmt = stmt.where(Employee.employment_type == employment_type)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(
        stmt.order_by(Employee.last_name, Employee.first_name, Employee.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(items), total


def _ensure_unique(
    db: Session, *, employee_id: str | None, work_email: str | None, exclude: uuid.UUID | None
) -> None:
    """Friendly duplicate check. The DB unique constraints remain the final safety net."""
    if employee_id is not None:
        stmt = select(Employee.id).where(Employee.employee_id == employee_id)
        if exclude:
            stmt = stmt.where(Employee.id != exclude)
        if db.scalar(stmt) is not None:
            raise ConflictError(f"Employee ID '{employee_id}' already exists")
    if work_email is not None:
        stmt = select(Employee.id).where(func.lower(Employee.work_email) == work_email.lower())
        if exclude:
            stmt = stmt.where(Employee.id != exclude)
        if db.scalar(stmt) is not None:
            raise ConflictError(f"Work email '{work_email}' already exists")


def _validate_manager(db: Session, manager_id: uuid.UUID, employee_pk: uuid.UUID | None) -> None:
    if employee_pk is not None and manager_id == employee_pk:
        raise BusinessRuleError("An employee cannot be their own manager")
    manager = db.get(Employee, manager_id)
    if manager is None:
        raise BusinessRuleError("Manager not found")
    # Walk up the chain: the employee must not already be above the proposed manager.
    if employee_pk is not None:
        seen: set[uuid.UUID] = set()
        current: Employee | None = manager
        while current is not None and current.id not in seen:
            if current.manager_id == employee_pk:
                raise BusinessRuleError("This manager assignment would create a reporting loop")
            seen.add(current.id)
            current = db.get(Employee, current.manager_id) if current.manager_id else None


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # Only reachable if two requests race past the pre-checks above.
        raise ConflictError("Employee ID or work email already exists") from None


def create_employee(db: Session, data: EmployeeCreate) -> Employee:
    _ensure_unique(db, employee_id=data.employee_id, work_email=data.work_email, exclude=None)
    if data.manager_id:
        _validate_manager(db, data.manager_id, None)

    employee = Employee(**data.model_dump())
    db.add(employee)
    _commit(db)
    db.refresh(employee)
    return employee


def update_employee(db: Session, employee_pk: uuid.UUID, data: EmployeeUpdate) -> Employee:
    employee = get_employee(db, employee_pk)
    changes = data.model_dump(exclude_unset=True)

    _ensure_unique(
        db,
        employee_id=changes.get("employee_id"),
        work_email=changes.get("work_email"),
        exclude=employee.id,
    )
    if changes.get("manager_id"):
        _validate_manager(db, changes["manager_id"], employee.id)

    for field, value in changes.items():
        setattr(employee, field, value)
    _commit(db)
    db.refresh(employee)
    return employee


def delete_employee(db: Session, employee_pk: uuid.UUID) -> None:
    """Hard delete. Direct reports are kept and their manager is cleared."""
    employee = get_employee(db, employee_pk)
    db.delete(employee)
    db.commit()
