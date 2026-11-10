"""A person's adjustment, as a SEPARATE figure.

Sometimes a recruiter can see that a requirement is covered although the reviewed resume does not
list it by name (for example it is evidenced in a project description). They record that as a
review. This module turns the assessment's own per-criterion data plus the requirements the person
marked as covered into an "adjusted" figure, shown next to the original. Nothing here changes or
replaces the original result, and the figure is advisory in exactly the same way.

Pure: it works on plain data and imports nothing from the application.
"""

from collections.abc import Collection, Iterable
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction

NOT_LISTED = "not listed"


def unlisted_requirements(criteria: Iterable[dict]) -> list[str]:
    """Requirements (in the job's own spelling) that an adjustment could mark as covered."""
    found: list[str] = []
    for criterion in criteria:
        if criterion.get("status") != "assessed":
            continue
        for item in criterion.get("evidence") or ():
            if item.get("status") == NOT_LISTED:
                found.append(item["requirement"])
    return found


def adjusted_total(criteria: Iterable[dict], covered: Collection[str]) -> Decimal | None:
    """The coverage figure if the requirements in `covered` were counted as listed.

    None when there is no assessed criterion (nothing to adjust) or the evidence was removed by a
    privacy scrub. Only requirements that were really "not listed" can be added; anything else in
    `covered` is ignored, so the figure can never exceed what the requirements allow.
    """
    extra = set(covered)
    total = Fraction(0)
    seen = False
    for criterion in criteria:
        if criterion.get("status") != "assessed":
            continue
        evidence = criterion.get("evidence")
        if evidence is None or not criterion.get("total"):
            return None
        seen = True
        added = sum(1 for e in evidence if e["status"] == NOT_LISTED and e["requirement"] in extra)
        listed = min(criterion["total"], criterion["listed"] + added)
        weight = Fraction(Decimal(str(criterion["effective_weight"])))
        total += weight * Fraction(listed, criterion["total"])
    if not seen:
        return None
    exact = Decimal(total.numerator) / Decimal(total.denominator)
    return exact.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
