"""The lockout queries run on every sign-in, so they must be index-backed."""

from sqlalchemy import text

from app.models.login_attempt import LoginAttempt


def _indexes():
    return {i.name: [c.name for c in i.columns] for i in LoginAttempt.__table__.indexes}


def test_composite_indexes_exist_with_equality_column_first():
    idx = _indexes()
    assert idx["ix_login_attempts_identifier_created"] == ["identifier_hash", "created_at"]
    assert idx["ix_login_attempts_ip_created"] == ["ip_address", "created_at"]
    assert idx["ix_login_attempts_created_at"] == ["created_at"]  # used by the 24h prune


def test_redundant_single_column_indexes_are_gone():
    assert len(_indexes()) == 3  # the two composites + created_at only


def _plan(engine, sql: str) -> str:
    with engine.connect() as conn:
        rows = conn.execute(text(f"EXPLAIN QUERY PLAN {sql}"), {"v": "x", "t": 0}).all()
    return " ".join(str(r[-1]) for r in rows)


def test_account_lockout_query_uses_composite_index(engine):
    plan = _plan(
        engine,
        "SELECT count(*), max(created_at) FROM login_attempts "
        "WHERE identifier_hash = :v AND succeeded = 0 AND created_at > :t",
    )
    assert "ix_login_attempts_identifier_created" in plan


def test_ip_rate_limit_query_uses_composite_index(engine):
    plan = _plan(
        engine,
        "SELECT count(*), max(created_at) FROM login_attempts "
        "WHERE ip_address = :v AND succeeded = 0 AND created_at > :t",
    )
    assert "ix_login_attempts_ip_created" in plan


def test_unlock_delete_uses_composite_index_prefix(engine):
    plan = _plan(engine, "DELETE FROM login_attempts WHERE identifier_hash = :v AND succeeded = 0")
    assert "ix_login_attempts_identifier_created" in plan


def test_prune_uses_created_at_index(engine):
    plan = _plan(engine, "DELETE FROM login_attempts WHERE created_at < :t")
    assert "ix_login_attempts_created_at" in plan
