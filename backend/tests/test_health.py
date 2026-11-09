from fastapi.testclient import TestClient

from app.api.v1 import health as health_module
from app.db.session import get_db
from app.main import app


class _FakeDB:
    def execute(self, *_args, **_kwargs):
        return None


class _BrokenDB:
    def execute(self, *_args, **_kwargs):
        raise RuntimeError("db down")


def _client(db) -> TestClient:
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def teardown_function():
    app.dependency_overrides.clear()


def test_health_ok():
    res = _client(_FakeDB()).get("/api/v1/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.json()["database"] == "connected"


def test_health_degraded_when_db_down():
    res = _client(_BrokenDB()).get("/api/v1/health")
    assert res.status_code == 200
    assert res.json()["status"] == "degraded"
    assert "db down" not in res.text  # no error details leaked


def test_module_importable():
    assert health_module.router is not None
