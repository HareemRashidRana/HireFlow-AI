import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import security
from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.models.employee import Employee
from app.models.user import User, UserRole
from app.schemas.user import AdminPasswordReset, UserCreate, UserUpdate, password_contains_email
from app.services import auth as auth_service


def get_user(db: Session, user_id: uuid.UUID) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found")
    return user


def list_users(
    db: Session,
    *,
    q: str | None = None,
    role: UserRole | None = None,
    is_active: bool | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[User], int]:
    stmt = select(User)
    if q and q.strip():
        escaped = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where(User.email.ilike(f"%{escaped}%", escape="\\"))
    if role:
        stmt = stmt.where(User.role == role)
    if is_active is not None:
        stmt = stmt.where(User.is_active.is_(is_active))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(
        stmt.order_by(User.email).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return list(items), total


def _validate_employee_link(
    db: Session, role: UserRole, employee_id: uuid.UUID | None, *, exclude_user: uuid.UUID | None
) -> None:
    if role == UserRole.EMPLOYEE and employee_id is None:
        raise BusinessRuleError("Users with the employee role must be linked to an employee record")
    if employee_id is None:
        return
    if db.get(Employee, employee_id) is None:
        raise BusinessRuleError("Employee record not found")
    stmt = select(User.id).where(User.employee_id == employee_id)
    if exclude_user:
        stmt = stmt.where(User.id != exclude_user)
    if db.scalar(stmt) is not None:
        raise ConflictError("That employee record is already linked to another user")


def create_user(db: Session, data: UserCreate) -> User:
    if db.scalar(select(User.id).where(func.lower(User.email) == data.email.lower())) is not None:
        raise ConflictError("A user with this email already exists")
    _validate_employee_link(db, data.role, data.employee_id, exclude_user=None)

    user = User(
        email=data.email.lower(),
        password_hash=security.hash_password(data.password.get_secret_value()),
        role=data.role,
        employee_id=data.employee_id,
        must_change_password=data.must_change_password,
        is_active=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("A user with this email already exists") from None
    db.refresh(user)
    return user


def update_user(db: Session, actor: User, user_id: uuid.UUID, data: UserUpdate) -> User:
    user = get_user(db, user_id)
    changes = data.model_dump(exclude_unset=True)

    if user.id == actor.id:
        # Prevents an admin from locking themselves (and possibly every admin) out.
        role_changes = "role" in changes and changes["role"] != user.role
        active_changes = "is_active" in changes and changes["is_active"] != user.is_active
        if role_changes or active_changes:
            raise BusinessRuleError(
                "You cannot change your own role or deactivate your own account"
            )

    # Only re-check the link rules when the role or link actually changes, so an account whose
    # employee record was deleted can still be deactivated or otherwise managed.
    if {"role", "employee_id"} & changes.keys():
        new_role = changes.get("role", user.role)
        new_employee = changes["employee_id"] if "employee_id" in changes else user.employee_id
        _validate_employee_link(db, new_role, new_employee, exclude_user=user.id)

    deactivating = changes.get("is_active") is False and user.is_active
    for field, value in changes.items():
        setattr(user, field, value)
    if deactivating:
        auth_service.revoke_all_sessions(db, user.id)  # kicks the user out immediately
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("That employee record is already linked to another user") from None
    db.refresh(user)
    return user


def unlock_user(db: Session, user_id: uuid.UUID) -> None:
    """Clear failed-login counters so a locked account can sign in again right away."""
    user = get_user(db, user_id)
    auth_service.clear_failed_attempts(db, user.email)
    db.commit()


def reset_password(db: Session, user_id: uuid.UUID, data: AdminPasswordReset) -> None:
    """Admin sets a temporary password. The user must change it at next sign-in; sessions end."""
    user = get_user(db, user_id)
    if password_contains_email(data.new_password, user.email):
        raise BusinessRuleError("Password must not contain the email address")
    user.password_hash = security.hash_password(data.new_password.get_secret_value())
    user.must_change_password = True
    user.password_changed_at = security.utcnow()
    auth_service.clear_failed_attempts(db, user.email)
    auth_service.revoke_all_sessions(db, user.id)
    db.commit()
