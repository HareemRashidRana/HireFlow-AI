"""Month arithmetic and the activity rule behind candidate retention."""

from datetime import UTC, date, datetime

import pytest

from app.core.config import settings
from app.models.candidate import Candidate
from app.services.candidate import add_months, touch_activity


@pytest.mark.parametrize(
    "start,months,expected",
    [
        (date(2026, 1, 15), 12, date(2027, 1, 15)),
        (date(2026, 1, 31), 1, date(2026, 2, 28)),  # clamp to the end of a short month
        (date(2028, 1, 31), 1, date(2028, 2, 29)),  # leap year
        (date(2026, 8, 31), 6, date(2027, 2, 28)),
        (date(2028, 2, 29), 12, date(2029, 2, 28)),
        (date(2026, 12, 31), 2, date(2027, 2, 28)),  # crosses a year boundary
        (date(2026, 5, 31), 1, date(2026, 6, 30)),
        (date(2026, 11, 10), 24, date(2028, 11, 10)),
        (date(2026, 3, 15), 0, date(2026, 3, 15)),
        (date(2026, 1, 1), 120, date(2036, 1, 1)),
    ],
)
def test_add_months(start, months, expected):
    assert add_months(start, months) == expected


def test_touch_activity_sets_both_fields_from_the_given_time(monkeypatch):
    monkeypatch.setattr(settings, "CANDIDATE_RETENTION_MONTHS", 12)
    candidate = Candidate()
    now = datetime(2026, 5, 20, 9, 30, tzinfo=UTC)
    touch_activity(candidate, now)
    assert candidate.last_activity_at == now
    assert candidate.retain_until == date(2027, 5, 20)


def test_touch_activity_restarts_the_clock_each_time(monkeypatch):
    monkeypatch.setattr(settings, "CANDIDATE_RETENTION_MONTHS", 12)
    candidate = Candidate()
    touch_activity(candidate, datetime(2026, 1, 1, tzinfo=UTC))
    first = candidate.retain_until
    touch_activity(candidate, datetime(2026, 9, 1, tzinfo=UTC))
    assert candidate.retain_until == date(2027, 9, 1) and candidate.retain_until > first


def test_touch_activity_uses_the_current_time_by_default():
    candidate = Candidate()
    touch_activity(candidate)
    assert candidate.last_activity_at.tzinfo is not None
    assert candidate.retain_until > candidate.last_activity_at.date()
