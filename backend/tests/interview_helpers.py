"""Builders for the interview tests. Dates are always relative to "now" so the tests never rot."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from tests.test_applications import make_application

INTERVIEWS = "/api/v1/interviews"
TZ = "Asia/Karachi"


def slot(day: int = 3, hour: int = 10, minutes: int = 60, tz: str = TZ) -> dict:
    """A local start/end on the UTC date `day` days from now, written as plain local strings in `tz`.

    The date comes from ONE shared reference (the UTC date), not from each zone's own calendar, so
    "10:00 in Karachi" and "05:00 UTC" built the same way are really the same instant at any hour of
    the day. (Using each zone's own date made these tests fail for part of every day.)"""
    zone = ZoneInfo(tz)
    base = (datetime.now(UTC) + timedelta(days=day)).date()
    start = datetime(base.year, base.month, base.day, hour, 0, tzinfo=zone)
    end = start + timedelta(minutes=minutes)
    fmt = "%Y-%m-%dT%H:%M"
    return {"starts_at": start.strftime(fmt), "ends_at": end.strftime(fmt), "timezone": tz}


def payload(application: dict, interviewers: list, *, day: int = 3, hour: int = 10, minutes: int = 60, **over) -> dict:
    body = {
        "application_id": application["id"],
        "title": "Technical interview",
        "interview_type": "technical",
        "mode": "online",
        "meeting_url": "https://meet.example.com/room/abc",
        "interviewer_ids": [str(getattr(u, "id", u)) for u in interviewers],
        **slot(day, hour, minutes),
    }
    body.update(over)
    return body


def schedule(client, application: dict, interviewers: list, **kw):
    return client.post(INTERVIEWS, json=payload(application, interviewers, **kw))


def scheduled(client, application: dict, interviewers: list, **kw) -> dict:
    res = schedule(client, application, interviewers, **kw)
    assert res.status_code == 201, res.text
    return res.json()


def new_application(client, n: int = 1) -> dict:
    return make_application(client, n)


def feedback_body(**over) -> dict:
    body = {
        "overall_rating": 4,
        "technical_rating": 4,
        "communication_rating": 5,
        "problem_solving_rating": 3,
        "overall_feedback": "Solid conversation; clear thinker.",
        "technical_notes": "Good grasp of data modelling.",
        "role_notes": "Would suit the platform team.",
        "strengths": "Communication",
        "concerns": "Would like to discuss scaling experience",
        "private_notes": "PRIVATE-NOTE-ONLY-FOR-AUTHOR",
    }
    body.update(over)
    return body


def board(client_as, make_user=None, *, started: bool = True):
    """An admin, two interviewer clients (a recruiter and an HR manager) and one interview they are
    both on. `started=True` moves it into the past so feedback can be submitted."""
    from types import SimpleNamespace

    from app.models.user import UserRole

    admin = client_as(UserRole.ADMIN)
    rec, hr = client_as(UserRole.RECRUITER), client_as(UserRole.HR_MANAGER)
    app = new_application(admin, 1)
    interview = scheduled(admin, app, [rec.user, hr.user], day=3, hour=10)
    return SimpleNamespace(admin=admin, rec=rec, hr=hr, app=app, interview=interview, id=interview["id"], url=f"{INTERVIEWS}/{interview['id']}")
