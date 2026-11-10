import os

# Must be set before the app is imported. Environment variables beat backend/.env, so tests never
# use (or depend on) the real secrets.
os.environ["SECRET_KEY"] = "test-only-secret-key-not-used-anywhere-else-0123456789"
os.environ["APP_ENV"] = "development"
os.environ["COOKIE_SECURE"] = "false"
os.environ["CORS_ORIGINS"] = "http://localhost:5173"

from collections.abc import Callable, Generator  # noqa: E402
from datetime import timedelta  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pwdlib import PasswordHash  # noqa: E402
from pwdlib.hashers.argon2 import Argon2Hasher  # noqa: E402
from sqlalchemy import Engine, create_engine, event  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import models  # noqa: E402, F401  (registers tables on Base.metadata)
from app.core import security  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402

DEFAULT_PASSWORD = "correct-horse-battery-staple"
CSRF_HEADERS = {"X-Requested-With": "HireFlow"}


@pytest.fixture(autouse=True)
def isolated_resume_storage(tmp_path, monkeypatch):
    """Every test gets its own empty storage folder: no test can ever touch real resume files."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "RESUME_STORAGE_DIR", str(tmp_path / "resume-storage"))


@pytest.fixture(autouse=True)
def fast_password_hasher(monkeypatch):
    """Argon2 is deliberately slow; use minimal cost in tests (the algorithm is unchanged)."""
    monkeypatch.setattr(
        security, "hasher", PasswordHash((Argon2Hasher(time_cost=1, memory_cost=8, parallelism=1),))
    )


@pytest.fixture
def engine() -> Generator[Engine, None, None]:
    """A fresh in-memory SQLite DB per test. Never touches the real database."""
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(eng, "connect")
    def _enforce_foreign_keys(dbapi_connection, _record):
        # SQLite ignores foreign keys by default; PostgreSQL enforces them (ON DELETE SET NULL...).
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def new_client(session_factory) -> Generator[Callable[[], TestClient], None, None]:
    """Factory for independent clients (each has its own cookie jar) on the same database."""

    def override_get_db() -> Generator[Session, None, None]:
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    clients: list[TestClient] = []

    def factory() -> TestClient:
        c = TestClient(app, headers=CSRF_HEADERS)
        c.__enter__()
        clients.append(c)
        return c

    yield factory
    for c in clients:
        c.__exit__(None, None, None)
    app.dependency_overrides.clear()


@pytest.fixture
def anon(new_client) -> TestClient:
    """Not signed in."""
    return new_client()


@pytest.fixture
def make_user(session_factory) -> Callable[..., User]:
    counter = {"n": 0}

    def _make(
        role: UserRole = UserRole.EMPLOYEE,
        *,
        email: str | None = None,
        password: str = DEFAULT_PASSWORD,
        **fields,
    ) -> User:
        counter["n"] += 1
        fields.setdefault("must_change_password", False)
        if role == UserRole.EMPLOYEE and "employee_id" not in fields:
            fields["employee_id"] = None  # tests that need a link pass employee_id explicitly
        with session_factory() as db:
            user = User(
                email=email or f"{role.value}{counter['n']}@example.com",
                password_hash=security.hash_password(password),
                role=role,
                **fields,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            return user

    return _make


def sign_in(client: TestClient, email: str, password: str = DEFAULT_PASSWORD) -> str:
    """Log in and attach the access token to the client. Returns the access token."""
    res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"
    return token


@pytest.fixture
def client_as(new_client, make_user) -> Callable[..., TestClient]:
    """`client_as(UserRole.HR_MANAGER)` -> a client signed in as a fresh user with that role."""

    def _client_as(role: UserRole, **user_fields) -> TestClient:
        user = make_user(role, **user_fields)
        c = new_client()
        sign_in(c, user.email)
        c.user = user  # type: ignore[attr-defined]
        return c

    return _client_as


@pytest.fixture
def client(client_as) -> TestClient:
    """Signed in as an admin. The employee tests use this."""
    return client_as(UserRole.ADMIN)


def employee_payload(n: int = 1, **overrides) -> dict:
    payload = {
        "employee_id": f"EMP-{n:03d}",
        "first_name": "Test",
        "last_name": f"Person{n}",
        "work_email": f"person{n}@example.com",
        "job_title": "Engineer",
        "department": "Engineering",
        "employment_type": "full_time",
        "date_of_joining": "2024-03-01",
    }
    payload.update(overrides)
    return payload


class FakeClock:
    def __init__(self) -> None:
        self.offset = timedelta()

    def advance(self, **kwargs: float) -> None:
        self.offset += timedelta(**kwargs)


@pytest.fixture
def clock(monkeypatch) -> FakeClock:
    """Move the app's notion of 'now' forward to test expiry and lockout windows."""
    fake = FakeClock()
    real = security.utcnow
    monkeypatch.setattr(security, "utcnow", lambda: real() + fake.offset)
    return fake


# Fixtures for the attendance and leave tests (a controllable clock, people with logins, leave types).
from tests.workforce_helpers import person, types, wclock  # noqa: E402, F401
