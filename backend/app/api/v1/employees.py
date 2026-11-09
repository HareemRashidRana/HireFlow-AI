import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.employee import EmploymentStatus, EmploymentType
from app.schemas.employee import EmployeeCreate, EmployeeList, EmployeeRead, EmployeeUpdate
from app.services import employee as service

router = APIRouter(prefix="/employees", tags=["employees"])

DbSession = Annotated[Session, Depends(get_db)]


@router.post("", response_model=EmployeeRead, status_code=status.HTTP_201_CREATED)
def create_employee(payload: EmployeeCreate, db: DbSession):
    return service.create_employee(db, payload)


@router.get("", response_model=EmployeeList)
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


@router.get("/{employee_pk}", response_model=EmployeeRead)
def get_employee(employee_pk: uuid.UUID, db: DbSession):
    return service.get_employee(db, employee_pk)


@router.patch("/{employee_pk}", response_model=EmployeeRead)
def update_employee(employee_pk: uuid.UUID, payload: EmployeeUpdate, db: DbSession):
    return service.update_employee(db, employee_pk, payload)


@router.delete("/{employee_pk}", status_code=status.HTTP_204_NO_CONTENT)
def delete_employee(employee_pk: uuid.UUID, db: DbSession):
    service.delete_employee(db, employee_pk)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
