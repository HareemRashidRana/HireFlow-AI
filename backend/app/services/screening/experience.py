"""Dated work experience, shown as CONTEXT ONLY. Never part of the Requirements Coverage figure.

The resume data does not say whether a position is relevant to a job, and this module does not try
to find out: it is given nothing but start / end dates and a "current" flag (no titles, no company
names), so it cannot infer relevance, seniority or anything else from them.

It also does not look for gaps and does not penalise them. Positions without usable dates are simply
not part of the figure, and are counted so the recruiter can see how many were left out.
"""

import re
from dataclasses import dataclass
from datetime import date

_DATE = re.compile(r"^(\d{4})(?:-(0[1-9]|1[0-2]))?$")
MIN_YEAR = 1950
YEAR_ONLY_MONTH = 7  # a bare year is read as mid-year, and the figure is flagged as approximate


@dataclass(frozen=True)
class Position:
    """A position reduced to the only facts this module may use."""

    start: str | None
    end: str | None
    current: bool = False


@dataclass(frozen=True)
class ExperienceContext:
    dated_months: int  # distinct calendar months covered (inclusive), overlaps counted once
    positions_total: int
    positions_counted: int
    positions_not_counted: int  # no usable dates; NOT a negative signal
    approximate: bool  # at least one counted date was a bare year
    notes: tuple[str, ...]  # machine-readable codes: future_end_clamped, invalid_range, ...


def _month_index(value: str | None) -> tuple[int, bool] | None:
    """(months since year 0, whether it was year-only) for 'YYYY' / 'YYYY-MM', else None."""
    if not isinstance(value, str):
        return None
    match = _DATE.match(value.strip())
    if not match:
        return None
    year = int(match.group(1))
    if year < MIN_YEAR:
        return None
    month = int(match.group(2)) if match.group(2) else YEAR_ONLY_MONTH
    return year * 12 + month - 1, match.group(2) is None


def summarize_experience(positions: tuple[Position, ...], today: date) -> ExperienceContext:
    """Total dated months across positions. `today` is passed in so the result is deterministic."""
    now = today.year * 12 + today.month - 1
    intervals: list[tuple[int, int]] = []
    approximate = False
    notes: set[str] = set()
    for position in positions:
        start = _month_index(position.start)
        end = (now, False) if position.current else _month_index(position.end)
        if start is None or end is None:
            continue
        s, e = start[0], end[0]
        if s > now:
            notes.add("future_start")
            continue
        if e > now:
            e = now
            notes.add("future_end_clamped")
        if e < s:
            notes.add("invalid_range")
            continue
        intervals.append((s, e))
        approximate = approximate or start[1] or (end[1] and not position.current)

    intervals.sort()
    merged: list[list[int]] = []
    for s, e in intervals:
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    months = sum(e - s + 1 for s, e in merged)  # inclusive: Mar 2018 to Dec 2020 is 34 months
    return ExperienceContext(
        dated_months=months,
        positions_total=len(positions),
        positions_counted=len(intervals),
        positions_not_counted=len(positions) - len(intervals),
        approximate=bool(approximate),
        notes=tuple(sorted(notes)),
    )


def format_months(months: int) -> str:
    years, rest = divmod(months, 12)
    parts = []
    if years:
        parts.append(f"{years} year{'s' if years != 1 else ''}")
    if rest:
        parts.append(f"{rest} month{'s' if rest != 1 else ''}")
    return " ".join(parts) or "less than a month"
