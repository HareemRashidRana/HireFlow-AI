"""Pure rules for interviews: time zones, meeting links, lifecycle transitions, the rating scale.

Nothing here touches the database, so every rule is tested in isolation.
"""

import re
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.models.interview import InterviewStatus

MIN_MINUTES = 5
MAX_MINUTES = 12 * 60
MAX_URL_CHARS = 500

# ---- time zones ------------------------------------------------------------------------------


def zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        raise ValueError(
            "Unknown time zone. Use a name like Asia/Karachi or Europe/London."
        ) from None


def resolve_instant(value: datetime, tz_name: str) -> datetime:
    """The absolute UTC instant for what the user typed.

    * A value with an offset ("2026-11-20T10:00:00+05:00") is converted as it is.
    * A plain local date and time ("2026-11-20T10:00") is read in `tz_name`. A time that does not
      exist (clocks jumped forward) or happens twice (clocks went back) is refused rather than
      guessed, so an interview can never silently move by an hour.
    Seconds are dropped: interviews are scheduled to the minute.
    """
    tz = zone(tz_name)
    value = value.replace(second=0, microsecond=0)
    if value.tzinfo is not None:
        return value.astimezone(UTC)
    first = value.replace(tzinfo=tz, fold=0)
    as_utc = first.astimezone(UTC)
    if as_utc.astimezone(tz).replace(tzinfo=None) != value:
        raise ValueError(
            "That local time does not exist in this time zone (clocks change that day)."
        )
    if first.utcoffset() != value.replace(tzinfo=tz, fold=1).utcoffset():
        raise ValueError(
            "That local time happens twice in this time zone (clocks change that day). "
            "Choose a different time or give the exact UTC offset."
        )
    return as_utc


def to_local(instant: datetime, tz_name: str) -> datetime:
    return instant.astimezone(zone(tz_name))


def local_text(instant: datetime, tz_name: str) -> str:
    """ "2026-11-20T10:00": the wall-clock time in the interview's own zone (display/edit)."""
    return to_local(instant, tz_name).strftime("%Y-%m-%dT%H:%M")


def utc_offset(instant: datetime, tz_name: str) -> str:
    off = to_local(instant, tz_name).utcoffset() or timedelta(0)
    minutes = int(off.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "-"
    return f"{sign}{abs(minutes) // 60:02d}:{abs(minutes) % 60:02d}"


def check_range(starts: datetime, ends: datetime) -> None:
    if ends <= starts:
        raise ValueError("The end time must be after the start time.")
    minutes = (ends - starts).total_seconds() / 60
    if minutes < MIN_MINUTES:
        raise ValueError(f"An interview must be at least {MIN_MINUTES} minutes long.")
    if minutes > MAX_MINUTES:
        raise ValueError(f"An interview can be at most {MAX_MINUTES // 60} hours long.")


# ---- meeting links ---------------------------------------------------------------------------

_SECRET_KEYS = {
    "pwd",
    "password",
    "passwd",
    "pass",
    "passcode",
    "pin",
    "token",
    "access_token",
    "auth",
    "key",
    "secret",
    "code",
    "otp",
    "jwt",
    "session",
    "sid",
    "signature",
    "sig",
    "apikey",
    "api_key",
}
_BAD_CHARS = re.compile(r"[\s\x00-\x1f\x7f]")


def clean_meeting_url(raw: str | None) -> str | None:
    """A plain https link, or an error. Links that carry a password or token are refused: HireFlow
    stores the link only, never a secret, so share any passcode outside the system."""
    if raw is None:
        return None
    url = raw.strip()
    if not url:
        return None
    if len(url) > MAX_URL_CHARS or _BAD_CHARS.search(url):
        raise ValueError("The meeting link is not valid.")
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        raise ValueError("The meeting link must be a full https:// address.")
    if parts.username or parts.password:
        raise ValueError("The meeting link must not contain a username or password.")
    if parts.fragment:
        raise ValueError("Remove the part after # from the meeting link.")
    for key, _ in parse_qsl(parts.query, keep_blank_values=True):
        if key.lower() in _SECRET_KEYS:
            raise ValueError(
                "The meeting link contains a password or access token. Remove it and share it "
                "with the interviewers another way: HireFlow does not store meeting secrets."
            )
    return url


# ---- lifecycle -------------------------------------------------------------------------------

S = InterviewStatus
TRANSITIONS: dict[InterviewStatus, frozenset[InterviewStatus]] = {
    S.SCHEDULED: frozenset({S.CONFIRMED, S.COMPLETED, S.CANCELLED, S.RESCHEDULED}),
    S.CONFIRMED: frozenset({S.COMPLETED, S.CANCELLED, S.RESCHEDULED}),
    S.COMPLETED: frozenset(),
    S.CANCELLED: frozenset(),
    S.RESCHEDULED: frozenset(),
}


def can_transition(current: InterviewStatus, target: InterviewStatus) -> bool:
    return target in TRANSITIONS[current]


# ---- feedback rating scale (the one place to change it) --------------------------------------

RATING_SCALE: tuple[dict, ...] = (
    {
        "value": 1,
        "label": "Well below expectations",
        "description": "Did not demonstrate what the role needs in this area.",
    },
    {
        "value": 2,
        "label": "Below expectations",
        "description": "Showed some of what the role needs, with clear gaps.",
    },
    {
        "value": 3,
        "label": "Meets expectations",
        "description": "Demonstrated what the role needs in this area.",
    },
    {
        "value": 4,
        "label": "Above expectations",
        "description": "Demonstrated more than the role needs in this area.",
    },
    {
        "value": 5,
        "label": "Well above expectations",
        "description": "Demonstrated far more than the role needs in this area.",
    },
)
RATING_AREAS: tuple[dict, ...] = (
    {"key": "overall_rating", "label": "Overall", "required_to_submit": True},
    {"key": "technical_rating", "label": "Technical", "required_to_submit": False},
    {"key": "communication_rating", "label": "Communication", "required_to_submit": False},
    {"key": "problem_solving_rating", "label": "Problem solving", "required_to_submit": False},
)
