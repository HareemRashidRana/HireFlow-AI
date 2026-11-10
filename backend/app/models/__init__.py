# Import every model here so Alembic autogenerate can discover it.
from app.models.application import (
    Application,
    ApplicationEvent,
    ApplicationEventType,
    ApplicationStage,
)
from app.models.audit import AuditEventType, CandidateAuditEvent
from app.models.candidate import Candidate, CandidateSource, ConsentBasis
from app.models.employee import Employee, EmploymentStatus, EmploymentType
from app.models.interview import (
    FeedbackStatus,
    Interview,
    InterviewEvent,
    InterviewEventType,
    InterviewFeedback,
    InterviewFeedbackRevision,
    InterviewInterviewer,
    InterviewMode,
    InterviewStatus,
    InterviewType,
)
from app.models.job import JobPosting, JobStatus
from app.models.login_attempt import LoginAttempt
from app.models.refresh_token import RefreshToken
from app.models.resume import Resume, ResumeStatus
from app.models.screening import (
    AdjustmentReason,
    AssessmentStatus,
    ReviewJudgement,
    ScreeningAssessment,
    ScreeningReview,
    ScrubReason,
)
from app.models.user import User, UserRole
from app.models.workforce import (
    AttendanceCorrection,
    AttendanceRecord,
    AttendanceSource,
    Holiday,
    LeaveEvent,
    LeaveEventType,
    LeaveLedgerEntry,
    LeaveRequest,
    LeaveStatus,
    LeaveType,
    LedgerEntryType,
    WorkSettings,
)

__all__ = [
    "AttendanceCorrection",
    "AttendanceRecord",
    "AttendanceSource",
    "Holiday",
    "LeaveEvent",
    "LeaveEventType",
    "LeaveLedgerEntry",
    "LeaveRequest",
    "LeaveStatus",
    "LeaveType",
    "LedgerEntryType",
    "WorkSettings",
    "FeedbackStatus",
    "Interview",
    "InterviewEvent",
    "InterviewEventType",
    "InterviewFeedback",
    "InterviewFeedbackRevision",
    "InterviewInterviewer",
    "InterviewMode",
    "InterviewStatus",
    "InterviewType",
    "AdjustmentReason",
    "AssessmentStatus",
    "ReviewJudgement",
    "ScreeningAssessment",
    "ScreeningReview",
    "ScrubReason",
    "Application",
    "ApplicationEvent",
    "ApplicationEventType",
    "ApplicationStage",
    "AuditEventType",
    "Candidate",
    "CandidateAuditEvent",
    "CandidateSource",
    "ConsentBasis",
    "Employee",
    "EmploymentStatus",
    "EmploymentType",
    "JobPosting",
    "JobStatus",
    "LoginAttempt",
    "RefreshToken",
    "Resume",
    "ResumeStatus",
    "User",
    "UserRole",
]
