"""Requirements Coverage (R4): advisory, deterministic comparison of a job's skills with a
human-reviewed resume. See docs and `methodology.py`. This package is pure (no database, no web)."""

from app.services.screening.engine import (
    CoverageResult,
    JobRequirements,
    ReviewedProfile,
    compute_coverage,
    input_fingerprint,
)
from app.services.screening.methodology import SCORING_VERSION, methodology
from app.services.screening.reviewed import (
    ReviewedDataError,
    profile_from_reviewed,
    requirements_from_job,
)

__all__ = [
    "SCORING_VERSION",
    "CoverageResult",
    "JobRequirements",
    "ReviewedDataError",
    "ReviewedProfile",
    "compute_coverage",
    "input_fingerprint",
    "methodology",
    "profile_from_reviewed",
    "requirements_from_job",
]
