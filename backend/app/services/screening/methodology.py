"""Everything a recruiter is told about how Requirements Coverage works.

These strings are shown in the product, so they are kept in one place, are tested for wording
(no evaluative language about people), and are part of the versioned methodology.
"""

SCORING_VERSION = "coverage-1.0"
TERMINOLOGY = "Requirements Coverage"

# Nominal weights (percent). Only skills are scored.
WEIGHT_REQUIRED = 80
WEIGHT_PREFERRED = 20

SUMMARY = (
    "Requirements Coverage shows how many of the skills a job lists are also listed in a "
    "human-reviewed resume. It is advisory information for a person to interpret, not an "
    "assessment of the candidate."
)

HOW_IT_WORKS: tuple[str, ...] = (
    "Only resume details that a person has reviewed and confirmed are used. Automatic readings "
    "that were never reviewed are never used.",
    "Required skills carry 80% of the weight and preferred skills 20%. Within each group every "
    "skill counts equally.",
    "A skill counts as listed when the reviewed resume lists the same skill, or a known "
    "alternative name for it (for example JS and JavaScript). Similar-looking names are not "
    "matched: Java and JavaScript are different skills, as are C, C++ and C#.",
    "If one group cannot be assessed, the other carries the full weight. If neither can be "
    "assessed, no figure is shown.",
    "Total dated experience is shown for context only. It is not part of the figure because the "
    "resume data does not show which positions are relevant to this job.",
)

LIMITATIONS: tuple[str, ...] = (
    "A skill that is not listed may still be one the person has: resumes are incomplete.",
    "A listed skill does not show how well it is known or how recently it was used.",
    "The figure depends on how the job's requirements were written and on how the resume was "
    "reviewed.",
    "Education, certifications, career gaps, personal details and the kind of experience are "
    "not used.",
    "The figure is advisory. It never changes an application's stage, and it is not used to "
    "reject, shortlist or hire anyone.",
)

EXPERIENCE_NOTE = (
    "Dated experience is shown for context only. It is not a relevance assessment and is not "
    "part of Requirements Coverage. Positions without usable dates are not included in this "
    "figure."
)

REASONS: dict[str, str] = {
    "job_lists_none": "The job does not list any skills in this group.",
    "no_reviewed_skills": (
        "The reviewed resume does not list any skills, so there is nothing to compare. "
        "This says nothing about the candidate's skills."
    ),
}

WARNINGS: dict[str, str] = {
    "preferred_also_required": (
        "Some skills were listed as both required and preferred. They are counted once, as "
        "required."
    ),
    "skills_truncated": "Only the first 200 skills of the reviewed resume were compared.",
    "job_skills_truncated": "Only the first 50 skills of each job list were used.",
    "ignored_skill_entries": "Some skill entries were empty or unusable and were ignored.",
}

NOT_LISTED = "not listed"
LISTED = "listed"


def methodology() -> dict:
    """The full methodology as data (for a future API endpoint and the methodology dialog)."""
    from app.services.screening.aliases import ALIAS_TABLE_VERSION

    return {
        "name": TERMINOLOGY,
        "scoring_version": SCORING_VERSION,
        "alias_table_version": ALIAS_TABLE_VERSION,
        "summary": SUMMARY,
        "weights": {"required_skills": WEIGHT_REQUIRED, "preferred_skills": WEIGHT_PREFERRED},
        "how_it_works": list(HOW_IT_WORKS),
        "limitations": list(LIMITATIONS),
        "experience_note": EXPERIENCE_NOTE,
        "not_used": [
            "name, contact details, location",
            "education, institutions, certifications",
            "job titles and company names",
            "career gaps",
            "anything not confirmed by a person during resume review",
        ],
    }
