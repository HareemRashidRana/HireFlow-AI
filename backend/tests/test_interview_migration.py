"""The hand-written parts of the interview migration must stay in step with the code."""

import importlib.util
import re
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from app.models.audit import AuditEventType
from app.models.interview import (
    FeedbackStatus,
    Interview,
    InterviewEvent,
    InterviewEventType,
    InterviewFeedback,
    InterviewFeedbackRevision,
    InterviewInterviewer,
    InterviewMode,
    InterviewStatus,
    InterviewType,
)

BACKEND = Path(__file__).resolve().parents[1]
NEW, PREVIOUS = "d34d0c31088c", "e06ccfa51fe7"


def script() -> ScriptDirectory:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    return ScriptDirectory.from_config(cfg)


def path():
    return next((BACKEND / "alembic" / "versions").glob(f"{NEW}_*.py"))


def load():
    spec = importlib.util.spec_from_file_location("interview_migration", path())
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_one_head_and_the_right_parent():
    s = script()
    assert len(s.get_heads()) == 1  # no branches; later migrations build on this one
    assert s.get_revision(NEW).down_revision == PREVIOUS
    assert NEW in {r.revision for r in s.walk_revisions()}


def test_the_audit_check_list_equals_the_enum_exactly():
    m = load()
    assert list(m.PREVIOUS_EVENTS + m.INTERVIEW_EVENTS) == [e.value for e in AuditEventType]


def test_the_downgrade_target_is_the_enum_without_interview_events():
    m = load()
    interview_like = set(m.INTERVIEW_EVENTS)
    assert list(m.PREVIOUS_EVENTS) == [e.value for e in AuditEventType if e.value not in interview_like]


def test_every_enum_value_fits_its_column():
    assert max(len(e.value) for e in AuditEventType) <= 24
    for enum, width in ((InterviewType, 16), (InterviewMode, 10), (InterviewStatus, 12), (InterviewEventType, 20), (FeedbackStatus, 10)):
        assert max(len(e.value) for e in enum) <= width, enum


def test_the_migration_declares_the_same_enum_values_as_the_models():
    source = path().read_text(encoding="utf-8")
    for enum in (InterviewType, InterviewMode, InterviewStatus, InterviewEventType, FeedbackStatus):
        for member in enum:
            assert f"'{member.value}'" in source, member


def test_it_is_self_contained_and_guards_its_downgrade():
    source = path().read_text(encoding="utf-8")
    assert "from app" not in source and "import app" not in source
    assert "op.f(AUDIT_CHECK)" in source and "context.is_offline_mode()" in source
    assert "Cannot downgrade" in source


def test_constraint_and_index_names_match_between_models_and_migration():
    source = path().read_text(encoding="utf-8")
    for model in (Interview, InterviewInterviewer, InterviewEvent, InterviewFeedback, InterviewFeedbackRevision):
        table = model.__table__.name
        for item in model.__table__.constraints:
            name = str(item.name or "")
            if not name.startswith(("uq_", "ck_")):
                continue
            short = name.removeprefix(f"ck_{table}_")
            assert name in source or f"name='{short}'" in source, (table, name)
        for index in model.__table__.indexes:
            assert str(index.name) in source, (table, index.name)
    assert not re.findall(r"app\.db", source)
