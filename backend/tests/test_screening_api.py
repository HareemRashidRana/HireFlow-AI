"""Requirements Coverage through the HTTP API: creation, idempotency, staleness, human control."""

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.models.application import Application, ApplicationEvent
from app.models.screening import ScreeningAssessment
from app.services.screening.methodology import SCORING_VERSION
from tests.resume_files import CV_LINES, make_pdf
from tests.screening_helpers import (
    SCREENING,
    assess,
    build,
    get_application,
    review_body,
)
from tests.test_jobs import JOBS
from tests.test_resumes import RESUMES, upload


class TestCreation:
    def test_a_reviewed_resume_gives_a_scored_assessment(self, client):
        s = build(client, required=["Python", "SQL", "Docker"], preferred=["React", "Redis"], skills=["python", "sql", "React"])
        res = assess(client, s)
        assert res.status_code == 201, res.text
        body = res.json()
        assert body["status"] == "scored" and body["assessment_number"] == 1
        # required 2/3 of 80 = 53.3, preferred 1/2 of 20 = 10.0
        assert body["total_score"] == 63.3 and body["assessed_weight"] == 100
        assert body["scoring_version"] == SCORING_VERSION and body["alias_table_version"] == "aliases-1"
        assert body["weights"] == {"required_skills": 80, "preferred_skills": 20}
        assert body["freshness"] == {"state": "current", "reasons": [], "reason_texts": []}
        assert body["requested_by"]["email"] == client.user.email
        assert body["resume"]["version_number"] == 1 and body["resume"]["still_exists"] is True

    def test_evidence_says_listed_or_not_listed_and_how(self, client):
        s = build(client, required=["JavaScript", "Docker"], preferred=[], skills=["JS"])
        body = assess(client, s).json()
        required = next(c for c in body["criteria"] if c["key"] == "required_skills")
        assert [(e["requirement"], e["status"], e["matched_via"]) for e in required["evidence"]] == [
            ("JavaScript", "listed", "alias"), ("Docker", "not listed", None)]
        assert body["unlisted_requirements"] == ["Docker"]
        assert "lacks" not in str(body).lower()

    def test_required_only_and_preferred_only(self, client):
        only_req = assess(client, build(client, 1, required=["Python", "Go"], preferred=[], skills=["python"])).json()
        assert only_req["total_score"] == 50.0 and only_req["assessed_weight"] == 80
        only_pref = assess(client, build(client, 2, required=[], preferred=["React", "Vue"], skills=["react"])).json()
        assert only_pref["total_score"] == 50.0 and only_pref["assessed_weight"] == 20

    def test_a_job_with_no_skills_is_an_unscored_assessment_not_an_error(self, client):
        body = assess(client, build(client, required=[], preferred=[])).json()
        assert body["status"] == "unscored" and body["total_score"] is None and body["assessed_weight"] == 0
        assert "No Requirements Coverage figure" in body["explanation"]

    def test_a_reviewed_resume_with_no_skills_is_unscored_never_zero(self, client):
        body = assess(client, build(client, skills=[])).json()
        assert body["status"] == "unscored" and body["total_score"] is None
        assert all(c["reason_code"] == "no_reviewed_skills" for c in body["criteria"])

    def test_experience_is_context_only(self, client):
        short = assess(client, build(client, 1, min_years=20, skills=["Python", "SQL"])).json()
        assert short["experience"]["note"].startswith("Dated experience is shown for context only")
        assert short["experience"]["dated_months"] > 0
        other = assess(client, build(client, 2, min_years=0, skills=["Python", "SQL"])).json()
        assert short["total_score"] == other["total_score"]  # years never affect the figure

    def test_the_methodology_snapshot_and_job_requirements_are_stored(self, client):
        body = assess(client, build(client, required=["Python"], preferred=["Go"])).json()
        assert body["job_requirements"] == {"required": ["Python"], "preferred": ["Go"]}
        assert body["limitations"] and body["warnings"] == []


class TestPreconditions:
    def test_no_resume(self, client):
        res = assess(client, build(client, resume="none"))
        assert res.status_code == 409 and "no active resume" in res.json()["detail"]

    def test_an_unreviewed_resume_is_never_used(self, client):
        s = build(client, resume="unreviewed")
        res = assess(client, s)
        assert res.status_code == 409 and "has not been reviewed" in res.json()["detail"]
        # and nothing was stored
        assert client.get(s.app_url).json()["total"] == 0

    def test_parsed_data_is_never_the_source(self, client, session_factory):
        """Even a resume whose PARSED data is rich cannot be assessed until a person reviews it."""
        s = build(client, resume="unreviewed", skills=["Python"])
        parsed = client.get(f"{RESUMES}/{s.resume_id}/parsed").json()["parsed"]
        assert parsed["skills"]["values"], "the parser did find skills"
        assert assess(client, s).status_code == 409

    def test_readiness_explains_the_blocker(self, client):
        none = client.get(build(client, 1, resume="none").app_url).json()
        assert none["readiness"] == {"can_assess": False, "blocker": "no_active_resume",
                                     "blocker_text": none["readiness"]["blocker_text"]}
        unreviewed = client.get(build(client, 2, resume="unreviewed").app_url).json()
        assert unreviewed["readiness"]["blocker"] == "resume_not_reviewed"
        ready = client.get(build(client, 3).app_url).json()
        assert ready["readiness"]["can_assess"] is True and ready["readiness"]["blocker"] is None

    def test_an_anonymized_candidate_cannot_be_assessed(self, client):
        s = build(client)
        client.post(f"/api/v1/candidates/{s.candidate['id']}/anonymize", json={"confirm": True})
        res = assess(client, s)
        assert res.status_code == 409 and "anonymized" in res.json()["detail"]

    def test_unknown_and_malformed_ids(self, client):
        assert client.post(f"/api/v1/applications/{uuid.uuid4()}/screening").status_code == 404
        assert client.get(f"/api/v1/applications/{uuid.uuid4()}/screening").status_code == 404
        assert client.get(f"{SCREENING}/{uuid.uuid4()}").status_code == 404
        assert client.post(f"{SCREENING}/{uuid.uuid4()}/reviews", json={"judgement": "agree"}).status_code == 404
        assert client.get(f"{JOBS}/{uuid.uuid4()}/screening").status_code == 404
        for bad in ("not-a-uuid", "123", "00000000-0000-0000-0000-00000000000g"):
            assert client.get(f"{SCREENING}/{bad}").status_code == 422
            assert client.post(f"/api/v1/applications/{bad}/screening").status_code == 422


class TestIdempotencyVersionsAndStaleness:
    def test_repeating_with_identical_inputs_returns_the_same_assessment(self, client, session_factory):
        s = build(client)
        first = assess(client, s)
        second = assess(client, s)
        assert first.status_code == 201 and second.status_code == 200
        assert second.json()["id"] == first.json()["id"] and second.json()["created"] is False
        with session_factory() as db:
            assert db.scalar(select(func.count()).select_from(ScreeningAssessment)) == 1

    def test_changed_job_requirements_make_it_outdated_and_never_rescore_silently(self, client):
        s = build(client, required=["Python"], preferred=[])
        original = assess(client, s).json()
        assert client.patch(f"{JOBS}/{s.job['id']}", json={"required_skills": ["Python", "Go"]}).status_code == 200
        shown = client.get(f"{SCREENING}/{original['id']}").json()
        assert shown["freshness"]["state"] == "outdated"
        assert shown["freshness"]["reasons"] == ["job_requirements_changed"]
        assert shown["total_score"] == original["total_score"] == 100.0  # the old result is untouched
        assert shown["job_requirements"]["required"] == ["Python"]
        assert client.get(s.app_url).json()["total"] == 1  # nothing was created by looking

    def test_an_explicit_new_assessment_is_a_new_version_and_history_is_kept(self, client):
        s = build(client, required=["Python"], preferred=[])
        first = assess(client, s).json()
        client.patch(f"{JOBS}/{s.job['id']}", json={"required_skills": ["Python", "Go"]})
        second = assess(client, s)
        assert second.status_code == 201 and second.json()["assessment_number"] == 2
        assert second.json()["total_score"] == 50.0 and second.json()["freshness"]["state"] == "current"  # 1 of 2
        listing = client.get(s.app_url).json()
        assert [i["assessment_number"] for i in listing["items"]] == [2, 1]  # newest first
        assert [i["freshness"] for i in listing["items"]] == ["current", "outdated"]
        assert client.get(f"{SCREENING}/{first['id']}").json()["total_score"] == 100.0

    def test_restoring_the_old_requirements_makes_the_old_assessment_current_again(self, client):
        s = build(client, required=["Python"], preferred=[])
        first = assess(client, s).json()
        client.patch(f"{JOBS}/{s.job['id']}", json={"required_skills": ["Python", "Go"]})
        client.patch(f"{JOBS}/{s.job['id']}", json={"required_skills": ["Python"]})
        assert client.get(f"{SCREENING}/{first['id']}").json()["freshness"]["state"] == "current"
        again = assess(client, s)
        assert again.status_code == 200 and again.json()["id"] == first["id"]

    def test_reviewing_the_resume_again_makes_it_outdated(self, client):
        s = build(client, required=["Python", "Docker"], preferred=[], skills=["Python"])
        first = assess(client, s).json()
        client.put(f"{RESUMES}/{s.resume_id}/review", json=review_body(["Python", "Docker"]))
        shown = client.get(f"{SCREENING}/{first['id']}").json()
        assert shown["freshness"]["state"] == "outdated" and "resume_reviewed_again" in shown["freshness"]["reasons"]
        new = assess(client, s).json()
        assert new["assessment_number"] == 2 and new["total_score"] == 100.0

    def test_a_new_active_resume_makes_it_outdated(self, client):
        s = build(client, required=["Python"], preferred=[])
        first = assess(client, s).json()
        second = upload(client, s.candidate["id"], data=make_pdf([*CV_LINES, "second resume"]))  # active
        shown = client.get(f"{SCREENING}/{first['id']}").json()
        # the new active resume is not reviewed yet, so there is nothing reviewed to compare with
        assert shown["freshness"]["state"] == "outdated" and shown["freshness"]["reasons"] == ["resume_unavailable"]
        assert client.get(s.app_url).json()["readiness"]["blocker"] == "resume_not_reviewed"
        assert assess(client, s).status_code == 409
        client.put(f"{RESUMES}/{second.json()['id']}/review", json=review_body(["Python"]))
        shown = client.get(f"{SCREENING}/{first['id']}").json()
        assert shown["freshness"]["reasons"] == ["resume_changed"]

    def test_a_methodology_change_is_reported(self, client, monkeypatch):
        s = build(client)
        original = assess(client, s).json()
        import app.services.screening_service as service

        with monkeypatch.context() as m:
            m.setattr(service.text, "SCORING_VERSION", "coverage-9.9")
            shown = client.get(f"{SCREENING}/{original['id']}").json()
        assert shown["freshness"]["state"] == "outdated" and "methodology_changed" in shown["freshness"]["reasons"]
        assert shown["scoring_version"] == SCORING_VERSION  # the original stays as it was

    def test_a_deleted_resume_scrubs_the_assessment(self, client):
        s = build(client)
        original = assess(client, s).json()
        assert client.delete(f"{RESUMES}/{s.resume_id}").status_code == 204
        shown = client.get(f"{SCREENING}/{original['id']}").json()
        assert shown["freshness"]["state"] == "scrubbed" and shown["scrubbed"] is True
        assert shown["scrub_reason"] == "resume_deleted" and shown["resume"]["still_exists"] is False
        assert shown["total_score"] == original["total_score"]  # numbers stay
        assert all(c["evidence"] is None for c in shown["criteria"]) and shown["experience"] is None

    def test_the_limit_per_application(self, client, monkeypatch):
        import app.services.screening_service as service

        s = build(client, required=["Python"], preferred=[])
        with monkeypatch.context() as m:
            m.setattr(service, "MAX_ASSESSMENTS_PER_APPLICATION", 1)
            assert assess(client, s).status_code == 201
            client.patch(f"{JOBS}/{s.job['id']}", json={"required_skills": ["Python", "Go"]})
            assert assess(client, s).status_code == 409


class TestHumanControl:
    def test_assessing_never_changes_the_stage_or_the_history(self, client, session_factory):
        s = build(client)
        before = get_application(client, s)
        with session_factory() as db:
            events_before = db.scalar(select(func.count()).select_from(ApplicationEvent))
        assess(client, s)
        assess(client, s)
        client.get(s.app_url)
        a = client.get(s.app_url).json()["items"][0]["id"]
        client.get(f"{SCREENING}/{a}")
        client.post(f"{SCREENING}/{a}/reviews", json={"judgement": "agree", "note": "looks fine"})
        after = get_application(client, s)
        assert after["stage"] == before["stage"] == "applied"
        assert after["events"] == before["events"] and after["updated_at"] == before["updated_at"]
        assert after["assigned_recruiter"] == before["assigned_recruiter"]
        with session_factory() as db:
            assert db.scalar(select(func.count()).select_from(ApplicationEvent)) == events_before
            assert db.scalar(select(func.count()).select_from(Application)) == 1

    @pytest.mark.parametrize("score_every_way", ["perfect", "zero", "unscored"])
    def test_no_figure_ever_moves_an_application(self, client, score_every_way):
        skills = {"perfect": ["Python", "SQL", "React"], "zero": ["Cobol"], "unscored": []}[score_every_way]
        s = build(client, skills=skills)
        assess(client, s)
        assert get_application(client, s)["stage"] == "applied"

    def test_a_job_overview_is_ordered_by_application_date_whatever_params_are_sent(self, client):
        good = build(client, 1, required=["Python"], preferred=[], skills=["Python"])
        bad = build(client, 2, required=["Python"], preferred=[], skills=["Cobol"])
        # two applicants for the SAME job, with opposite figures
        job = good.job
        other = build(client, 3, required=["Python"], preferred=[], skills=["Cobol"])
        from tests.test_applications import apply

        assert apply(client, other.candidate, job).status_code == 201
        assess(client, good)
        base = client.get(f"{JOBS}/{job['id']}/screening").json()
        applied = [i["applied_at"] for i in base["items"]]
        assert applied == sorted(applied, reverse=True)
        for params in ("sort=score", "sort_by=total_score&order=desc", "order_by=score", "min_score=50", "q=zzz", "score=desc"):
            again = client.get(f"{JOBS}/{job['id']}/screening?{params}").json()
            assert [i["application_id"] for i in again["items"]] == [i["application_id"] for i in base["items"]]
        assert bad.job["id"] != job["id"]

    def test_the_job_overview_carries_no_figure(self, client):
        s = build(client)
        assess(client, s)
        item = client.get(f"{JOBS}/{s.job['id']}/screening").json()["items"][0]
        assert item["state"] == "current" and item["assessment_count"] == 1
        assert not {"total_score", "score", "total", "rank", "points"} & set(item)

    def test_job_overview_states(self, client):
        from tests.test_applications import apply

        s = build(client, 1)
        job = s.job
        none_resume = build(client, 2, resume="none")
        unreviewed = build(client, 3, resume="unreviewed")
        for other in (none_resume, unreviewed):
            apply(client, other.candidate, job)
        assess(client, s)
        states = {i["candidate_name"]: (i["state"], i["blocker"]) for i in client.get(f"{JOBS}/{job['id']}/screening").json()["items"]}
        assert states[f"{s.candidate['first_name']} {s.candidate['last_name']}"] == ("current", None)
        assert states[f"{none_resume.candidate['first_name']} {none_resume.candidate['last_name']}"] == ("cannot_assess", "no_active_resume")
        assert states[f"{unreviewed.candidate['first_name']} {unreviewed.candidate['last_name']}"] == ("cannot_assess", "resume_not_reviewed")

    def test_job_overview_paging(self, client):
        from tests.test_applications import apply

        s = build(client, 1)
        for n in range(2, 6):
            apply(client, build(client, n, resume="none").candidate, s.job)
        page = client.get(f"{JOBS}/{s.job['id']}/screening?page_size=2&page=2").json()
        assert page["total"] == 5 and len(page["items"]) == 2 and page["page"] == 2
        assert client.get(f"{JOBS}/{s.job['id']}/screening?page_size=0").status_code == 422
        assert client.get(f"{JOBS}/{s.job['id']}/screening?page_size=101").status_code == 422

    def test_methodology_is_available_and_says_advisory(self, client):
        m = client.get(f"{SCREENING}/methodology").json()
        assert m["name"] == "Requirements Coverage" and m["weights"] == {"required_skills": 80, "preferred_skills": 20}
        assert "advisory" in m["summary"] and m["limitations"]

    def test_the_result_contains_no_recommendation_language(self, client):
        body = assess(client, build(client)).json()
        blob = str(body).lower()
        for word in ("recommend", "shortlist", "suitab", "quality", "rank", "top candidate", "best"):
            assert word not in blob.replace("never changes an application's stage, and it is not used to reject, shortlist or hire anyone.", "")

    def test_assessments_are_text_free_of_personal_details(self, client):
        s = build(client)
        blob = str(assess(client, s).json())
        for private in (s.candidate["email"], s.candidate["last_name"], "test.person@example.com", "Acme", "Engineer"):
            assert private not in blob


class TestDatabaseConstraints:
    """The database itself enforces the rules, whatever the application code does."""

    def rows(self, client, session_factory, **over):
        s = build(client)
        a = assess(client, s).json()
        with session_factory() as db:
            base = db.get(ScreeningAssessment, uuid.UUID(a["id"]))
            fields = dict(
                application_id=base.application_id, assessment_number=2, resume_id=base.resume_id,
                resume_reviewed_at=base.resume_reviewed_at, input_fingerprint="f" * 64,
                scoring_version="coverage-1.0", alias_table_version="aliases-1", weights={}, job_snapshot={},
                status=base.status, total_score=Decimal("50.0"), assessed_weight=100, criteria=[], warnings=[],
                explanation="x", limitations=[],
            )
            fields.update(over)
            return db, base, fields

    def insert(self, db, fields):
        db.add(ScreeningAssessment(**fields))
        db.flush()

    def test_the_same_inputs_for_the_same_review_cannot_be_stored_twice(self, client, session_factory):
        db, base, fields = self.rows(client, session_factory)
        with db, pytest.raises(IntegrityError):
            self.insert(db, {**fields, "input_fingerprint": base.input_fingerprint})

    def test_two_assessments_cannot_share_a_number(self, client, session_factory):
        db, base, fields = self.rows(client, session_factory)
        with db, pytest.raises(IntegrityError):
            self.insert(db, {**fields, "assessment_number": 1})

    @pytest.mark.parametrize(
        "over",
        [
            {"total_score": Decimal("100.1")}, {"total_score": Decimal("-0.1")}, {"assessed_weight": 50},
            {"assessed_weight": 0}, {"total_score": None},  # scored without a figure
            {"assessment_number": 0}, {"input_fingerprint": "short"},
            {"status": "unscored"},  # unscored must have no figure and weight 0
        ],
    )
    def test_the_check_constraints_refuse_impossible_rows(self, client, session_factory, over):
        db, _, fields = self.rows(client, session_factory)
        with db, pytest.raises(IntegrityError):
            self.insert(db, {**fields, **over})

    def test_an_unscored_row_with_no_figure_and_no_weight_is_fine(self, client, session_factory):
        db, _, fields = self.rows(client, session_factory)
        with db:
            self.insert(db, {**fields, "status": "unscored", "total_score": None, "assessed_weight": 0})
            db.rollback()

    def test_a_scrubbed_row_may_have_no_fingerprint(self, client, session_factory):
        db, _, fields = self.rows(client, session_factory)
        with db:
            self.insert(db, {**fields, "input_fingerprint": None})
            db.rollback()

    def test_deleting_an_application_row_cascades_in_the_database(self, client, session_factory):
        s = build(client)
        assess(client, s)
        with session_factory() as db:
            key = {"a": uuid.UUID(s.application["id"]).hex}
            db.execute(text("delete from application_events where application_id = :a"), key)
            db.execute(text("delete from applications where id = :a"), key)
            db.commit()
            assert db.scalar(select(func.count()).select_from(ScreeningAssessment)) == 0

    def test_deleting_a_resume_row_keeps_the_assessment_and_clears_the_link(self, client, session_factory):
        s = build(client)
        a = assess(client, s).json()
        with session_factory() as db:
            db.execute(text("delete from resumes where id = :r"), {"r": uuid.UUID(s.resume_id).hex})
            db.commit()
            row = db.get(ScreeningAssessment, uuid.UUID(a["id"]))
            assert row.resume_id is None and row.resume_version_number == 1 and row.total_score is not None

    def test_the_constraints_exist_in_the_schema(self, session_factory):
        with session_factory() as db:
            ddl = db.scalar(text("select sql from sqlite_master where name = 'screening_assessments'"))
        for fragment in ("score_range", "assessed_weight_valid", "status_matches_score", "uq_screening_assessments_number",
                         "uq_screening_assessments_identity"):
            assert fragment in ddl
