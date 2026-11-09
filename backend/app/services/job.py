import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core import security
from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.models.employee import Employee, EmploymentStatus, EmploymentType
from app.models.job import JobPosting, JobStatus
from app.models.user import User
from app.schemas.job import JobCreate, JobUpdate, check_salary

# Workflow: which status may follow which. Anything else is rejected with 409.
#   draft -> open | closed      (a draft can be published, or abandoned)
#   open -> on_hold | closed
#   on_hold -> open | closed
#   closed -> open              (reopen)
ALLOWED_TRANSITIONS: dict[JobStatus, frozenset[JobStatus]] = {
    JobStatus.DRAFT: frozenset({JobStatus.OPEN, JobStatus.CLOSED}),
    JobStatus.OPEN: frozenset({JobStatus.ON_HOLD, JobStatus.CLOSED}),
    JobStatus.ON_HOLD: frozenset({JobStatus.OPEN, JobStatus.CLOSED}),
    JobStatus.CLOSED: frozenset({JobStatus.OPEN}),
}


def _escape_like(term: str) -> str:
    """Make %, _ and \\ in user input match literally instead of acting as wildcards."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _with_manager(stmt):
    return stmt.options(selectinload(JobPosting.hiring_manager))


def get_job(db: Session, job_id: uuid.UUID) -> JobPosting:
    # populate_existing: the session keeps already-loaded objects as they were, which would leave
    # a stale `hiring_manager` after its id changed. Always reload the row and its relationships.
    job = db.scalar(
        _with_manager(select(JobPosting).where(JobPosting.id == job_id)).execution_options(
            populate_existing=True
        )
    )
    if job is None:
        raise NotFoundError("Job not found")
    return job


def list_jobs(
    db: Session,
    *,
    q: str | None = None,
    status: JobStatus | None = None,
    department: str | None = None,
    employment_type: EmploymentType | None = None,
    hiring_manager_id: uuid.UUID | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[JobPosting], int, dict[JobStatus, int]]:
    # Filters shared by the list and by the per-status counts (so the tabs match the filters).
    conditions = []
    if q and q.strip():
        pattern = f"%{_escape_like(q.strip())}%"
        conditions.append(
            or_(
                JobPosting.title.ilike(pattern, escape="\\"),
                JobPosting.department.ilike(pattern, escape="\\"),
                JobPosting.location.ilike(pattern, escape="\\"),
            )
        )
    if department and department.strip():
        conditions.append(func.lower(JobPosting.department) == department.strip().lower())
    if employment_type:
        conditions.append(JobPosting.employment_type == employment_type)
    if hiring_manager_id:
        conditions.append(JobPosting.hiring_manager_id == hiring_manager_id)

    counts = {s: 0 for s in JobStatus}
    for job_status, n in db.execute(
        select(JobPosting.status, func.count()).where(*conditions).group_by(JobPosting.status)
    ):
        counts[job_status] = n

    listed = list(conditions)
    if status:
        listed.append(JobPosting.status == status)
    stmt = select(JobPosting).where(*listed)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(
        _with_manager(stmt)
        .order_by(JobPosting.created_at.desc(), JobPosting.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(items), total, counts


def list_departments(db: Session) -> list[str]:
    """Suggestions for the department field: names already used by jobs or employees.

    De-duplicated case-insensitively so "Engineering" and "engineering" show up once.
    """
    names = [
        *db.scalars(select(JobPosting.department).distinct()),
        *db.scalars(select(Employee.department).distinct()),
    ]
    unique: dict[str, str] = {}
    for name in sorted(n for n in names if n and n.strip()):
        unique.setdefault(name.strip().lower(), name.strip())
    return sorted(unique.values(), key=str.lower)[:200]


def _validate_hiring_manager(db: Session, employee_id: uuid.UUID) -> None:
    manager = db.get(Employee, employee_id)
    if manager is None:
        raise BusinessRuleError("Hiring manager not found")
    if manager.employment_status != EmploymentStatus.ACTIVE:
        raise BusinessRuleError("The hiring manager must be an active employee")


def create_job(db: Session, actor: User, data: JobCreate) -> JobPosting:
    if data.hiring_manager_id:
        _validate_hiring_manager(db, data.hiring_manager_id)

    job = JobPosting(
        **data.model_dump(),
        status=JobStatus.DRAFT,
        created_by_id=actor.id,
        created_at=security.utcnow(),  # microsecond precision keeps "newest first" deterministic
    )
    db.add(job)
    db.commit()
    return get_job(db, job.id)


def update_job(db: Session, job_id: uuid.UUID, data: JobUpdate) -> JobPosting:
    job = get_job(db, job_id)
    if job.status == JobStatus.CLOSED:
        raise ConflictError("Closed jobs cannot be edited. Reopen the job first.")

    changes = data.model_dump(exclude_unset=True)

    # Cross-field rules are checked on the values the job would have AFTER the change.
    try:
        check_salary(
            changes.get("salary_min", job.salary_min),
            changes.get("salary_max", job.salary_max),
            changes.get("salary_currency", job.salary_currency),
        )
    except ValueError as exc:
        raise BusinessRuleError(str(exc)) from None
    if job.status != JobStatus.DRAFT and "description" in changes and not changes["description"]:
        raise BusinessRuleError("A published job needs a description")
    if changes.get("hiring_manager_id"):
        _validate_hiring_manager(db, changes["hiring_manager_id"])

    for field, value in changes.items():
        setattr(job, field, value)
    db.commit()
    return get_job(db, job.id)


def change_status(db: Session, job_id: uuid.UUID, new_status: JobStatus) -> JobPosting:
    job = get_job(db, job_id)
    if new_status == job.status:
        raise ConflictError(f"The job is already {new_status.value.replace('_', ' ')}")
    if new_status not in ALLOWED_TRANSITIONS[job.status]:
        raise ConflictError(
            f"A {job.status.value.replace('_', ' ')} job cannot be moved to "
            f"{new_status.value.replace('_', ' ')}"
        )
    if new_status == JobStatus.OPEN and not job.description.strip():
        raise BusinessRuleError("Add a description before opening this job")

    now = security.utcnow()
    job.status = new_status
    if new_status == JobStatus.OPEN:
        job.opened_at = job.opened_at or now  # keep the original publish date when reopening
        job.closed_at = None
    elif new_status == JobStatus.CLOSED:
        job.closed_at = now
    db.commit()
    return get_job(db, job.id)


def delete_job(db: Session, job_id: uuid.UUID) -> None:
    """Only drafts can be deleted. Anything that was ever published is closed instead."""
    job = get_job(db, job_id)
    if job.status != JobStatus.DRAFT:
        raise ConflictError("Only draft jobs can be deleted. Close the job instead.")
    db.delete(job)
    db.commit()
