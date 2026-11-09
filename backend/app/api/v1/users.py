import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import DbSession, require_roles
from app.models.user import User, UserRole
from app.schemas.user import (
    AdminPasswordReset,
    UserCreate,
    UserList,
    UserRead,
    UserUpdate,
)
from app.services import user as service

# Every route here is admin-only. One shared dependency object so FastAPI evaluates it once.
_admin_only = require_roles(UserRole.ADMIN)
AdminUser = Annotated[User, Depends(_admin_only)]

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(_admin_only)])


@router.get("", response_model=UserList)
def list_users(
    db: DbSession,
    q: Annotated[str | None, Query(max_length=100, description="Search by email")] = None,
    role: UserRole | None = None,
    is_active: bool | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    items, total = service.list_users(
        db, q=q, role=role, is_active=is_active, page=page, page_size=page_size
    )
    return UserList(items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: DbSession):
    return service.create_user(db, payload)


@router.get("/{user_id}", response_model=UserRead)
def get_user(user_id: uuid.UUID, db: DbSession):
    return service.get_user(db, user_id)


@router.patch("/{user_id}", response_model=UserRead)
def update_user(user_id: uuid.UUID, payload: UserUpdate, db: DbSession, actor: AdminUser):
    return service.update_user(db, actor, user_id, payload)


@router.post("/{user_id}/unlock", status_code=status.HTTP_204_NO_CONTENT)
def unlock_user(user_id: uuid.UUID, db: DbSession):
    service.unlock_user(db, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(user_id: uuid.UUID, payload: AdminPasswordReset, db: DbSession):
    service.reset_password(db, user_id, payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
