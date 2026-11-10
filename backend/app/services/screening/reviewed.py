"""The ONLY door from stored resume data into the scoring engine.

It accepts the shape that a person's resume review produces (`Resume.reviewed_data`) and refuses
everything else. In particular it refuses the parser's own output (`Resume.parsed_data`): that has a
different shape (extra keys such as `parser_version`, and `skills` as an object, not a list), so
passing it by mistake raises an error instead of quietly scoring unreviewed data.

From a reviewed resume it takes the skill list and the start/end/current of each position. It does
not read the name, email, phone, education, job titles or company names, and they are never handed
to the engine.
"""

from collections.abc import Mapping, Sequence

from app.services.screening.engine import JobRequirements, ReviewedProfile
from app.services.screening.experience import Position

REVIEWED_KEYS = frozenset({"name", "email", "phone", "skills", "education", "experience"})
POSITION_KEYS = frozenset({"title", "company", "start", "end", "current"})
EDUCATION_KEYS = frozenset({"institution", "degree", "field", "start_year", "end_year"})


class ReviewedDataError(ValueError):
    """The data is not human-reviewed resume data in the expected shape."""


def profile_from_reviewed(reviewed_data: object) -> ReviewedProfile:
    if reviewed_data is None:
        raise ReviewedDataError("This resume has not been reviewed by a person")
    if not isinstance(reviewed_data, Mapping):
        raise ReviewedDataError("Reviewed data must be an object")
    unknown = set(reviewed_data) - REVIEWED_KEYS
    if unknown:
        raise ReviewedDataError("Not reviewed-resume data (unexpected fields)")

    skills = reviewed_data.get("skills", [])
    if not isinstance(skills, list) or not all(isinstance(s, str) for s in skills):
        raise ReviewedDataError("Reviewed skills must be a list of text values")

    education = reviewed_data.get("education", [])
    if not isinstance(education, list) or not all(
        isinstance(e, Mapping) and set(e) <= EDUCATION_KEYS for e in education
    ):
        raise ReviewedDataError("Reviewed education has an unexpected shape")

    experience = reviewed_data.get("experience", [])
    if not isinstance(experience, list):
        raise ReviewedDataError("Reviewed experience must be a list")
    positions: list[Position] = []
    for item in experience:
        if not isinstance(item, Mapping) or not set(item) <= POSITION_KEYS:
            raise ReviewedDataError("Reviewed experience has an unexpected shape")
        start, end, current = item.get("start"), item.get("end"), item.get("current", False)
        if not (isinstance(start, str | None) and isinstance(end, str | None)):
            raise ReviewedDataError("Reviewed experience dates must be text")
        if not isinstance(current, bool):
            raise ReviewedDataError("Reviewed experience 'current' must be true or false")
        positions.append(Position(start=start, end=end, current=current))  # nothing else is read
    return ReviewedProfile(skills=tuple(skills), positions=tuple(positions))


def requirements_from_job(
    required_skills: Sequence[str] | None, nice_to_have_skills: Sequence[str] | None
) -> JobRequirements:
    """A job's skill lists, and nothing else (no title, description, salary or location)."""
    return JobRequirements(
        required=tuple(required_skills or ()), preferred=tuple(nice_to_have_skills or ())
    )
