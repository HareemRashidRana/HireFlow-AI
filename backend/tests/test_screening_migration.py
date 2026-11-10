"""The hand-written parts of the screening migration must stay in step with the code."""

import importlib.util
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from app.models.audit import AuditEventType
from app.models.screening import AdjustmentReason, AssessmentStatus, ReviewJudgement, ScrubReason

BACKEND = Path(__file__).resolve().parents[1]
NEW, PREVIOUS = "e06ccfa51fe7", "1845342c233e"


def script() -> ScriptDirectory:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    return ScriptDirectory.from_config(cfg)


def load_migration():
    path = next((BACKEND / "alembic" / "versions").glob(f"{NEW}_*.py"))
    spec = importlib.util.spec_from_file_location("screening_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_graph_has_one_head_and_the_right_parent():
    s = script()
    assert len(s.get_heads()) == 1  # no branches
    assert s.get_revision(NEW).down_revision == PREVIOUS
    chain = {r.revision for r in s.walk_revisions()}
    assert NEW in chain and PREVIOUS in chain  # still on the one line of history


def test_the_audit_check_list_is_a_prefix_of_the_enum():
    """Later migrations widen it further (interviews); this one's list must still be exactly its own."""
    m = load_migration()
    values = [e.value for e in AuditEventType]
    assert list(m.PREVIOUS_EVENTS + m.SCREENING_EVENTS) == values[: len(m.PREVIOUS_EVENTS + m.SCREENING_EVENTS)]


def test_the_downgrade_target_is_the_enum_before_screening():
    m = load_migration()
    values = [e.value for e in AuditEventType]
    assert list(m.PREVIOUS_EVENTS) == values[: len(m.PREVIOUS_EVENTS)]
    assert not any(v.startswith("screening_") for v in m.PREVIOUS_EVENTS)


def test_every_enum_value_fits_its_column():
    assert max(len(e.value) for e in AuditEventType) <= 24
    assert max(len(e.value) for e in AssessmentStatus) <= 10
    assert max(len(e.value) for e in ReviewJudgement) <= 10
    assert max(len(e.value) for e in AdjustmentReason) <= 20
    assert max(len(e.value) for e in ScrubReason) <= 16


def test_the_migration_declares_the_same_enum_values_as_the_models():
    source = (next((BACKEND / "alembic" / "versions").glob(f"{NEW}_*.py"))).read_text(encoding="utf-8")
    for enum in (AssessmentStatus, ReviewJudgement, AdjustmentReason, ScrubReason):
        for member in enum:
            assert f"'{member.value}'" in source, member


def test_it_does_not_reference_application_modules_that_could_change():
    source = (next((BACKEND / "alembic" / "versions").glob(f"{NEW}_*.py"))).read_text(encoding="utf-8")
    assert "from app" not in source and "import app" not in source
    assert "op.f(AUDIT_CHECK)" in source and "context.is_offline_mode()" in source


def test_named_constraints_and_indexes_match_between_models_and_migration():
    """A rename in the model (or the migration) alone would leave a real database out of step."""
    import re

    from app.models.screening import ScreeningAssessment, ScreeningReview

    source = (next((BACKEND / "alembic" / "versions").glob(f"{NEW}_*.py"))).read_text(encoding="utf-8")
    prefix = {ScreeningAssessment: "screening_assessments", ScreeningReview: "screening_reviews"}
    for model, table in prefix.items():
        for item in model.__table__.constraints:
            name = item.name
            if name is None or not str(name).startswith(("uq_", "ck_")):
                continue
            # Enum CHECKs get their full name from the naming convention at run time, so the
            # migration only spells the short part (name='scrub_reason'); the rest spell it in full.
            short = str(name).removeprefix(f"ck_{table}_")
            assert str(name) in source or f"name='{short}'" in source, (table, name)
        for index in model.__table__.indexes:
            assert str(index.name) in source, (table, index.name)
    assert not re.findall(r"app\.db", source)
