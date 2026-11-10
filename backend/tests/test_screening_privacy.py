"""Audit metadata, anonymization, resume deletion, export, and failure handling for Requirements
Coverage. The rule being proved: nothing resume-derived or personal survives where it should not."""

import json
import uuid

import pytest
from sqlalchemy import func, select, text

from app.core.exceptions import ConflictError
from app.models.audit import AuditEventType, CandidateAuditEvent
from app.models.screening import ScreeningAssessment, ScreeningReview
from app.models.user import User
from app.services import audit
from app.services import screening_service as service
from tests.resume_files import CV_LINES, make_pdf
from tests.screening_helpers import SCREENING, assess, build, review_body
from tests.test_candidates import CANDIDATES
from tests.test_resumes import RESUMES, stored_files, upload

PRIVACY = "/api/v1/privacy"


def events(session_factory, event_type=None):
    with session_factory() as db:
        stmt = select(CandidateAuditEvent).order_by(CandidateAuditEvent.created_at)
        if event_type:
            stmt = stmt.where(CandidateAuditEvent.event_type == event_type)
        return [(e.event_type.value, dict(e.event_metadata), e.candidate_id, e.actor_id) for e in db.scalars(stmt)]


@pytest.fixture
def full(client):
    """A candidate with a reviewed resume, an assessment and a review that carries a note."""
    s = build(client, required=["Python", "Docker"], preferred=["React"], skills=["python3", "React"])
    a = assess(client, s).json()
    client.post(
        f"{SCREENING}/{a['id']}/reviews",
        json={"judgement": "disagree", "adjustments": ["Docker"], "adjustment_reason": "evidenced_elsewhere",
              "note": "She mentioned Docker in the interview, phone 0300-1234567"},
    )
    return s, a


class TestAudit:
    def test_each_action_is_recorded_with_safe_metadata(self, client, full, session_factory):
        s, a = full
        client.get(f"{SCREENING}/{a['id']}")
        kinds = [e[0] for e in events(session_factory) if e[0].startswith("screening_")]
        assert kinds == ["screening_created", "screening_reviewed", "screening_viewed"]
        created = events(session_factory, AuditEventType.SCREENING_CREATED)[0]
        assert created[1] == {
            "assessment_id": a["id"], "application_id": s.application["id"], "assessment_number": 1,
            "scoring_version": "coverage-1.0", "alias_table_version": "aliases-1", "status": "scored",
            "total_score": 60.0, "assessed_weight": 100, "resume_version": 1,
            "required_listed": 1, "required_total": 2, "preferred_listed": 1, "preferred_total": 1,
        }
        assert created[2] == uuid.UUID(s.candidate["id"]) and created[3] == client.user.id

    def test_the_review_event_has_a_flag_for_a_note_never_the_note(self, client, full, session_factory):
        meta = events(session_factory, AuditEventType.SCREENING_REVIEWED)[0][1]
        assert meta["has_note"] is True and meta["judgement"] == "disagree"
        assert meta["adjustment_count"] == 1 and meta["adjustment_reason"] == "evidenced_elsewhere"
        assert "interview" not in json.dumps(meta) and "0300" not in json.dumps(meta)

    def test_no_audit_row_ever_holds_personal_or_resume_derived_text(self, client, full, session_factory):
        s, a = full
        client.get(f"{SCREENING}/{a['id']}")
        blob = json.dumps([e[1] for e in events(session_factory)], default=str)
        for private in (s.candidate["email"], s.candidate["last_name"], "Docker", "Python", "React", "python3",
                        "Acme", "Engineer", "interview"):
            assert private not in blob, private  # a reason CODE like "evidenced_elsewhere" is allowed

    def test_an_identical_repeat_creates_no_second_audit_event(self, client, full, session_factory):
        s, _ = full
        assess(client, s)
        assert len(events(session_factory, AuditEventType.SCREENING_CREATED)) == 1

    def test_listing_is_not_a_view_but_opening_the_detail_is(self, client, full, session_factory):
        s, a = full
        client.get(s.app_url)
        assert events(session_factory, AuditEventType.SCREENING_VIEWED) == []
        client.get(f"{SCREENING}/{a['id']}")
        assert len(events(session_factory, AuditEventType.SCREENING_VIEWED)) == 1

    def test_the_candidate_audit_trail_shows_the_new_events_to_hr(self, client, full):
        s, a = full
        res = client.get(f"{PRIVACY}/audit", params={"candidate_id": s.candidate["id"], "page_size": 50})
        assert res.status_code == 200
        kinds = {e["event_type"] for e in res.json()["items"]}
        assert {"screening_created", "screening_reviewed"} <= kinds
        only = client.get(f"{PRIVACY}/audit", params={"event_type": "screening_created"}).json()
        assert only["total"] == 1

    @pytest.mark.parametrize(
        "key",
        ["evidence", "skills", "criteria", "requirement", "adjustments", "reviewer_note", "snapshot",
         "job_snapshot", "experience", "matched_text", "explanation", "warnings", "note", "name", "email"],
    )
    def test_the_audit_writer_refuses_these_keys(self, key):
        with pytest.raises(ValueError):
            audit.clean_metadata({key: "x"})
        with pytest.raises(ValueError):
            audit.clean_metadata({key.upper(): "x"})

    def test_nested_values_cannot_smuggle_content_in(self):
        with pytest.raises(ValueError):
            audit.clean_metadata({"counts": {"evidence": ["Docker"]}})
        with pytest.raises(ValueError):
            audit.clean_metadata({"counts": [{"skills": "x"}]})
        with pytest.raises(ValueError):
            audit.clean_metadata({"ok": "x" * 101})  # long free text is refused outright
        assert audit.clean_metadata({"assessments": 2, "reviews": 1, "reason": "anonymized"})


class TestAnonymization:
    def anonymize(self, client, s):
        return client.post(f"{CANDIDATES}/{s.candidate['id']}/anonymize", json={"confirm": True})

    def test_the_preview_counts_what_will_be_scrubbed(self, client, full):
        s, _ = full
        pre = client.get(f"{CANDIDATES}/{s.candidate['id']}/anonymization-preview").json()
        assert pre["assessments_scrubbed"] == 1 and pre["resumes_removed"] == 1

    def test_evidence_adjustments_and_notes_are_removed_but_numbers_stay(self, client, full, session_factory):
        s, a = full
        assert self.anonymize(client, s).status_code == 200
        shown = client.get(f"{SCREENING}/{a['id']}").json()
        assert shown["scrubbed"] is True and shown["scrub_reason"] == "anonymized"
        assert shown["freshness"]["state"] == "scrubbed"
        assert shown["total_score"] == a["total_score"] and shown["assessed_weight"] == 100
        assert shown["scoring_version"] == "coverage-1.0" and shown["assessment_number"] == 1
        for c in shown["criteria"]:
            assert c["evidence"] is None and c["listed"] in (0, 1, 2) and c["points"] is not None
        assert shown["experience"] is None and shown["unlisted_requirements"] == []
        review = shown["reviews"][0]
        assert review["scrubbed"] is True and review["note"] is None and review["adjustments"] is None
        assert review["judgement"] == "disagree" and review["adjusted_total"] is None

    def test_no_personal_or_resume_derived_text_survives_in_any_row(self, client, full, session_factory):
        s, a = full
        self.anonymize(client, s)
        with session_factory() as db:
            rows = [
                json.dumps(
                    [dict(r._mapping) for r in db.execute(text(f"select * from {table}"))], default=str
                )
                for table in ("screening_assessments", "screening_reviews", "candidate_audit_events")
            ]
        blob = "\n".join(rows)
        for private in (s.candidate["email"], s.candidate["last_name"], "matched_text", "interview",
                        "0300-1234567", "evidence\": [", "Test Person", "test.person@example.com", "Acme", "Engineer"):
            assert private not in blob, private
        # the resume's own spelling ("python3") and every per-skill verdict are gone as well
        assert "python3" not in blob and '"status": "listed"' not in rows[0] and '"status": "not listed"' not in rows[0]

    def test_the_fingerprint_hash_is_removed_too(self, client, full, session_factory):
        s, _ = full
        self.anonymize(client, s)
        with session_factory() as db:
            row = db.scalar(select(ScreeningAssessment))
        assert row.input_fingerprint is None and row.scrubbed_at is not None

    def test_a_safe_audit_event_records_the_scrub(self, client, full, session_factory):
        s, _ = full
        self.anonymize(client, s)
        scrub = events(session_factory, AuditEventType.SCREENING_SCRUBBED)
        assert len(scrub) == 1 and scrub[0][1] == {"assessments": 1, "reviews": 1, "reason": "anonymized"}
        assert scrub[0][2] == uuid.UUID(s.candidate["id"])

    def test_anonymizing_twice_scrubs_and_logs_once(self, client, full, session_factory):
        s, _ = full
        self.anonymize(client, s)
        self.anonymize(client, s)
        assert len(events(session_factory, AuditEventType.SCREENING_SCRUBBED)) == 1

    def test_a_scrubbed_assessment_cannot_be_reviewed(self, client, full):
        s, a = full
        self.anonymize(client, s)
        res = client.post(f"{SCREENING}/{a['id']}/reviews", json={"judgement": "agree"})
        assert res.status_code == 409 and "removed" in res.json()["detail"]

    def test_other_candidates_are_untouched(self, client, full):
        s, _ = full
        other = build(client, 2)
        keep = assess(client, other).json()
        self.anonymize(client, s)
        shown = client.get(f"{SCREENING}/{keep['id']}").json()
        assert shown["scrubbed"] is False and shown["criteria"][0]["evidence"] is not None

    def test_the_stage_and_history_survive_anonymization(self, client, full):
        s, _ = full
        before = client.get(f"/api/v1/applications/{s.application['id']}").json()
        self.anonymize(client, s)
        after = client.get(f"/api/v1/applications/{s.application['id']}").json()
        assert after["stage"] == before["stage"] and len(after["events"]) == len(before["events"])

    def test_a_candidate_without_assessments_logs_no_scrub(self, client, session_factory):
        s = build(client, resume="none")
        self.anonymize(client, s)
        assert events(session_factory, AuditEventType.SCREENING_SCRUBBED) == []


class TestResumeLifecycle:
    def test_deleting_the_resume_scrubs_only_assessments_built_from_it(self, client, session_factory):
        s = build(client, required=["Python"], preferred=[])
        first = assess(client, s).json()
        second_resume = upload(client, s.candidate["id"], data=make_pdf([*CV_LINES, "another"])).json()["id"]
        client.put(f"{RESUMES}/{second_resume}/review", json=review_body(["Python", "Go"]))
        second = assess(client, s).json()
        assert client.delete(f"{RESUMES}/{s.resume_id}").status_code == 204
        one, two = (client.get(f"{SCREENING}/{x['id']}").json() for x in (first, second))
        assert one["scrubbed"] is True and one["scrub_reason"] == "resume_deleted"
        assert two["scrubbed"] is False and two["criteria"][0]["evidence"] is not None
        scrub = events(session_factory, AuditEventType.SCREENING_SCRUBBED)
        assert scrub[0][1] == {"assessments": 1, "reviews": 0, "reason": "resume_deleted"}

    def test_replacing_a_resume_does_not_scrub_but_makes_assessments_outdated(self, client):
        s = build(client, required=["Python"], preferred=[])
        a = assess(client, s).json()
        upload(client, s.candidate["id"], data=make_pdf([*CV_LINES, "replacement"]))
        shown = client.get(f"{SCREENING}/{a['id']}").json()
        assert shown["scrubbed"] is False and shown["freshness"]["state"] == "outdated"
        assert shown["criteria"][0]["evidence"] is not None

    def test_the_deleted_resume_row_and_file_are_gone(self, client):
        s = build(client)
        assess(client, s)
        client.delete(f"{RESUMES}/{s.resume_id}")
        assert stored_files() == []

    def test_purge_never_removes_a_candidate_who_has_assessments(self, client, session_factory):
        s = build(client)
        assess(client, s)
        with session_factory() as db:
            db.execute(text("update candidates set retain_until = '2000-01-01'"))
            db.commit()
        res = client.post(f"{PRIVACY}/purge", json={"dry_run": True})
        assert res.status_code == 200 and s.candidate["id"] not in res.json()["candidate_ids"]
        assert client.get(f"{SCREENING}/{client.get(s.app_url).json()['items'][0]['id']}").status_code == 200

    def test_a_candidate_with_applications_cannot_be_hard_deleted(self, client):
        s = build(client)
        assess(client, s)
        assert client.delete(f"{CANDIDATES}/{s.candidate['id']}").status_code == 409


class TestExport:
    def export_json(self, client, s):
        res = client.post(f"{CANDIDATES}/{s.candidate['id']}/export", json={"format": "json"})
        assert res.status_code == 200
        return res.text, res.json()

    def test_json_export_has_assessment_metadata_and_nothing_resume_derived(self, client, full):
        s, a = full
        raw, data = self.export_json(client, s)
        app = data["candidates"][0]["applications"][0]
        assert app["requirements_coverage_assessments"] == [
            {"assessment_number": 1, "assessed_at": app["requirements_coverage_assessments"][0]["assessed_at"],
             "scoring_version": "coverage-1.0", "alias_table_version": "aliases-1", "status": "scored",
             "requirements_coverage": 60.0, "assessed_weight": 100, "resume_version": 1,
             "scrubbed": False, "reviews": {"disagree": 1}}
        ]
        for private in ("Docker", "evidence", "interview", "0300", "adjust", "job_snapshot", "matched_text",
                        "criteria", "Test Person", "test.person@example.com", "python3"):
            assert private not in raw, private

    def test_export_after_anonymization_marks_it_scrubbed(self, client, full):
        s, _ = full
        client.post(f"{CANDIDATES}/{s.candidate['id']}/anonymize", json={"confirm": True})
        _, data = self.export_json(client, s)
        entry = data["candidates"][0]["applications"][0]["requirements_coverage_assessments"][0]
        assert entry["scrubbed"] is True and entry["requirements_coverage"] == 60.0

    def test_csv_export_is_unchanged_and_has_no_assessment_data(self, client, full):
        s, _ = full
        res = client.post(f"{CANDIDATES}/{s.candidate['id']}/export", json={"format": "csv"})
        assert res.status_code == 200
        text_out = res.text
        for word in ("coverage", "Coverage", "screening", "assessment", "evidence", "Docker"):
            assert word not in text_out

    def test_csv_still_neutralises_formulas_when_assessments_exist(self, client):
        from tests.test_applications import apply, open_job
        from tests.test_candidates import candidate_payload

        cand = client.post(CANDIDATES, json=candidate_payload(7, first_name="=HYPERLINK(\"http://evil\")", last_name="+SUM(1)")).json()
        job = open_job(client, 7, required_skills=["Python"], nice_to_have_skills=[])
        assert apply(client, cand, job).status_code == 201
        res = client.post(f"{CANDIDATES}/{cand['id']}/export", json={"format": "csv"})
        row = res.text.splitlines()[1]
        assert "'=HYPERLINK" in row and "'+SUM(1)" in row
        assert ",=HYPERLINK" not in row and ",+SUM" not in row

    def test_bulk_json_export_includes_metadata_for_every_candidate(self, client, full):
        other = build(client, 2)
        assess(client, other)
        res = client.post(f"{CANDIDATES}/export", json={"format": "json"})
        assert res.status_code == 200
        counts = [len(a["requirements_coverage_assessments"]) for c in res.json()["candidates"] for a in c["applications"]]
        assert sorted(counts) == [1, 1]


class TestFailureHandling:
    def test_a_failure_while_recording_the_audit_event_stores_nothing(self, client, session_factory, monkeypatch):
        s = build(client, required=["Python"], preferred=[])
        with session_factory() as db:
            actor = db.scalar(select(User))

            def boom(*a, **k):
                raise RuntimeError("audit store unavailable")

            with monkeypatch.context() as m:
                m.setattr(service.audit, "record", boom)
                with pytest.raises(RuntimeError):
                    service.create_assessment(db, actor, uuid.UUID(s.application["id"]))
            db.rollback()
        with session_factory() as db:
            assert db.scalar(select(func.count()).select_from(ScreeningAssessment)) == 0
            assert db.scalar(select(func.count()).select_from(CandidateAuditEvent).where(
                CandidateAuditEvent.event_type == AuditEventType.SCREENING_CREATED)) == 0

    def test_a_failed_review_stores_neither_review_nor_audit(self, client, session_factory, monkeypatch):
        s = build(client)
        a = assess(client, s).json()
        from app.schemas.screening import ReviewCreate

        with session_factory() as db:
            actor = db.scalar(select(User))
            with monkeypatch.context() as m:
                m.setattr(service.audit, "record", lambda *a_, **k: (_ for _ in ()).throw(RuntimeError("down")))
                with pytest.raises(RuntimeError):
                    service.add_review(db, actor, uuid.UUID(a["id"]), ReviewCreate(judgement="agree", note="hi"))
            db.rollback()
        with session_factory() as db:
            assert db.scalar(select(func.count()).select_from(ScreeningReview)) == 0

    def test_losing_a_race_with_an_identical_assessment_returns_it_cleanly(self, client, session_factory):
        from sqlalchemy.exc import IntegrityError

        s = build(client, required=["Python"], preferred=[])
        with session_factory() as db:
            actor = db.scalar(select(User))
            real, state = db.flush, {"raced": False}

            def flush_after_rival_wins(*a, **k):
                if not state["raced"]:
                    state["raced"] = True
                    assert assess(client, s).status_code == 201  # the rival gets there first
                    db.rollback()
                    raise IntegrityError("insert", {}, Exception("uq_screening_assessments_identity"))
                return real(*a, **k)

            db.flush = flush_after_rival_wins  # type: ignore[method-assign]
            result = service.create_assessment(db, actor, uuid.UUID(s.application["id"]))
        assert result["created"] is False and result["assessment_number"] == 1
        with session_factory() as db:
            assert db.scalar(select(func.count()).select_from(ScreeningAssessment)) == 1

    def test_persistent_numbering_clashes_give_a_clear_409(self, client, session_factory):
        from sqlalchemy.exc import IntegrityError

        s = build(client, required=["Python"], preferred=[])
        with session_factory() as db:
            actor = db.scalar(select(User))

            def always(*a, **k):
                db.rollback()
                raise IntegrityError("insert", {}, Exception("clash"))

            db.flush = always  # type: ignore[method-assign]
            with pytest.raises(ConflictError) as err:
                service.create_assessment(db, actor, uuid.UUID(s.application["id"]))
            assert "simultaneous" in str(err.value)
        with session_factory() as db:
            assert db.scalar(select(func.count()).select_from(ScreeningAssessment)) == 0

    def test_a_stored_assessment_with_a_corrupt_reviewed_record_is_refused_not_scored(self, client, session_factory):
        s = build(client)
        with session_factory() as db:
            db.execute(text("update resumes set reviewed_data = '{\"parser_version\": 1, \"skills\": {\"values\": [\"Python\"]}}'"))
            db.commit()
        res = assess(client, s)
        assert res.status_code == 409 and "has not been reviewed" in res.json()["detail"]

