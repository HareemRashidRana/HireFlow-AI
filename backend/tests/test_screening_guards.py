"""Guards for R4.0: only reviewed data gets in, the package stays pure and cannot reach into
applications, resumes' raw text or the clock."""

import ast
import json
from datetime import date
from pathlib import Path

import pytest

from app.services import resume_parser
from app.services.screening import (
    JobRequirements,
    ReviewedDataError,
    compute_coverage,
    profile_from_reviewed,
    requirements_from_job,
)

PACKAGE = Path(__file__).resolve().parents[1] / "app" / "services" / "screening"
SOURCES = {p.name: p.read_text(encoding="utf-8") for p in PACKAGE.glob("*.py")}
REVIEWED = {
    "name": "A B", "email": "a@example.com", "phone": None,
    "skills": ["Python", "SQL"],
    "education": [{"institution": "X", "degree": "BSc", "field": "CS", "start_year": 2010, "end_year": 2014}],
    "experience": [{"title": "Dev", "company": "Acme", "start": "2020-01", "end": None, "current": True}],
}


class TestOnlyReviewedDataIsAccepted:
    def test_none_means_not_reviewed(self):
        with pytest.raises(ReviewedDataError, match="not been reviewed"):
            profile_from_reviewed(None)

    def test_real_parser_output_is_refused(self):
        """parsed_data (what the machine read) has a different shape and must never score."""
        parsed = resume_parser.parse_resume(
            "Ayesha Khan\nayesha@example.com\n\nSkills\nPython, SQL\n\nExperience\nDev at Acme\n2020 - Present"
        )
        assert parsed["skills"]["values"], "the fixture must really contain skills"
        with pytest.raises(ReviewedDataError):
            profile_from_reviewed(parsed)

    def test_parsed_shape_is_refused_even_if_it_looks_close(self):
        near = {**REVIEWED, "parser_version": 1}
        with pytest.raises(ReviewedDataError):
            profile_from_reviewed(near)
        with pytest.raises(ReviewedDataError):
            profile_from_reviewed({**REVIEWED, "skills": {"values": ["Python"], "confidence": "high"}})

    @pytest.mark.parametrize(
        "bad",
        [[], "text", 5, {"warnings": []}, {"sections_found": []}, {"skills": "Python"},
         {"skills": [1, 2]}, {"skills": [None]}, {"skills": ["a"], "extra": 1},
         {"education": "x"}, {"education": [{"gpa": 4}]}, {"education": ["x"]},
         {"experience": "x"}, {"experience": ["x"]}, {"experience": [{"salary": 1}]},
         {"experience": [{"start": 2020}]}, {"experience": [{"current": "yes"}]},
         {"experience": [{"months": 70}]}],
    )
    def test_malformed_or_foreign_shapes_are_refused(self, bad):
        with pytest.raises(ReviewedDataError):
            profile_from_reviewed(bad)

    def test_a_partial_reviewed_record_is_fine(self):
        assert profile_from_reviewed({"skills": ["Python"]}).skills == ("Python",)
        assert profile_from_reviewed({}).skills == ()

    def test_only_skills_and_dates_are_extracted(self):
        profile = profile_from_reviewed(REVIEWED)
        assert profile.skills == ("Python", "SQL")
        assert [(p.start, p.end, p.current) for p in profile.positions] == [("2020-01", None, True)]
        blob = json.dumps(profile, default=lambda o: o.__dict__)
        for private in ("a@example.com", "Acme", "Dev", "BSc", "A B", "X"):
            assert private not in blob.replace('"X"', ""), private

    def test_job_requirements_contain_only_skill_lists(self):
        req = requirements_from_job(["Python"], ["SQL"])
        assert req == JobRequirements(("Python",), ("SQL",))
        assert requirements_from_job(None, None) == JobRequirements((), ())
        assert set(JobRequirements.__dataclass_fields__) == {"required", "preferred"}


class TestScoringUsesOnlyWhatItIsGiven:
    def test_a_hostile_parsed_looking_skill_list_cannot_reach_the_score(self):
        """Unreviewed readings never get here, but even so skills are plain strings, nothing else."""
        profile = profile_from_reviewed({"skills": ["Python"]})
        result = compute_coverage(JobRequirements(("Python", "Go"), ()), profile, today=date(2026, 1, 1))
        assert str(result.total) == "50.0"


def _imports(source: str) -> set[str]:
    found: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            found |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            found.add(node.module)
    return found


class TestThePackageIsPureAndCannotReachRestrictedThings:
    FORBIDDEN_IMPORT_PREFIXES = (
        "sqlalchemy", "fastapi", "starlette", "app.models", "app.db", "app.api", "app.core",
        "app.services.application", "app.services.application_workflow", "app.services.resume",
        "app.services.candidate", "app.services.audit", "app.services.privacy",
        "app.schemas", "httpx", "requests", "socket", "subprocess", "os", "pathlib", "random",
        "time",
    )

    @pytest.mark.parametrize("name", sorted(SOURCES))
    def test_no_forbidden_imports(self, name):
        for module in _imports(SOURCES[name]):
            for prefix in self.FORBIDDEN_IMPORT_PREFIXES:
                assert not (module == prefix or module.startswith(prefix + ".")), (name, module)

    def test_the_package_never_mentions_parsed_data_or_stage_changes(self):
        for name, source in SOURCES.items():
            code = "\n".join(
                line for line in source.splitlines() if not line.lstrip().startswith(("#", '"""'))
            )
            tree = ast.parse(source)
            identifiers = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)} | {
                n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)
            }
            for banned in ("parsed_data", "change_stage", "reopen", "_move", "stage", "commit", "execute"):
                assert banned not in identifiers, (name, banned)
            assert "datetime.now" not in code and "date.today" not in code and "utcnow" not in code

    def test_the_clock_is_never_read_inside_the_package(self):
        for name, source in SOURCES.items():
            tree = ast.parse(source)
            for node in ast.walk(tree):
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                    assert node.func.attr not in {"now", "today", "utcnow"}, name

    def test_the_engine_has_no_hidden_state(self):
        """Calling it twice with different 'today' values changes only the experience context."""
        profile = profile_from_reviewed({"skills": ["Python"], "experience": [{"start": "2020-01", "current": True}]})
        req = JobRequirements(("Python",), ())
        a = compute_coverage(req, profile, today=date(2026, 1, 1))
        b = compute_coverage(req, profile, today=date(2027, 1, 1))
        assert a.total == b.total and a.experience.dated_months != b.experience.dated_months

    def test_no_stage_or_application_information_exists_in_a_result(self):
        result = compute_coverage(
            JobRequirements(("Python",), ()), profile_from_reviewed({"skills": ["Python"]}), today=date(2026, 1, 1)
        )
        blob = json.dumps(result.to_dict()).lower()
        for word in ("stage", "shortlist", "reject", "hire", "decision", "recommend", "rank"):
            assert word not in blob.replace("never changes an application's stage", "").replace(
                "reject, shortlist or hire anyone", ""
            ), word
