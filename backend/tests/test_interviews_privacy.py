"""Audit metadata, anonymization, export, failure handling and structural guarantees for interviews."""

import json
import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import func, select, text

from app.main import app as fastapi_app
from app.models.audit import AuditEventType, CandidateAuditEvent
from app.models.interview import Interview, InterviewEvent, InterviewInterviewer
from app.models.user import User
from app.services import audit
from tests.interview_helpers import INTERVIEWS, board, feedback_body, payload, slot
from tests.test_candidates import CANDIDATES

SECRETS = {
    "title": "Confidential-title-ACME",
    "location": "Secret-room-42",
    "url": "https://meet.example.com/private-room-9",
    "cancel": "Candidate-mentioned-surgery",
    "feedback": "Sensitive-opinion-text",
    "private": "PRIVATE-NOTE-ONLY-FOR-AUTHOR",
    "edit": "Edit-reason-with-details",
}


@pytest.fixture
def b(client_as, session_factory):
    from datetime import timedelta

    ctx = board(client_as)
    with session_factory() as db:
        row = db.get(Interview, uuid.UUID(ctx.id))
        row.starts_at -= timedelta(days=5)
        row.ends_at -= timedelta(days=5)
        row.title = SECRETS["title"]
        row.location = SECRETS["location"]
        row.meeting_url = SECRETS["url"]
        db.commit()
    return ctx


def audit_rows(session_factory, kind=None):
    with session_factory() as db:
        stmt = select(CandidateAuditEvent).order_by(CandidateAuditEvent.created_at)
        if kind:
            stmt = stmt.where(CandidateAuditEvent.event_type == kind)
        return [(e.event_type.value, dict(e.event_metadata), e.actor_id, e.candidate_id) for e in db.scalars(stmt)]


def full_flow(b, same_application: bool = False):
    """Touches every audited action once, with sensitive text in every free-text field. With
    `same_application` every interview belongs to the one candidate (for the anonymization tests)."""
    from tests.interview_helpers import new_application

    b.admin.patch(b.url, json={"title": SECRETS["title"], "meeting_url": SECRETS["url"], "location": SECRETS["location"], "round_number": 2})
    b.admin.post(f"{b.url}/confirm")
    b.rec.put(f"{b.url}/feedback", json=feedback_body(overall_feedback=SECRETS["feedback"], private_notes=SECRETS["private"]))
    b.rec.post(f"{b.url}/feedback/submit", json=feedback_body(overall_feedback=SECRETS["feedback"], private_notes=SECRETS["private"]))
    b.rec.patch(f"{b.url}/feedback", json={**feedback_body(overall_feedback=SECRETS["feedback"]), "edit_reason": SECRETS["edit"]})
    second = b.app if same_application else new_application(b.admin, 2)
    extra = b.admin.post(INTERVIEWS, json=payload(second, [b.rec.user], day=20, title=SECRETS["title"], meeting_url=SECRETS["url"])).json()
    b.admin.post(f"{INTERVIEWS}/{extra['id']}/reschedule", json={**slot(21, 10), "reason": SECRETS["cancel"]})
    third_app = b.app if same_application else new_application(b.admin, 3)
    third = b.admin.post(INTERVIEWS, json=payload(third_app, [b.hr.user], day=22, title="x")).json()
    b.admin.post(f"{INTERVIEWS}/{third['id']}/cancel", json={"reason": SECRETS["cancel"]})


class TestAudit:
    def test_every_action_is_recorded(self, b, session_factory):
        full_flow(b)
        kinds = [r[0] for r in audit_rows(session_factory)]
        for expected in ("interview_created", "interview_updated", "interview_confirmed", "feedback_draft_saved", "feedback_submitted",
                         "feedback_edited", "interview_rescheduled", "interview_cancelled"):
            assert expected in kinds, expected

    def test_a_completion_and_interviewer_changes_are_recorded(self, b, session_factory, make_user):
        from app.models.user import UserRole

        extra = make_user(UserRole.RECRUITER)
        b.admin.post(f"{b.url}/interviewers", json={"user_id": str(extra.id)})
        b.admin.delete(f"{b.url}/interviewers/{extra.id}")
        b.admin.post(f"{b.url}/complete")
        kinds = [r[0] for r in audit_rows(session_factory)]
        assert "interview_completed" in kinds and kinds.count("interviewers_changed") == 2
        changes = [r[1] for r in audit_rows(session_factory, AuditEventType.INTERVIEWERS_CHANGED)]
        assert changes[0]["added"] == 1 and changes[1]["removed"] == 1

    def test_metadata_is_ids_counts_and_codes_only(self, b, session_factory):
        created = audit_rows(session_factory, AuditEventType.INTERVIEW_CREATED)[0][1]
        assert set(created) == {"interview_id", "application_id", "interview_type", "round_number", "mode", "interviewer_count", "minutes"}
        assert created["interviewer_count"] == 2 and created["minutes"] == 60
        b.rec.post(f"{b.url}/feedback/submit", json=feedback_body())
        submitted = audit_rows(session_factory, AuditEventType.FEEDBACK_SUBMITTED)[0][1]
        assert set(submitted) == {"interview_id", "application_id", "overall_rating"}

    def test_no_audit_row_ever_holds_text_about_the_person_or_the_interview(self, b, session_factory):
        full_flow(b)
        blob = json.dumps([r[1] for r in audit_rows(session_factory)], default=str)
        for secret in SECRETS.values():
            assert secret not in blob, secret
        for private in (b.app["candidate"]["first_name"], b.app["candidate"]["last_name"], b.app["candidate"]["email"], "meet.example.com", "Karachi"):
            assert private not in blob, private

    def test_the_actor_and_candidate_are_recorded_by_id(self, b, session_factory):
        row = audit_rows(session_factory, AuditEventType.INTERVIEW_CREATED)[0]
        assert row[2] == b.admin.user.id and row[3] == uuid.UUID(b.app["candidate"]["id"])

    def test_a_failed_request_leaves_no_audit_row(self, b, session_factory):
        before = len(audit_rows(session_factory))
        assert b.admin.post(f"{INTERVIEWS}/{b.id}/cancel", json={"reason": ""}).status_code == 422
        assert b.admin.post(f"{INTERVIEWS}/{uuid.uuid4()}/confirm").status_code == 404
        assert b.rec.post(f"{b.url}/feedback/submit", json={"overall_rating": 9}).status_code == 422
        assert len(audit_rows(session_factory)) == before

    def test_the_trail_is_visible_to_hr_with_readable_types(self, b):
        b.admin.post(f"{b.url}/confirm")
        res = b.admin.get("/api/v1/privacy/audit", params={"candidate_id": b.app["candidate"]["id"], "event_type": "interview_confirmed"})
        assert res.status_code == 200 and res.json()["total"] == 1

    @pytest.mark.parametrize("key", ["meeting_url", "url", "feedback", "private_notes", "strengths", "concerns", "comments",
                                     "cancellation_reason", "edit_reason", "body", "link", "title", "location", "note"])
    def test_the_audit_writer_refuses_these_keys(self, key):
        with pytest.raises(ValueError):
            audit.clean_metadata({key: "x"})

    def test_nested_content_cannot_be_smuggled_in(self):
        with pytest.raises(ValueError):
            audit.clean_metadata({"counts": {"feedback": "Sensitive"}})
        with pytest.raises(ValueError):
            audit.clean_metadata({"x": "a" * 101})


class TestAnonymization:
    def anonymize(self, b):
        return b.admin.post(f"{CANDIDATES}/{b.app['candidate']['id']}/anonymize", json={"confirm": True})

    def test_the_preview_counts_interviews(self, b):
        pre = b.admin.get(f"{CANDIDATES}/{b.app['candidate']['id']}/anonymization-preview").json()
        assert pre["interviews_scrubbed"] == 1

    def test_free_text_is_removed_but_times_statuses_and_ratings_stay(self, b, session_factory):
        full_flow(b, same_application=True)
        before = b.admin.get(b.url).json()
        assert self.anonymize(b).status_code == 200
        after = b.admin.get(b.url).json()
        assert after["scrubbed"] is True and after["title"] == "Interview"
        assert after["location"] is None and after["meeting_url"] is None
        for kept in ("starts_at", "ends_at", "timezone", "status", "interview_type", "round_number", "mode"):
            assert after[kept] == before[kept], kept
        fb = b.admin.get(f"{b.url}/feedback").json()["items"][0]
        assert fb["scrubbed"] and fb["overall_feedback"] is None and fb["strengths"] is None and fb["private_notes"] is None
        assert fb["overall_rating"] == 4 and fb["status"] == "submitted" and fb["version"] == 2

    def test_a_cancelled_interview_keeps_a_reason_marker_not_the_text(self, b, session_factory):
        b.admin.post(f"{b.url}/cancel", json={"reason": SECRETS["cancel"]})
        self.anonymize(b)
        assert b.admin.get(b.url).json()["cancellation_reason"] == "removed"

    def test_no_secret_text_survives_in_any_row(self, b, session_factory):
        full_flow(b, same_application=True)
        self.anonymize(b)
        with session_factory() as db:
            dump = json.dumps(
                [[dict(r._mapping) for r in db.execute(text(f"select * from {t}"))] for t in
                 ("interviews", "interview_feedback", "interview_feedback_revisions", "interview_events", "candidate_audit_events")],
                default=str,
            )
        for name, secret in SECRETS.items():
            if name == "title":
                continue  # the title is replaced by the neutral word below, checked separately
            assert secret not in dump, name
        assert SECRETS["title"] not in dump
        assert b.app["candidate"]["email"] not in dump

    def test_the_scrub_is_audited_with_counts_only(self, b, session_factory):
        full_flow(b, same_application=True)
        self.anonymize(b)
        rows = audit_rows(session_factory, AuditEventType.INTERVIEW_SCRUBBED)
        assert len(rows) == 1 and set(rows[0][1]) == {"interviews", "feedback_records", "reason"} and rows[0][1]["reason"] == "anonymized"

    def test_anonymizing_twice_scrubs_and_logs_once(self, b, session_factory):
        self.anonymize(b)
        self.anonymize(b)
        assert len(audit_rows(session_factory, AuditEventType.INTERVIEW_SCRUBBED)) == 1

    def test_a_scrubbed_interview_and_its_feedback_cannot_be_changed(self, b):
        b.rec.post(f"{b.url}/feedback/submit", json=feedback_body())
        self.anonymize(b)
        assert b.admin.patch(b.url, json={"title": "New"}).status_code == 409
        assert b.admin.post(f"{b.url}/cancel", json={"reason": "x"}).status_code == 409
        assert b.rec.patch(f"{b.url}/feedback", json={**feedback_body(), "edit_reason": "x"}).status_code == 409
        assert b.admin.get(b.url).json()["allowed_actions"] == ["view_history"]

    def test_other_candidates_are_untouched(self, b, client_as):
        other = board.__globals__["new_application"](b.admin, 2)
        keep = b.admin.post(INTERVIEWS, json=payload(other, [b.rec.user], day=25, title="Keep me")).json()
        self.anonymize(b)
        assert b.admin.get(f"{INTERVIEWS}/{keep['id']}").json()["title"] == "Keep me"

    def test_history_events_hold_no_text(self, b, session_factory):
        full_flow(b, same_application=True)
        with session_factory() as db:
            blob = json.dumps([e.details for e in db.scalars(select(InterviewEvent))], default=str)
        for secret in SECRETS.values():
            assert secret not in blob

    def test_a_candidate_with_interviews_cannot_be_hard_deleted(self, b):
        assert b.admin.delete(f"{CANDIDATES}/{b.app['candidate']['id']}").status_code == 409


class TestExport:
    def test_the_json_export_has_dates_types_and_statuses_only(self, b):
        full_flow(b)
        res = b.admin.post(f"{CANDIDATES}/{b.app['candidate']['id']}/export", json={"format": "json"})
        raw = res.text
        entry = res.json()["candidates"][0]["applications"][0]["interviews"][0]
        assert set(entry) == {"round", "type", "mode", "status", "starts_at", "timezone"}
        for secret in SECRETS.values():
            assert secret not in raw, secret
        assert "meet.example.com" not in raw and "overall_rating" not in raw and "interviewer" not in raw

    def test_the_csv_export_is_unchanged(self, b):
        res = b.admin.post(f"{CANDIDATES}/{b.app['candidate']['id']}/export", json={"format": "csv"})
        assert res.status_code == 200 and "interview" not in res.text.lower() and SECRETS["title"] not in res.text


class TestFailureHandling:
    def test_a_failure_while_auditing_creates_nothing(self, b, session_factory, monkeypatch):
        from app.schemas.interview import InterviewCreate
        from app.services import interview as service

        other = board.__globals__["new_application"](b.admin, 9)
        with session_factory() as db:
            actor = db.scalar(select(User).where(User.id == b.admin.user.id))
            data = InterviewCreate(**payload(other, [b.rec.user], day=30))
            monkeypatch.setattr(service.audit, "record", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("audit down")))
            with pytest.raises(RuntimeError):
                service.create_interview(db, actor, data)
            db.rollback()
            monkeypatch.undo()
        with session_factory() as db:
            assert db.scalar(select(func.count()).select_from(Interview)) == 1  # only the fixture's
            assert db.scalar(select(func.count()).select_from(InterviewInterviewer)) == 2

    def test_a_failed_feedback_save_stores_nothing(self, b, session_factory, monkeypatch):
        from app.schemas.interview import FeedbackSubmit
        from app.services import interview_feedback as fb

        with session_factory() as db:
            actor = db.scalar(select(User).where(User.id == b.rec.user.id))
            monkeypatch.setattr(fb.audit, "record", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("audit down")))
            with pytest.raises(RuntimeError):
                fb.submit(db, actor, uuid.UUID(b.id), FeedbackSubmit(**feedback_body()))
            db.rollback()
            monkeypatch.undo()
        assert b.rec.get(f"{b.url}/feedback").json()["items"] == []

    def test_a_simultaneous_duplicate_interviewer_is_a_clean_409(self, b, session_factory, monkeypatch, make_user):
        from sqlalchemy.exc import IntegrityError

        from app.core.exceptions import ConflictError
        from app.models.user import UserRole
        from app.services import interview as service

        extra = make_user(UserRole.RECRUITER)
        with session_factory() as db:
            actor = db.scalar(select(User).where(User.id == b.admin.user.id))

            def boom():
                raise IntegrityError("insert", {}, Exception("uq_interview_interviewers_pair"))

            monkeypatch.setattr(db, "commit", boom)
            with pytest.raises(ConflictError):
                service.add_interviewer(db, actor, uuid.UUID(b.id), extra.id)
            monkeypatch.undo()


class TestStructure:
    SERVICE = [Path(__file__).resolve().parents[1] / "app" / "services" / n for n in ("interview.py", "interview_feedback.py")]
    API = Path(__file__).resolve().parents[1] / "app" / "api" / "v1" / "interviews.py"

    def test_nothing_in_the_interview_code_changes_an_application_stage(self):
        for path in (*self.SERVICE, self.API):
            src = path.read_text(encoding="utf-8")
            for banned in ("change_stage", "application_workflow", "ApplicationEvent", "reopen(", ".stage ="):
                assert banned not in src, (path.name, banned)
            assert "app.services.application " not in src and "services.application import" not in src

    def test_no_interview_code_reads_resume_parsing_or_screening_scores(self):
        for path in (*self.SERVICE, self.API):
            src = path.read_text(encoding="utf-8")
            for banned in ("parsed_data", "screening", "total_score", "ScreeningAssessment"):
                assert banned not in src, (path.name, banned)

    def test_the_api_has_no_score_based_sort_or_filter_and_no_ranking_fields(self):
        spec = fastapi_app.openapi()
        banned_param = re.compile(r"sort|rank|score|rating|min_|max_|threshold|best|top", re.I)
        for path, methods in spec["paths"].items():
            if "interview" not in path:
                continue
            for method, op in methods.items():
                for p in op.get("parameters", []):
                    if p["in"] == "query":
                        assert not banned_param.search(p["name"]), (path, method, p["name"])
        banned_field = re.compile(r"rank|average|mean|percentile|aggregate|weighted|leaderboard|best_", re.I)
        for name, schema in spec["components"]["schemas"].items():
            if any(k in name for k in ("Interview", "Feedback", "Revision", "Rating")):
                for field in schema.get("properties", {}):
                    assert not banned_field.search(field), (name, field)

    def test_the_listing_orders_by_start_time_only(self):
        src = self.SERVICE[0].read_text(encoding="utf-8")
        body = src[src.index("def list_interviews"): src.index("def history")]
        orders = re.findall(r"order = \(([^)]*)\)|order_by\(([^)]*)\)", body)
        flat = " ".join(a or b for a, b in orders)
        assert "starts_at" in flat and not re.search(r"rating|score|feedback", flat)

    def test_every_booking_path_locks_the_application_before_the_people(self):
        """Two simultaneous bookings of the same candidate must queue behind one lock (proved on
        PostgreSQL with real threads; SQLite cannot race, so this pins the shape of the code)."""
        src = self.SERVICE[0].read_text(encoding="utf-8")
        for name in ("create_interview", "reschedule", "add_interviewer"):
            body = src[src.index(f"def {name}("):]
            nxt = body.find("\ndef ", 10)
            body = body if nxt == -1 else body[:nxt]
            assert "_lock_application(" in body and "_staff_users(" in body, name
            assert body.index("_lock_application(") < body.index("_staff_users("), name
            assert body.index("_staff_users(") < body.index("check_conflicts("), name

    def test_deleting_is_not_possible(self):
        methods = {m for p, ms in fastapi_app.openapi()["paths"].items() if "interview" in p for m in ms}
        assert "delete" in methods  # only the interviewer-removal endpoint
        paths_with_delete = [p for p, ms in fastapi_app.openapi()["paths"].items() if "interview" in p and "delete" in ms]
        assert paths_with_delete == ["/api/v1/interviews/{interview_id}/interviewers/{user_id}"]
