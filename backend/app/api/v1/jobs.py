import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import DbSession, require_roles
from app.models.employee import EmploymentType
from app.models.job import JobStatus
from app.models.user import User, UserRole
from app.schemas.job import JobCreate, JobList, JobRead, JobStatusChange, JobUpdate
from app.services import job as service

router = APIRouter(prefix="/jobs", tags=["jobs"])

# Who may do what (enforced here on the server; the UI only mirrors it):
#   read ............... admin, hr_manager, recruiter
#   create / edit /
#   change status ...... admin, hr_manager, recruiter
#   delete (drafts) .... admin
READ = (UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER)
WRITE = (UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER)
DELETE = (UserRole.ADMIN,)

_write_user = require_roles(*WRITE)
WriteUser = Annotated[User, Depends(_write_user)]


@router.get("", response_model=JobList, dependencies=[Depends(require_roles(*READ))])
def list_jobs(
    db: DbSession,
    q: Annotated[
        str | None, Query(max_length=100, description="Search title, department or location")
    ] = None,
    job_status: Annotated[JobStatus | None, Query(alias="status")] = None,
    department: Annotated[str | None, Query(max_length=100)] = None,
    employment_type: EmploymentType | None = None,
    hiring_manager_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    items, total, counts = service.list_jobs(
        db,
        q=q,
        status=job_status,
        department=department,
        employment_type=employment_type,
        hiring_manager_id=hiring_manager_id,
        page=page,
        page_size=page_size,
    )
    return JobList(items=items, total=total, page=page, page_size=page_size, status_counts=counts)


# Declared before "/{job_id}" so "departments" is not parsed as an ID.
@router.get("/departments", response_model=list[str], dependencies=[Depends(require_roles(*READ))])
def list_departments(db: DbSession):
    return service.list_departments(db)


@router.post("", response_model=JobRead, status_code=status.HTTP_201_CREATED)
def create_job(payload: JobCreate, db: DbSession, actor: WriteUser):
    return service.create_job(db, actor, payload)


@router.get("/{job_id}", response_model=JobRead, dependencies=[Depends(require_roles(*READ))])
def get_job(job_id: uuid.UUID, db: DbSession):
    return service.get_job(db, job_id)


@router.patch("/{job_id}", response_model=JobRead, dependencies=[Depends(_write_user)])
def update_job(job_id: uuid.UUID, payload: JobUpdate, db: DbSession):
    return service.update_job(db, job_id, payload)


@router.post("/{job_id}/status", response_model=JobRead, dependencies=[Depends(_write_user)])
def change_job_status(job_id: uuid.UUID, payload: JobStatusChange, db: DbSession):
    return service.change_status(db, job_id, payload.status)


@router.delete(
    "/{job_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(*DELETE))],
)
def delete_job(job_id: uuid.UUID, db: DbSession):
    service.delete_job(db, job_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
