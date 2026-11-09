import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import CurrentUser, DbSession, require_roles
from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.models.employee import EmploymentStatus, EmploymentType
from app.models.user import UserRole
from app.schemas.employee import EmployeeCreate, EmployeeList, EmployeeRead, EmployeeUpdate
from app.services import employee as service

router = APIRouter(prefix="/employees", tags=["employees"])

# Who may do what (enforced here on the server; the UI only mirrors it):
#   read directory ..... admin, hr_manager, recruiter
#   read one record .... the above, plus an employee reading THEIR OWN record
#   create / update .... admin, hr_manager
#   delete ............. admin
READ_DIRECTORY = (UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER)
WRITE = (UserRole.ADMIN, UserRole.HR_MANAGER)
DELETE = (UserRole.ADMIN,)


@router.post(
    "",
    response_model=EmployeeRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(*WRITE))],
)
def create_employee(payload: EmployeeCreate, db: DbSession):
    return service.create_employee(db, payload)


@router.get("", response_model=EmployeeList, dependencies=[Depends(require_roles(*READ_DIRECTORY))])
def list_employees(
    db: DbSession,
    q: Annotated[
        str | None, Query(max_length=100, description="Search name, email or employee ID")
    ] = None,
    department: Annotated[str | None, Query(max_length=100)] = None,
    employment_status: EmploymentStatus | None = None,
    employment_type: EmploymentType | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    items, total = service.list_employees(
        db,
        q=q,
        department=department,
        employment_status=employment_status,
        employment_type=employment_type,
        page=page,
        page_size=page_size,
    )
    return EmployeeList(items=items, total=total, page=page, page_size=page_size)


# Declared before "/{employee_pk}" so "me" is not parsed as an ID.
@router.get("/me", response_model=EmployeeRead)
def get_my_employee_record(user: CurrentUser, db: DbSession):
    if user.employee_id is None:
        raise NotFoundError("No employee record is linked to your account")
    return service.get_employee(db, user.employee_id)


@router.get("/{employee_pk}", response_model=EmployeeRead)
def get_employee(employee_pk: uuid.UUID, user: CurrentUser, db: DbSession):
    # Ownership check: staff roles may read anyone; everyone else only their own record.
    if user.role not in READ_DIRECTORY and user.employee_id != employee_pk:
        raise PermissionDeniedError("You can only view your own employee record")
    return service.get_employee(db, employee_pk)


@router.patch(
    "/{employee_pk}",
    response_model=EmployeeRead,
    dependencies=[Depends(require_roles(*WRITE))],
)
def update_employee(employee_pk: uuid.UUID, payload: EmployeeUpdate, db: DbSession):
    return service.update_employee(db, employee_pk, payload)


@router.delete(
    "/{employee_pk}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(*DELETE))],
)
def delete_employee(employee_pk: uuid.UUID, db: DbSession):
    service.delete_employee(db, employee_pk)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
