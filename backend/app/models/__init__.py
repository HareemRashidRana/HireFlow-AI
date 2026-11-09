# Import every model here so Alembic autogenerate can discover it.
from app.models.candidate import Candidate, CandidateSource, ConsentBasis
from app.models.employee import Employee, EmploymentStatus, EmploymentType
from app.models.job import JobPosting, JobStatus
from app.models.login_attempt import LoginAttempt
from app.models.refresh_token import RefreshToken
from app.models.user import User, UserRole

__all__ = [
    "Candidate",
    "CandidateSource",
    "ConsentBasis",
    "Employee",
    "EmploymentStatus",
    "EmploymentType",
    "JobPosting",
    "JobStatus",
    "LoginAttempt",
    "RefreshToken",
    "User",
    "UserRole",
]
