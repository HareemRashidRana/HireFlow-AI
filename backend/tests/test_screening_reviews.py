"""A person's judgement is stored beside the algorithm's result, never over it."""

import uuid

import pytest
from sqlalchemy import func, select

from app.models.screening import (
    AssessmentIsImmutable,
    ReviewIsAppendOnly,
    ScreeningAssessment,
    ScreeningReview,
)
from tests.screening_helpers import SCREENING, assess, build


@pytest.fixture
def made(client):
    s = build(client, required=["Python", "Docker", "Go"], preferred=["React"], skills=["Python", "React"])
    return s, assess(client, s).json()


def review(client, assessment, **body):
    return client.post(f"{SCREENING}/{assessment['id']}/reviews", json=body)


class TestRecordingAJudgement:
    @pytest.mark.parametrize("judgement", ["agree", "disagree", "unsure"])
    def test_each_judgement_is_stored_with_who_and_when(self, client, made, judgement):
        _, a = made
        res = review(client, a, judgement=judgement, note="  second pair of eyes  ")
        assert res.status_code == 201
        stored = res.json()["reviews"][0]
        assert stored["judgement"] == judgement and stored["note"] == "second pair of eyes"
        assert stored["reviewer"]["email"] == client.user.email and stored["scrubbed"] is False

    def test_the_original_result_is_exactly_the_same_afterwards(self, client, made):
        _, a = made
        res = review(client, a, judgement="disagree", adjustments=["Docker"], adjustment_reason="evidenced_elsewhere")
        after = res.json()
        for key in ("total_score", "assessed_weight", "criteria", "weights", "experience", "created_at",
                    "scoring_version", "assessment_number", "explanation", "job_requirements"):
            assert after[key] == a[key], key

    def test_an_adjustment_produces_a_separate_figure(self, client, made):
        _, a = made
        assert a["total_score"] == 46.7  # required 1/3 of 80 = 26.7, preferred 1/1 = 20
        res = review(client, a, judgement="agree", adjustments=["Docker"], adjustment_reason="equivalent_skill")
        r = res.json()["reviews"][0]
        # required 1/3 -> 2/3 of 80 = 53.3, preferred 1/1 = 20
        assert r["adjusted_total"] == 73.3 and r["adjustments"] == ["Docker"]
        assert res.json()["total_score"] == a["total_score"] == 46.7  # the original is untouched

    def test_the_adjusted_figure_can_never_exceed_100(self, client, made):
        _, a = made
        r = review(client, a, judgement="agree", adjustments=["Docker", "Go"], adjustment_reason="resume_incomplete")
        assert r.json()["reviews"][0]["adjusted_total"] == 100.0

    def test_many_reviews_accumulate_in_order(self, client, made):
        _, a = made
        for j in ("agree", "unsure", "disagree"):
            review(client, a, judgement=j)
        got = client.get(f"{SCREENING}/{a['id']}").json()["reviews"]
        assert [r["judgement"] for r in got] == ["agree", "unsure", "disagree"]

    def test_a_judgement_alone_needs_nothing_else(self, client, made):
        assert review(client, made[1], judgement="unsure").status_code == 201

    def test_unscored_assessments_can_be_judged_but_not_adjusted(self, client):
        a = assess(client, build(client, skills=[])).json()
        assert a["status"] == "unscored"
        assert review(client, a, judgement="unsure").status_code == 201
        res = review(client, a, judgement="agree", adjustments=["Python"], adjustment_reason="other")
        assert res.status_code == 422


class TestValidation:
    @pytest.mark.parametrize(
        "body",
        [
            {}, {"judgement": "maybe"}, {"judgement": "AGREE"}, {"judgement": ""}, {"judgement": None},
            {"judgement": "agree", "note": "x" * 1001},
            {"judgement": "agree", "adjustments": ["Docker"]},  # no reason
            {"judgement": "agree", "adjustment_reason": "other"},  # reason without adjustment
            {"judgement": "agree", "adjustments": ["Docker", "Docker"], "adjustment_reason": "other"},
            {"judgement": "agree", "adjustments": ["x" * 51], "adjustment_reason": "other"},
            {"judgement": "agree", "adjustments": [""], "adjustment_reason": "other"},
            {"judgement": "agree", "adjustments": ["a"] * 31, "adjustment_reason": "other"},
            {"judgement": "agree", "adjustment_reason": "because"},
            {"judgement": "agree", "total_score": 100},  # nobody can write a score
            {"judgement": "agree", "status": "scored"},
            {"judgement": "agree", "stage": "shortlisted"},  # nor a stage
            {"judgement": "agree", "reviewer_id": "00000000-0000-0000-0000-000000000000"},
        ],
    )
    def test_invalid_reviews_are_refused(self, client, made, body):
        res = review(client, made[1], **body)
        assert res.status_code == 422, body
        assert client.get(f"{SCREENING}/{made[1]['id']}").json()["reviews"] == []

    def test_a_note_of_exactly_1000_characters_is_accepted(self, client, made):
        assert review(client, made[1], judgement="agree", note="n" * 1000).status_code == 201

    def test_a_blank_note_is_stored_as_no_note(self, client, made):
        r = review(client, made[1], judgement="agree", note="   ").json()["reviews"][0]
        assert r["note"] is None

    def test_only_requirements_that_are_not_listed_can_be_adjusted(self, client, made):
        _, a = made
        for bad in (["Python"], ["Cobol"], ["docker "]):  # listed, unknown, wrong spelling
            res = review(client, a, judgement="agree", adjustments=bad, adjustment_reason="other")
            assert res.status_code == 422, bad
        assert client.get(f"{SCREENING}/{a['id']}").json()["reviews"] == []

    def test_a_hostile_note_is_returned_as_plain_text(self, client, made):
        note = "<script>alert(1)</script> =HYPERLINK(\"http://x\")"
        r = review(client, made[1], judgement="agree", note=note).json()["reviews"][0]
        assert r["note"] == note  # stored and returned verbatim; the UI renders it as text


class TestAppendOnlyAndImmutable:
    def test_there_is_no_way_to_edit_or_delete_a_review_over_http(self, client, made):
        _, a = made
        rid = review(client, a, judgement="agree").json()["reviews"][0]["id"]
        for method in ("put", "patch", "delete"):
            assert getattr(client, method)(f"{SCREENING}/{a['id']}/reviews/{rid}").status_code in (404, 405)

    def test_the_orm_refuses_to_update_or_delete_an_assessment(self, client, made, session_factory):
        _, a = made
        with session_factory() as db:
            row = db.get(ScreeningAssessment, uuid.UUID(a["id"]))
            row.total_score = 100
            with pytest.raises(AssessmentIsImmutable):
                db.flush()
            db.rollback()
            row = db.get(ScreeningAssessment, row.id)
            db.delete(row)
            with pytest.raises(AssessmentIsImmutable):
                db.flush()
            db.rollback()
        assert client.get(f"{SCREENING}/{a['id']}").json()["total_score"] == a["total_score"]

    def test_the_orm_refuses_to_update_or_delete_a_review(self, client, made, session_factory):
        _, a = made
        review(client, a, judgement="agree")
        with session_factory() as db:
            row = db.scalar(select(ScreeningReview))
            row.judgement = "disagree"
            with pytest.raises(ReviewIsAppendOnly):
                db.flush()
            db.rollback()
            db.delete(db.scalar(select(ScreeningReview)))
            with pytest.raises(ReviewIsAppendOnly):
                db.flush()
            db.rollback()
            assert db.scalar(select(func.count()).select_from(ScreeningReview)) == 1

    def test_reviews_never_change_stage_or_history(self, client, made):
        s, a = made
        before = client.get(f"/api/v1/applications/{s.application['id']}").json()
        review(client, a, judgement="disagree", note="not convinced")
        after = client.get(f"/api/v1/applications/{s.application['id']}").json()
        assert after["stage"] == "applied" and after["events"] == before["events"]
