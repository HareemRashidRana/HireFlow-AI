"""Builders and fixtures for the attendance and leave tests.

The clock is controlled by replacing the `security` reference inside the three workforce services,
so sign-in tokens (which use the real clock) keep working while "now" is whatever a test says.
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.models.employee import Employee, EmploymentStatus, EmploymentType
from app.models.user import UserRole
from app.models.workforce import LeaveLedgerEntry, LeaveType, LedgerEntryType
from app.services import attendance, leave, workforce_analytics

ATT = "/api/v1/attendance"
LV = "/api/v1/leave"
MONDAY = "2026-03-02"  # a Monday


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 3, 2, 10, 0, tzinfo=UTC)

    def set(self, iso: str) -> None:
        value = datetime.fromisoformat(iso)
        self.now = value if value.tzinfo else value.replace(tzinfo=UTC)

    def advance(self, **kw) -> None:
        self.now += timedelta(**kw)


@pytest.fixture
def wclock(monkeypatch) -> Clock:
    c = Clock()
    shim = SimpleNamespace(utcnow=lambda: c.now)
    for module in (attendance, leave, workforce_analytics):
        monkeypatch.setattr(module, "security", shim)
    return c


class Person:
    def __init__(self, user, employee_id, client):
        self.user, self.employee_id, self.client = user, employee_id, client

    @property
    def id(self) -> str:
        return str(self.employee_id) if self.employee_id else ""


@pytest.fixture
def person(session_factory, make_user, new_client):
    """`person(UserRole.EMPLOYEE, "Sana")` -> a signed-in client linked to a new employee record."""
    counter = {"n": 0}

    from tests.conftest import sign_in  # imported late: conftest imports this module

    def _make(
        role: UserRole = UserRole.EMPLOYEE,
        first: str = "Sana",
        department: str = "Engineering",
        status: EmploymentStatus = EmploymentStatus.ACTIVE,
        link: bool = True,
    ) -> Person:
        counter["n"] += 1
        employee_id = None
        if link:
            with session_factory() as db:
                employee = Employee(
                    employee_id=f"W-{uuid.uuid4().hex[:8]}",
                    first_name=first,
                    last_name=f"Tester{counter['n']}",
                    work_email=f"{first.lower()}{counter['n']}@workforce.example.com",
                    job_title="Staff",
                    department=department,
                    employment_type=EmploymentType.FULL_TIME,
                    employment_status=status,
                    date_of_joining=date(2024, 1, 1),
                )
                db.add(employee)
                db.commit()
                employee_id = employee.id
        user = make_user(role, employee_id=employee_id)
        client = new_client()
        sign_in(client, user.email)
        return Person(user, employee_id, client)

    return _make


def seed_leave_types(session_factory) -> dict[str, uuid.UUID]:
    """The five types the migration inserts (a fresh test database has none)."""
    ids = {}
    with session_factory() as db:
        for code, name, paid, tracks, days in (
            ("annual", "Annual leave", True, True, 14),
            ("sick", "Sick leave", True, True, 10),
            ("casual", "Casual leave", True, True, 8),
            ("unpaid", "Unpaid leave", False, False, 0),
            ("other", "Other leave", True, False, 0),
        ):
            t = LeaveType(
                code=code, name=name, is_paid=paid, tracks_balance=tracks,
                default_days=Decimal(days), is_active=True,
            )  # fmt: skip
            db.add(t)
            db.flush()
            ids[code] = t.id
        db.commit()
    return ids


@pytest.fixture
def types(session_factory) -> dict[str, uuid.UUID]:
    return seed_leave_types(session_factory)


def grant(session_factory, employee_id, type_id, days: float, year: int = 2026) -> None:
    """Give someone a balance directly (HR does this through allocate/adjust in real use)."""
    with session_factory() as db:
        db.add(
            LeaveLedgerEntry(
                employee_id=employee_id,
                leave_type_id=type_id,
                year=year,
                entry_type=LedgerEntryType.ALLOCATION,
                days=Decimal(str(days)),
                reason="test grant",
            )
        )
        db.commit()


def request_body(type_id, start: str, end: str | None = None, reason: str = "Family event") -> dict:
    return {"leave_type_id": str(type_id), "start_date": start, "end_date": end or start, "reason": reason}


def submit(who: Person, type_id, start: str, end: str | None = None):
    return who.client.post(f"{LV}/requests", json=request_body(type_id, start, end))


def balance(who: Person, code: str, year: int = 2026, hr: Person | None = None) -> dict:
    """The balance row for one leave type code, read as the employee (or as HR for them)."""
    if hr is None:
        body = who.client.get(f"{LV}/balances/me", params={"year": year}).json()
    else:
        body = hr.client.get(f"{LV}/balances", params={"employee_id": who.id, "year": year}).json()
    return next(r for r in body["balances"] if r["leave_type"]["code"] == code)
