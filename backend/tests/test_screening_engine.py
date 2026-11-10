"""Requirements Coverage arithmetic, missing-data behaviour, evidence wording, determinism."""

import copy
import json
import random
import re
from datetime import date
from decimal import Decimal

import pytest

from app.services.screening import (
    JobRequirements,
    ReviewedProfile,
    compute_coverage,
    input_fingerprint,
    methodology,
    profile_from_reviewed,
)
from app.services.screening.experience import Position
from app.services.screening.methodology import (
    EXPERIENCE_NOTE,
    HOW_IT_WORKS,
    LIMITATIONS,
    REASONS,
    SCORING_VERSION,
    SUMMARY,
    WARNINGS,
)

TODAY = date(2026, 11, 10)


def cover(required=(), preferred=(), skills=(), positions=()):
    return compute_coverage(
        JobRequirements(tuple(required), tuple(preferred)),
        ReviewedProfile(tuple(skills), tuple(positions)),
        today=TODAY,
    )


def criterion(result, key):
    return next(c for c in result.criteria if c.key == key)


class TestWeightsAndArithmetic:
    def test_both_groups_are_weighted_80_20(self):
        r = cover(["python", "sql"], ["redis", "docker"], ["python", "redis"])
        req, pref = criterion(r, "required_skills"), criterion(r, "preferred_skills")
        assert (req.effective_weight, pref.effective_weight) == (Decimal("80.0"), Decimal("20.0"))
        assert (req.points, pref.points) == (Decimal("40.0"), Decimal("10.0"))
        assert r.total == Decimal("50.0") and r.assessed_weight == 100

    def test_everything_listed_is_100_and_nothing_listed_is_0(self):
        assert cover(["a1", "b1"], ["c1"], ["a1", "b1", "c1"]).total == Decimal("100.0")
        assert cover(["a1", "b1"], ["c1"], ["zzz"]).total == Decimal("0.0")

    def test_required_only_carries_the_full_weight(self):
        r = cover(["python", "sql", "go", "rust"], [], ["python", "sql"])
        assert r.total == Decimal("50.0") and r.assessed_weight == 80
        assert criterion(r, "required_skills").effective_weight == Decimal("100.0")
        assert criterion(r, "preferred_skills").status == "not_assessed"
        assert criterion(r, "preferred_skills").points is None

    def test_preferred_only_carries_the_full_weight(self):
        r = cover([], ["python", "sql", "go", "rust"], ["python"])
        assert r.total == Decimal("25.0") and r.assessed_weight == 20
        assert criterion(r, "preferred_skills").effective_weight == Decimal("100.0")

    def test_a_group_with_nothing_listed_still_counts_when_assessable(self):
        r = cover(["a1"], ["b1"], ["a1"])  # preferred assessable, none listed: 0 of 20, not dropped
        assert r.total == Decimal("80.0")

    @pytest.mark.parametrize(
        "listed,total,expected",
        [(0, 4, "0.0"), (1, 4, "25.0"), (2, 4, "50.0"), (3, 4, "75.0"), (4, 4, "100.0"),
         (1, 3, "33.3"), (2, 3, "66.7"), (1, 7, "14.3"), (3, 7, "42.9"), (1, 16, "6.3"),
         (1, 8, "12.5"), (5, 16, "31.3")],
    )
    def test_single_group_percentages_and_rounding(self, listed, total, expected):
        skills = [f"skill{i}" for i in range(total)]
        # the resume always lists at least one (unrelated) skill, so "none matched" is a real 0.0
        r = cover(skills, [], [*skills[:listed], "unrelated"], [])
        assert r.total == Decimal(expected)

    def test_rounding_is_half_up_not_banker(self):
        # 1/16 of 100 is exactly 6.25: half-up gives 6.3, banker's rounding would give 6.2.
        skills = [f"s{i}" for i in range(16)]
        assert cover(skills, [], skills[:1]).total == Decimal("6.3")
        # 3/16 = 18.75 -> 18.8 (half-up), banker's would give 18.8 too; 5/16 = 31.25 -> 31.3
        assert cover(skills, [], skills[:5]).total == Decimal("31.3")

    def test_weights_of_assessed_groups_always_sum_to_100(self):
        for required in ([], ["a1"]):
            for preferred in ([], ["b1"]):
                for skills in ([], ["a1"]):
                    r = cover(required, preferred, skills)
                    weights = [c.effective_weight for c in r.criteria if c.effective_weight]
                    if r.status == "scored":
                        assert sum(weights) == Decimal("100.0")

    def test_total_never_leaves_0_to_100(self):
        rng = random.Random(7)
        pool = [f"skill{i}" for i in range(40)]
        for _ in range(400):
            req = rng.sample(pool, rng.randint(0, 12))
            pref = rng.sample(pool, rng.randint(0, 12))
            have = rng.sample(pool, rng.randint(0, 30))
            r = cover(req, pref, have)
            if r.total is not None:
                assert Decimal(0) <= r.total <= Decimal(100)
                parts = sum(c.points for c in r.criteria if c.points is not None)
                assert abs(parts - r.total) <= Decimal("0.1")  # per-group display rounding only

    def test_the_worked_example_from_the_proposal(self):
        r = cover(
            ["Python", "SQL", "Docker", "Kubernetes"], ["PostgreSQL", "Redis"],
            ["python", "sql", "Postgres", "docker"],
        )
        assert r.total == Decimal("70.0")
        assert criterion(r, "required_skills").points == Decimal("60.0")
        assert criterion(r, "preferred_skills").points == Decimal("10.0")


class TestMissingData:
    def test_empty_reviewed_skills_means_not_assessed_never_zero(self):
        r = cover(["python"], ["sql"], [])
        assert r.status == "unscored" and r.total is None and r.assessed_weight == 0
        for c in r.criteria:
            assert c.status == "not_assessed" and c.reason_code == "no_reviewed_skills"
            assert c.points is None
        assert "says nothing about the candidate" in r.explanation

    def test_a_job_with_no_skills_cannot_be_scored(self):
        r = cover([], [], ["python"])
        assert r.status == "unscored" and r.total is None
        assert all(c.reason_code == "job_lists_none" for c in r.criteria)
        assert "No Requirements Coverage figure was calculated" in r.explanation

    def test_nothing_on_either_side_is_unscored(self):
        r = cover([], [], [])
        assert r.status == "unscored" and r.total is None

    def test_unusable_entries_do_not_count_as_skills(self):
        r = cover(["python", "", "   ", "++"], [], ["python", "", None, 5])  # type: ignore[list-item]
        assert criterion(r, "required_skills").total == 1
        assert r.total == Decimal("100.0")
        assert "ignored_skill_entries" in r.warnings

    def test_a_resume_of_only_junk_is_the_same_as_no_skills(self):
        r = cover(["python"], [], ["", " ", "..."])
        assert r.status == "unscored"

    def test_unscored_result_still_carries_experience_context_and_limitations(self):
        r = cover([], [], [], [Position("2020", "2021")])
        assert r.experience.positions_counted == 1
        assert r.limitations == LIMITATIONS


class TestDuplicatesAndOverlap:
    def test_duplicate_requirements_count_once(self):
        r = cover(["JS", "JavaScript", "javascript"], [], ["javascript"])
        assert criterion(r, "required_skills").total == 1 and r.total == Decimal("100.0")

    def test_duplicate_resume_skills_do_not_inflate(self):
        r = cover(["python", "sql"], [], ["python", "Python", "PYTHON", "py"])
        assert r.total == Decimal("50.0")

    def test_a_skill_in_both_lists_is_counted_once_as_required(self):
        r = cover(["python", "sql"], ["Python", "redis"], ["python", "redis"])
        assert criterion(r, "required_skills").total == 2
        assert criterion(r, "preferred_skills").total == 1
        assert "preferred_also_required" in r.warnings
        assert r.total == Decimal("50.0") * Decimal("0.8") + Decimal("20.0")  # 40 + 20

    def test_if_everything_preferred_is_also_required_preferred_is_not_assessed(self):
        r = cover(["python"], ["PYTHON"], ["python"])
        assert criterion(r, "preferred_skills").reason_code == "job_lists_none"
        assert r.total == Decimal("100.0") and r.assessed_weight == 80

    def test_list_caps_are_applied_and_reported(self):
        many = [f"skill{i}" for i in range(80)]
        r = cover(many, [], many)
        assert criterion(r, "required_skills").total == 50
        assert "job_skills_truncated" in r.warnings
        r2 = cover(["skill199", "skill220"], [], [f"skill{i}" for i in range(250)])
        assert "skills_truncated" in r2.warnings
        assert criterion(r2, "required_skills").listed == 1  # skill199 is inside the cap, skill220 is not


class TestMatchingBehaviour:
    def test_java_never_satisfies_javascript_or_the_reverse(self):
        assert cover(["JavaScript"], [], ["Java"]).total == Decimal("0.0")
        assert cover(["Java"], [], ["JavaScript"]).total == Decimal("0.0")
        assert cover(["Java"], [], ["JS"]).total == Decimal("0.0")
        assert cover(["JavaScript"], [], ["JS"]).total == Decimal("100.0")

    def test_c_family_is_three_separate_requirements(self):
        for wanted, have in (("C", "C++"), ("C", "C#"), ("C++", "C#"), ("C#", "C"), ("C++", "C")):
            assert cover([wanted], [], [have]).total == Decimal("0.0"), (wanted, have)
        assert cover(["C++"], [], ["cpp"]).total == Decimal("100.0")
        assert cover(["C#"], [], ["C Sharp"]).total == Decimal("100.0")
        assert cover(["C"], [], ["c"]).total == Decimal("100.0")

    def test_dotnet_is_matched_only_by_dotnet_names(self):
        assert cover([".NET"], [], ["dotnet"]).total == Decimal("100.0")
        assert cover([".NET"], [], [".NET"]).total == Decimal("100.0")
        assert cover([".NET"], [], ["Net"]).total == Decimal("0.0")
        assert cover([".NET"], [], ["ASP.NET"]).total == Decimal("0.0")

    def test_postgres_and_postgresql_match_but_sql_does_not(self):
        assert cover(["PostgreSQL"], [], ["Postgres"]).total == Decimal("100.0")
        assert cover(["Postgres"], [], ["PostgreSQL"]).total == Decimal("100.0")
        assert cover(["SQL"], [], ["PostgreSQL"]).total == Decimal("0.0")
        assert cover(["PostgreSQL"], [], ["SQL"]).total == Decimal("0.0")

    def test_no_substring_or_prefix_matching(self):
        assert cover(["Java"], [], ["Javanese Studies"]).total == Decimal("0.0")
        assert cover(["React"], [], ["React Native"]).total == Decimal("0.0")
        assert cover(["Go"], [], ["Google Analytics", "Django"]).total == Decimal("0.0")
        assert cover(["Excel"], [], ["Microsoft Excel"]).total == Decimal("0.0")

    def test_case_spacing_and_decoration_are_ignored(self):
        assert cover(["Machine Learning"], [], ["  machine   learning. "]).total == Decimal("100.0")
        assert cover(["python"], [], ["• Python"]).total == Decimal("100.0")

    def test_matching_is_symmetric_for_aliases(self):
        assert cover(["k8s"], [], ["Kubernetes"]).total == Decimal("100.0")
        assert cover(["Kubernetes"], [], ["K8s"]).total == Decimal("100.0")


class TestEvidenceAndWording:
    def test_each_requirement_is_labelled_listed_or_not_listed(self):
        r = cover(["Python", "Rust"], [], ["python"])
        evidence = criterion(r, "required_skills").evidence
        assert [(e.requirement, e.status) for e in evidence] == [("Python", "listed"), ("Rust", "not listed")]
        assert evidence[0].matched_text == "python" and evidence[0].matched_via == "exact"
        assert evidence[1].matched_text is None and evidence[1].matched_via is None

    def test_alias_matches_say_so_in_either_direction(self):
        r = cover(["JavaScript", "Postgres"], [], ["js", "PostgreSQL"])
        assert [(e.matched_via, e.matched_text) for e in criterion(r, "required_skills").evidence] == [
            ("alias", "js"), ("alias", "PostgreSQL")]

    def test_evidence_keeps_the_jobs_own_spelling_and_order(self):
        r = cover(["Zeta", "Alpha", "Mid"], [], ["alpha"])
        assert [e.requirement for e in criterion(r, "required_skills").evidence] == ["Zeta", "Alpha", "Mid"]

    def test_a_missing_skill_is_never_described_as_a_lack(self):
        r = cover(["Rust"], ["Go"], ["python"])
        blob = json.dumps(r.to_dict()).lower()
        assert "not listed" in blob
        for word in ("lacks", "lacking", "does not have", "doesn't have", "missing skill", "unqualified"):
            assert word not in blob

    def test_the_result_names_its_versions_and_carries_the_limitations(self):
        r = cover(["python"], [], ["python"])
        assert r.scoring_version == SCORING_VERSION and r.alias_table_version.startswith("aliases-")
        assert r.limitations == LIMITATIONS and len(r.limitations) >= 4
        assert "advisory" in r.explanation


FORBIDDEN_WORDING = re.compile(
    r"suitab|quality|match score|recommend|\brank|\bbest\b|\btop candidate|unqualified|\bworth\b|"
    r"\bability\b|talent|\bgood candidate|\bpoor\b|\bweak\b|\bstrong\b|\blacks?\b|\blacking\b|"
    r"\bfit\b|\bculture",
    re.I,
)


class TestTerminologyAndTone:
    def test_all_user_facing_text_avoids_evaluative_language(self):
        strings = [SUMMARY, EXPERIENCE_NOTE, *HOW_IT_WORKS, *LIMITATIONS, *REASONS.values(), *WARNINGS.values()]
        strings += json.dumps(methodology()).split('"')
        for s in strings:
            assert not FORBIDDEN_WORDING.search(s), s

    def test_generated_explanations_avoid_evaluative_language(self):
        for r in (cover(["a1"], ["b1"], ["a1"]), cover(["a1"], [], []), cover([], [], ["a1"])):
            assert not FORBIDDEN_WORDING.search(r.explanation)
            assert not FORBIDDEN_WORDING.search(json.dumps(r.to_dict()))

    def test_the_product_term_is_requirements_coverage(self):
        m = methodology()
        assert m["name"] == "Requirements Coverage"
        assert "Requirements Coverage" in SUMMARY and "advisory" in SUMMARY

    def test_the_methodology_states_the_weights_and_what_is_not_used(self):
        m = methodology()
        assert m["weights"] == {"required_skills": 80, "preferred_skills": 20}
        assert any("experience" in line.lower() for line in m["how_it_works"])
        joined = " ".join(m["not_used"]).lower()
        for item in ("name", "education", "titles", "gaps"):
            assert item in joined
        assert m["scoring_version"] == SCORING_VERSION


class TestDeterminismAndFairnessInvariance:
    REQ = ["Python", "SQL", "Docker", "Kubernetes"]
    PREF = ["PostgreSQL", "Redis"]
    SKILLS = ["python", "sql", "Postgres", "docker"]

    def test_same_input_same_output_every_time(self):
        outputs = {json.dumps(cover(self.REQ, self.PREF, self.SKILLS).to_dict(), sort_keys=True) for _ in range(25)}
        assert len(outputs) == 1

    def test_the_order_of_resume_skills_does_not_matter(self):
        base = cover(self.REQ, self.PREF, self.SKILLS)
        rng = random.Random(3)
        for _ in range(20):
            shuffled = self.SKILLS[:]
            rng.shuffle(shuffled)
            assert cover(self.REQ, self.PREF, shuffled).total == base.total

    def test_the_order_of_job_requirements_does_not_change_the_figure(self):
        base = cover(self.REQ, self.PREF, self.SKILLS).total
        assert cover(self.REQ[::-1], self.PREF[::-1], self.SKILLS).total == base

    def test_personal_details_cannot_change_the_figure(self):
        """Names, contact details, education, titles and companies never reach the engine."""
        reviewed = {
            "name": "Ayesha Khan", "email": "a@example.com", "phone": "+92 300 1111111",
            "skills": self.SKILLS,
            "education": [{"institution": "Famous University", "degree": "PhD", "field": "CS",
                           "start_year": 2010, "end_year": 2014}],
            "experience": [{"title": "CEO", "company": "Big Corp", "start": "2015", "end": "2020",
                            "current": False}],
        }
        variants = []
        for name, email, phone, inst, degree, title, company in (
            ("Bilal Ahmed", "b@example.net", None, "Unknown College", "Diploma", "Intern", "Tiny Ltd"),
            ("", None, "000", None, None, None, None),
            ("Zoë Müller-Åberg", "z@example.org", "+49 1", "X", "Y", "Z", "W"),
        ):
            v = copy.deepcopy(reviewed)
            v.update(name=name, email=email, phone=phone)
            v["education"][0].update(institution=inst, degree=degree)
            v["experience"][0].update(title=title, company=company)
            variants.append(v)
        req = JobRequirements(tuple(self.REQ), tuple(self.PREF))
        base_profile = profile_from_reviewed(reviewed)
        base = compute_coverage(req, base_profile, today=TODAY)
        for v in variants:
            profile = profile_from_reviewed(v)
            assert compute_coverage(req, profile, today=TODAY).to_dict() == base.to_dict()
            assert input_fingerprint(req, profile) == input_fingerprint(req, base_profile)

    def test_experience_never_changes_the_figure(self):
        base = cover(self.REQ, self.PREF, self.SKILLS).total
        for positions in (
            [], [Position("1990", "2026")], [Position(None, None)], [Position("2026-01", None, True)],
            [Position("2000", "2001")] * 30, [Position("garbage", "nonsense")],
        ):
            assert cover(self.REQ, self.PREF, self.SKILLS, positions).total == base

    def test_career_gaps_and_undated_positions_are_not_penalised(self):
        dense = [Position("2010", "2015"), Position("2015-02", "2026-10")]
        gappy = [Position("2010", "2011"), Position("2024", "2025")]
        undated = [Position(None, None)] * 3
        totals = {cover(self.REQ, self.PREF, self.SKILLS, p).total for p in (dense, gappy, undated)}
        assert len(totals) == 1


class TestFingerprint:
    REQ = JobRequirements(("Python", "SQL"), ("Redis",))

    def fp(self, skills, req=None, positions=()):
        return input_fingerprint(req or self.REQ, ReviewedProfile(tuple(skills), tuple(positions)))

    def test_stable_and_hex(self):
        assert re.fullmatch(r"[0-9a-f]{64}", self.fp(["python"]))
        assert self.fp(["python"]) == self.fp(["python"])

    def test_insensitive_to_order_case_aliases_and_duplicates(self):
        assert self.fp(["python", "js"]) == self.fp(["JavaScript", "PYTHON", "python", "js"])

    def test_changes_when_the_skills_that_matter_change(self):
        assert self.fp(["python"]) != self.fp(["python", "sql"])

    def test_changes_when_the_job_requirements_change(self):
        other = JobRequirements(("Python", "SQL", "Go"), ("Redis",))
        assert self.fp(["python"]) != self.fp(["python"], other)
        swapped = JobRequirements(("Python",), ("SQL", "Redis"))
        assert self.fp(["python"]) != self.fp(["python"], swapped)

    def test_ignores_experience_because_experience_is_not_scored(self):
        assert self.fp(["python"]) == self.fp(["python"], positions=[Position("2020", "2021")])

    def test_contains_no_skill_text(self):
        digest = self.fp(["secretskill"], JobRequirements(("secretskill",), ()))
        assert "secretskill" not in digest


class TestResultSerialisation:
    def test_to_dict_is_plain_json(self):
        r = cover(["python"], ["sql"], ["python"], [Position("2020", "2022")])
        d = r.to_dict()
        json.dumps(d)  # no Decimals or dataclasses left
        assert d["status"] == "scored" and d["total"] == 80.0  # required 1/1 (80) + preferred 0/1
        assert d["experience"]["dated_months"] == 25 and d["criteria"][0]["key"] == "required_skills"

    def test_unscored_total_is_null(self):
        assert cover([], [], []).to_dict()["total"] is None
