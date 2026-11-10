"""The hiring pipeline rules, in one place. The API, the UI's hints and the tests all use this.

Pipeline (strictly one step at a time):

    applied -> screening -> shortlisted -> interview -> offer -> hired

* A mistaken move can be undone by ONE step backwards (offer -> interview, ...), and is recorded.
* From any active stage (applied .. offer) an application can be rejected or withdrawn.
* hired, rejected and withdrawn are terminal. Only HR / admin may reopen a rejected or withdrawn
  application (it returns to the stage it was rejected / withdrawn from). Hired never reopens.
* Moving someone to "hired" is a human hiring decision: HR / admin only. Nothing here is automatic.
* On a closed job nothing can progress; applications can still be rejected or withdrawn.
"""

from app.models.application import ApplicationStage as S
from app.models.job import JobStatus
from app.models.user import UserRole

PIPELINE: tuple[S, ...] = (S.APPLIED, S.SCREENING, S.SHORTLISTED, S.INTERVIEW, S.OFFER, S.HIRED)
ACTIVE: frozenset[S] = frozenset(PIPELINE[:-1])  # applied .. offer
TERMINAL: frozenset[S] = frozenset({S.HIRED, S.REJECTED, S.WITHDRAWN})
# Ways out of the pipeline, available from any active stage.
CLOSING: frozenset[S] = frozenset({S.REJECTED, S.WITHDRAWN})
REOPENABLE: frozenset[S] = CLOSING

HR_ROLES: frozenset[UserRole] = frozenset({UserRole.ADMIN, UserRole.HR_MANAGER})
HR_ONLY_TARGETS: frozenset[S] = frozenset({S.HIRED})


def workflow_targets(stage: S, job_status: JobStatus) -> frozenset[S]:
    """Stages this application may move to, ignoring who is asking."""
    if stage not in ACTIVE:
        return frozenset()
    targets = set(CLOSING)
    if job_status != JobStatus.CLOSED:
        i = PIPELINE.index(stage)
        targets.add(PIPELINE[i + 1])  # always exists: the last active stage is followed by hired
        if i > 0:
            targets.add(PIPELINE[i - 1])
    return frozenset(targets)


def may_move_to(role: UserRole, target: S) -> bool:
    return target not in HR_ONLY_TARGETS or role in HR_ROLES


def allowed_targets(stage: S, job_status: JobStatus, role: UserRole) -> list[S]:
    """What the given role can actually do right now (used for the UI's hints)."""
    wanted = workflow_targets(stage, job_status)
    return [s for s in S if s in wanted and may_move_to(role, s)]


def can_reopen(stage: S, job_status: JobStatus, role: UserRole) -> bool:
    return stage in REOPENABLE and job_status != JobStatus.CLOSED and role in HR_ROLES
