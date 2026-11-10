"""Requirements Coverage: a deterministic, explainable comparison of a job's listed skills with the
skills listed in a HUMAN-REVIEWED resume.

This module is pure. It imports nothing from the database, the web layer or the application
workflow; it cannot read a resume, change an application or write anything. Same inputs always give
the same output (the only clock is the `today` argument).

What it reads from a resume: the reviewed skill list, and start / end dates of positions (for the
context figure only). It is never given a name, contact details, education, titles or companies.
"""

import hashlib
import json
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction

from app.services.screening import methodology as text
from app.services.screening.aliases import ALIAS_TABLE_VERSION
from app.services.screening.experience import (
    ExperienceContext,
    Position,
    summarize_experience,
)
from app.services.screening.normalize import canonical_skill

MAX_JOB_SKILLS = 50
MAX_PROFILE_SKILLS = 200

REQUIRED = "required_skills"
PREFERRED = "preferred_skills"
_NOMINAL = {REQUIRED: text.WEIGHT_REQUIRED, PREFERRED: text.WEIGHT_PREFERRED}
_LABELS = {REQUIRED: "Required skills", PREFERRED: "Preferred skills"}


@dataclass(frozen=True)
class JobRequirements:
    required: tuple[str, ...] = ()
    preferred: tuple[str, ...] = ()


@dataclass(frozen=True)
class ReviewedProfile:
    """The ONLY resume facts the engine receives (all from human-reviewed data)."""

    skills: tuple[str, ...] = ()
    positions: tuple[Position, ...] = ()


@dataclass(frozen=True)
class SkillEvidence:
    requirement: str  # the job's own spelling
    status: str  # "listed" | "not listed"
    matched_text: str | None  # how the reviewed resume spelled it
    matched_via: str | None  # "exact" | "alias" | None


@dataclass(frozen=True)
class CriterionResult:
    key: str
    label: str
    nominal_weight: int
    effective_weight: Decimal | None  # after renormalisation; None when not assessed
    status: str  # "assessed" | "not_assessed"
    reason_code: str | None
    reason: str | None
    listed: int
    total: int
    points: Decimal | None
    evidence: tuple[SkillEvidence, ...] = ()


@dataclass(frozen=True)
class CoverageResult:
    scoring_version: str
    alias_table_version: str
    status: str  # "scored" | "unscored"
    total: Decimal | None  # 0-100, one decimal, rounded half up
    assessed_weight: int  # nominal weight that could be assessed (100, 80, 20 or 0)
    criteria: tuple[CriterionResult, ...]
    experience: ExperienceContext
    explanation: str
    warnings: tuple[str, ...] = ()
    limitations: tuple[str, ...] = field(default=text.LIMITATIONS)

    def to_dict(self) -> dict:
        return _jsonable(self)


def _jsonable(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, tuple | list):
        return [_jsonable(v) for v in value]
    if hasattr(value, "__dataclass_fields__"):
        return {k: _jsonable(getattr(value, k)) for k in value.__dataclass_fields__}
    return value


def _round1(value: Fraction) -> Decimal:
    exact = Decimal(value.numerator) / Decimal(value.denominator)
    return exact.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class _Prepared:
    originals: tuple[str, ...]  # first spelling of each distinct skill
    keys: tuple[str, ...]  # canonical keys, same order
    ignored: int
    truncated: bool


def _prepare(values: tuple[str, ...], cap: int) -> _Prepared:
    originals: list[str] = []
    keys: list[str] = []
    seen: set[str] = set()
    ignored = 0
    for raw in values[:cap]:
        canon = canonical_skill(raw)
        if canon is None:
            ignored += 1
        elif canon[0] not in seen:
            seen.add(canon[0])
            originals.append(raw.strip())
            keys.append(canon[0])
    return _Prepared(tuple(originals), tuple(keys), ignored, len(values) > cap)


def _index_profile(skills: tuple[str, ...]) -> tuple[dict[str, tuple[str, bool]], int, bool]:
    """canonical key -> (the resume's own spelling, whether an alias was needed)."""
    index: dict[str, tuple[str, bool]] = {}
    ignored = 0
    for raw in skills[:MAX_PROFILE_SKILLS]:
        canon = canonical_skill(raw)
        if canon is None:
            ignored += 1
        else:
            index.setdefault(canon[0], (raw.strip(), canon[1]))
    return index, ignored, len(skills) > MAX_PROFILE_SKILLS


def _not_assessed(key: str, code: str) -> CriterionResult:
    return CriterionResult(
        key=key, label=_LABELS[key], nominal_weight=_NOMINAL[key], effective_weight=None,
        status="not_assessed", reason_code=code, reason=text.REASONS[code],
        listed=0, total=0, points=None,
    )


def _compare(key: str, prepared: _Prepared, index: dict[str, tuple[str, bool]]):
    evidence = []
    for original, canon in zip(prepared.originals, prepared.keys, strict=True):
        hit = index.get(canon)
        if hit is None:
            evidence.append(SkillEvidence(original, text.NOT_LISTED, None, None))
            continue
        spelled, aliased = hit
        # "alias" when the job's or the resume's spelling needed the table to reach this skill
        via = "alias" if aliased or canonical_skill(original) != (canon, False) else "exact"
        evidence.append(SkillEvidence(original, text.LISTED, spelled, via))
    return tuple(evidence)


def compute_coverage(
    requirements: JobRequirements, profile: ReviewedProfile, *, today: date
) -> CoverageResult:
    required = _prepare(requirements.required, MAX_JOB_SKILLS)
    preferred = _prepare(requirements.preferred, MAX_JOB_SKILLS)
    warnings: list[str] = []

    # A skill named in both lists is counted once, as required (never double-counted).
    required_keys = set(required.keys)
    overlap = {k for k in preferred.keys if k in required_keys}
    if overlap:
        warnings.append("preferred_also_required")
        kept = [i for i, k in enumerate(preferred.keys) if k not in overlap]
        preferred = _Prepared(
            tuple(preferred.originals[i] for i in kept),
            tuple(preferred.keys[i] for i in kept),
            preferred.ignored,
            preferred.truncated,
        )
    if required.truncated or preferred.truncated:
        warnings.append("job_skills_truncated")

    index, profile_ignored, profile_truncated = _index_profile(profile.skills)
    if profile_truncated:
        warnings.append("skills_truncated")
    if required.ignored or preferred.ignored or profile_ignored:
        warnings.append("ignored_skill_entries")

    results: dict[str, CriterionResult] = {}
    for key, prepared in ((REQUIRED, required), (PREFERRED, preferred)):
        if not prepared.keys:
            results[key] = _not_assessed(key, "job_lists_none")
        elif not index:
            results[key] = _not_assessed(key, "no_reviewed_skills")
        else:
            evidence = _compare(key, prepared, index)
            listed = sum(e.status == text.LISTED for e in evidence)
            results[key] = CriterionResult(
                key=key, label=_LABELS[key], nominal_weight=_NOMINAL[key], effective_weight=None,
                status="assessed", reason_code=None, reason=None,
                listed=listed, total=len(evidence), points=None, evidence=evidence,
            )

    assessed = [r for r in results.values() if r.status == "assessed"]
    assessed_weight = sum(r.nominal_weight for r in assessed)
    experience = summarize_experience(profile.positions, today)

    if not assessed:
        reasons = sorted({r.reason for r in results.values() if r.reason})
        return CoverageResult(
            scoring_version=text.SCORING_VERSION, alias_table_version=ALIAS_TABLE_VERSION,
            status="unscored", total=None, assessed_weight=0,
            criteria=(results[REQUIRED], results[PREFERRED]), experience=experience,
            explanation="No Requirements Coverage figure was calculated. " + " ".join(reasons),
            warnings=tuple(warnings),
        )

    total = Fraction(0)
    final: list[CriterionResult] = []
    for key in (REQUIRED, PREFERRED):
        r = results[key]
        if r.status != "assessed":
            final.append(r)
            continue
        effective = Fraction(100 * r.nominal_weight, assessed_weight)
        points = effective * Fraction(r.listed, r.total)
        total += points
        final.append(
            CriterionResult(
                key=r.key, label=r.label, nominal_weight=r.nominal_weight,
                effective_weight=_round1(effective), status=r.status, reason_code=None, reason=None,
                listed=r.listed, total=r.total, points=_round1(points), evidence=r.evidence,
            )
        )
    explanation = (
        f"Requirements Coverage is based on {assessed_weight} of 100 weight "
        f"({'both skill groups' if assessed_weight == 100 else 'one skill group'}). "
        "It is advisory and does not assess the candidate."
    )
    return CoverageResult(
        scoring_version=text.SCORING_VERSION, alias_table_version=ALIAS_TABLE_VERSION,
        status="scored", total=_round1(total), assessed_weight=assessed_weight,
        criteria=tuple(final), experience=experience, explanation=explanation,
        warnings=tuple(warnings),
    )


def input_fingerprint(requirements: JobRequirements, profile: ReviewedProfile) -> str:
    """A hash of what the SCORE depends on (canonical skills, versions): never any content.

    Two runs with the same fingerprint would give the same figure, so a stored assessment can be
    recognised as current or outdated without keeping the resume itself. Experience dates do not
    affect the figure and are not included.
    """
    def keys(values: tuple[str, ...], cap: int) -> list[str]:
        found = (canonical_skill(v) for v in values[:cap])
        return sorted({c[0] for c in found if c is not None})

    payload = {
        "scoring": text.SCORING_VERSION,
        "aliases": ALIAS_TABLE_VERSION,
        "required": keys(requirements.required, MAX_JOB_SKILLS),
        "preferred": keys(requirements.preferred, MAX_JOB_SKILLS),
        "candidate": keys(profile.skills, MAX_PROFILE_SKILLS),
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()
