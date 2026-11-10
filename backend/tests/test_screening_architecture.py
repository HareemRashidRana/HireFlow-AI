"""Structural guarantees for R4.1: the persistence and API layers cannot rank, sort by a figure,
read raw parser output, or touch an application's stage. These read the source and the OpenAPI
document, so a future change that breaks a promise fails here even if no behaviour test notices."""

import ast
import re
from decimal import Decimal
from pathlib import Path

import pytest

from app.main import app
from app.services.screening.adjust import adjusted_total, unlisted_requirements

APP = Path(__file__).resolve().parents[1] / "app"
LAYER_FILES = [
    APP / "services" / "screening_service.py",
    APP / "api" / "v1" / "screening.py",
    APP / "schemas" / "screening.py",
    APP / "models" / "screening.py",
]


def identifiers(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    names |= {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    names |= {a.arg for n in ast.walk(tree) if isinstance(n, ast.arguments) for a in n.args}
    return names


def imports(path: Path) -> set[str]:
    out: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            out |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            out.add(node.module)
            out |= {f"{node.module}.{a.name}" for a in node.names}
    return out


class TestNoStageOrWorkflowAccess:
    @pytest.mark.parametrize("path", LAYER_FILES, ids=lambda p: p.name)
    def test_no_stage_change_functions_or_workflow_imports(self, path):
        names = identifiers(path)
        for banned in ("change_stage", "reopen", "_move", "allowed_targets", "can_reopen", "ApplicationStage",
                       "ApplicationEvent", "ApplicationEventType", "stage_changed_at"):
            assert banned not in names, (path.name, banned)
        for module in imports(path):
            assert "application_workflow" not in module and module != "app.services.application", module

    def test_the_service_never_assigns_to_an_application(self):
        tree = ast.parse((APP / "services" / "screening_service.py").read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name):
                        assert target.value.id != "application", ast.dump(target)
            if isinstance(node, ast.Call) and getattr(node.func, "id", "") in ("update", "delete"):
                assert "Application" not in ast.unparse(node.args[0]) or "Screening" in ast.unparse(node.args[0])


class TestOnlyReviewedDataReachesTheEngine:
    @pytest.mark.parametrize("path", LAYER_FILES, ids=lambda p: p.name)
    def test_parsed_data_is_never_mentioned(self, path):
        assert "parsed_data" not in identifiers(path)

    def test_the_service_gets_resume_data_only_from_reviewed_data(self):
        source = (APP / "services" / "screening_service.py").read_text(encoding="utf-8")
        assert "profile_from_reviewed(resume.reviewed_data)" in source
        assert "resume.parsed_data" not in source and "ParsedResume" not in source
        assert source.count("reviewed_data") >= 3

    def test_a_resume_must_have_been_reviewed_by_a_person(self):
        source = (APP / "services" / "screening_service.py").read_text(encoding="utf-8")
        assert "resume.reviewed_at is None" in source and "resume.reviewed_data is None" in source


class TestNoRankingSortingOrFiltering:
    SCREENING_PATHS = [p for p in app.openapi()["paths"] if "screening" in p]

    def test_the_routes_exist(self):
        assert len(self.SCREENING_PATHS) == 5

    def test_no_screening_endpoint_accepts_a_sort_order_or_score_filter(self):
        banned = re.compile(r"sort|order|rank|score|min_|max_|threshold|filter|top|best|cutoff", re.I)
        for path, methods in app.openapi()["paths"].items():
            if "screening" not in path:
                continue
            for method, spec in methods.items():
                for param in spec.get("parameters", []):
                    if param["in"] == "query":
                        assert not banned.search(param["name"]), (path, method, param["name"])

    def test_only_paging_parameters_exist_on_the_job_overview(self):
        spec = app.openapi()["paths"]["/api/v1/jobs/{job_id}/screening"]["get"]
        assert {p["name"] for p in spec["parameters"] if p["in"] == "query"} == {"page", "page_size"}

    def test_no_screening_response_field_ranks_or_recommends(self):
        banned = re.compile(r"rank|recommend|percentile|suitab|quality|decision|shortlist|reject|hire|best|top_", re.I)
        schemas = app.openapi()["components"]["schemas"]
        for name, schema in schemas.items():
            if not any(k in name for k in ("Assessment", "Screening", "Criterion", "Coverage", "Methodology", "Readiness", "Freshness")):
                continue
            for field in schema.get("properties", {}):
                assert not banned.search(field), (name, field)

    def test_the_job_overview_item_has_no_figure_field(self):
        props = app.openapi()["components"]["schemas"]["JobScreeningItem"]["properties"]
        assert not [p for p in props if re.search(r"score|total|points|percent|coverage", p, re.I)]

    def test_the_job_overview_query_orders_by_application_date_only(self):
        source = (APP / "services" / "screening_service.py").read_text(encoding="utf-8")
        body = source[source.index("def job_overview"): source.index("# ---- privacy")]
        order_calls = re.findall(r"order_by\(([^)]*)\)", body)
        assert any("Application.applied_at" in c for c in order_calls)  # applicants: by date
        for c in order_calls:  # nothing is ever ordered by a figure or a status
            assert not re.search(r"total_score|assessed_weight|status|points|criteria", c), c
        assert "total_score" not in body.split("items = []")[0]

    def test_no_orm_query_in_the_service_sorts_or_filters_by_total_score(self):
        source = (APP / "services" / "screening_service.py").read_text(encoding="utf-8")
        assert not re.search(r"(order_by|where|filter|having)\([^)]*total_score", source)


class TestWording:
    def test_user_facing_strings_in_the_service_avoid_evaluative_language(self):
        from app.services import screening_service as svc

        banned = re.compile(r"suitab|quality|recommend|\brank|\bbest\b|\bstrong\b|\bweak\b|\blacks?\b|unqualified", re.I)
        for text in [*svc.BLOCKER_TEXT.values(), *svc.FRESHNESS_TEXT.values()]:
            assert not banned.search(text), text


class TestAdjustHelper:
    CRITERIA = [
        {"key": "required_skills", "status": "assessed", "effective_weight": 80.0, "listed": 1, "total": 4,
         "evidence": [{"requirement": "A", "status": "listed"}, {"requirement": "B", "status": "not listed"},
                      {"requirement": "C", "status": "not listed"}, {"requirement": "D", "status": "not listed"}]},
        {"key": "preferred_skills", "status": "assessed", "effective_weight": 20.0, "listed": 0, "total": 2,
         "evidence": [{"requirement": "E", "status": "not listed"}, {"requirement": "F", "status": "not listed"}]},
    ]

    def test_unlisted_requirements(self):
        assert unlisted_requirements(self.CRITERIA) == ["B", "C", "D", "E", "F"]

    @pytest.mark.parametrize(
        "covered,expected",
        [([], "20.0"), (["B"], "40.0"), (["B", "C", "D"], "80.0"), (["E"], "30.0"), (["E", "F"], "40.0"),
         (["B", "C", "D", "E", "F"], "100.0")],
    )
    def test_adjusted_figure(self, covered, expected):
        assert adjusted_total(self.CRITERIA, covered) == Decimal(expected)

    def test_things_that_were_not_unlisted_cannot_add_anything(self):
        assert adjusted_total(self.CRITERIA, ["A", "Z", "a"]) == Decimal("20.0")

    def test_it_never_changes_its_input(self):
        import copy

        before = copy.deepcopy(self.CRITERIA)
        adjusted_total(self.CRITERIA, ["B", "E"])
        assert self.CRITERIA == before

    def test_nothing_to_adjust_or_scrubbed_evidence_gives_none(self):
        assert adjusted_total([], ["B"]) is None
        scrubbed = [{**self.CRITERIA[0], "evidence": None}]
        assert adjusted_total(scrubbed, ["B"]) is None
        not_assessed = [{"key": "required_skills", "status": "not_assessed"}]
        assert adjusted_total(not_assessed, ["B"]) is None
        assert unlisted_requirements(scrubbed) == [] and unlisted_requirements(not_assessed) == []

    def test_a_single_assessed_group_uses_its_own_effective_weight(self):
        only_preferred = [{**self.CRITERIA[1], "effective_weight": 100.0}]
        assert adjusted_total(only_preferred, ["E"]) == Decimal("50.0")
