"""Anonymizing a candidate: exactly what changes, what is kept, and that it is safe to repeat."""

import json
import uuid

import pytest
from sqlalchemy import select, text

from app.models.audit import CandidateAuditEvent
from app.models.candidate import Candidate
from app.models.employee import Employee
from app.models.user import UserRole
from tests.conftest import employee_payload
from tests.test_applications import APPS, apply, make_application, move, open_job
from tests.test_candidates import CANDIDATES, candidate_payload


def anonymize(c, cid, confirm=True):
    return c.post(f"{CANDIDATES}/{cid}/anonymize", json={"confirm": confirm})


def preview(c, cid):
    return c.get(f"{CANDIDATES}/{cid}/anonymization-preview")


def rich_candidate(client, n=1, **over):
    return client.post(CANDIDATES, json=candidate_payload(
        n, first_name="Zebulon", last_name="Quirke", email=f"zeb{n}@example.com", phone="+92 300 5550199",
        location="Hidden Valley", current_title="Cryptographer", current_company="Hushco", **over)).json()


class TestPreview:
    def test_lists_field_names_and_counts_but_no_values(self, client):
        cand = rich_candidate(client)
        body = preview(client, cand["id"]).json()
        assert body["fields_replaced"] == ["first_name", "last_name", "email"]
        assert set(body["fields_cleared"]) == {"phone", "location", "current_title", "current_company", "consent_basis_note"}
        assert "source" in body["fields_kept"] and "consent_date" in body["fields_kept"]
        assert body["already_anonymized"] is False and body["application_count"] == 0
        for value in ("Zebulon", "Quirke", "zeb1", "5550199", "Hidden Valley", "Hushco"):
            assert value not in json.dumps(body)

    def test_counts_applications_and_the_notes_that_would_be_cleared(self, client):
        app = make_application(client, internal_notes="private opinion")
        move(client, app["id"], "rejected", note="not a fit")
        body = preview(client, app["candidate"]["id"]).json()
        assert (body["application_count"], body["application_notes_cleared"], body["history_notes_cleared"]) == (1, 1, 1)

    def test_a_preview_changes_nothing_and_logs_nothing(self, client, session_factory):
        cand = rich_candidate(client)
        with session_factory() as db:
            before = db.scalar(text("select count(*) from candidate_audit_events"))
        preview(client, cand["id"])
        with session_factory() as db:
            assert db.scalar(text("select count(*) from candidate_audit_events")) == before
            assert db.get(Candidate, uuid.UUID(cand["id"])).anonymized_at is None

    def test_unknown_candidate_is_404(self, client):
        assert preview(client, uuid.uuid4()).status_code == 404


class TestWhatChanges:
    def test_identifying_fields_are_replaced_or_cleared(self, client):
        cand = rich_candidate(client)
        res = anonymize(client, cand["id"])
        assert res.status_code == 200 and res.json()["changed"] is True
        after = res.json()["candidate"]
        assert (after["first_name"], after["last_name"]) == ("Anonymized", "Candidate")
        assert after["email"] == f"anonymized-{cand['id']}@anonymized.invalid"
        assert after["phone"] is None and after["location"] is None
        assert after["current_title"] is None and after["current_company"] is None
        assert after["anonymized_at"] is not None

    def test_non_identifying_facts_are_kept(self, client):
        cand = rich_candidate(client, consent_basis="consent")
        after = anonymize(client, cand["id"]).json()["candidate"]
        for field in ("id", "source", "consent_basis", "consent_date", "retain_until", "last_activity_at", "created_at"):
            assert after[field] == cand[field], field

    def test_original_values_are_gone_from_every_response_afterwards(self, client):
        cand = rich_candidate(client)
        anonymize(client, cand["id"])
        everything = "".join([
            client.get(f"{CANDIDATES}/{cand['id']}").text,
            client.get(CANDIDATES).text,
            client.get(APPS).text,
            client.get("/api/v1/privacy/retention").text,
            client.get("/api/v1/privacy/retention", params={"status": "anonymized"}).text,
        ])
        for value in ("Zebulon", "Quirke", "zeb1@", "5550199", "Hidden Valley", "Cryptographer", "Hushco"):
            assert value not in everything

    def test_original_values_are_gone_from_the_database_row(self, client, session_factory):
        cand = rich_candidate(client)
        anonymize(client, cand["id"])
        with session_factory() as db:
            row = db.get(Candidate, uuid.UUID(cand["id"]))
            blob = " ".join(str(getattr(row, f)) for f in ("first_name", "last_name", "email", "phone", "location", "current_title", "current_company"))
        for value in ("Zebulon", "Quirke", "5550199", "Hidden Valley", "Cryptographer", "Hushco"):
            assert value not in blob

    def test_the_other_basis_explanation_is_replaced_not_left_as_personal_text(self, client):
        cand = rich_candidate(client, consent_basis="other", consent_basis_note="Met at Zebulon's wedding")
        after = anonymize(client, cand["id"]).json()["candidate"]
        assert after["consent_basis"] == "other"
        assert "wedding" not in json.dumps(after) and after["consent_basis_note"]  # the DB needs some text

    def test_only_the_chosen_candidate_changes(self, client):
        a, b = rich_candidate(client, 1), rich_candidate(client, 2)
        anonymize(client, a["id"])
        other = client.get(f"{CANDIDATES}/{b['id']}").json()
        assert other["first_name"] == "Zebulon" and other["anonymized_at"] is None

    def test_employee_records_are_untouched(self, client, session_factory):
        client.post("/api/v1/employees", json=employee_payload(1, first_name="Zebulon", last_name="Quirke"))
        cand = rich_candidate(client)
        anonymize(client, cand["id"])
        with session_factory() as db:
            emp = db.scalar(select(Employee))
            assert (emp.first_name, emp.last_name) == ("Zebulon", "Quirke")


class TestApplicationsAndHistory:
    def test_applications_and_their_structure_survive(self, client, session_factory):
        app = make_application(client)
        for stage in ("screening", "shortlisted"):
            move(client, app["id"], stage)
        anonymize(client, app["candidate"]["id"])
        body = client.get(f"{APPS}/{app['id']}").json()
        assert body["stage"] == "shortlisted" and body["applied_at"] == app["applied_at"]
        assert [e["event_type"] for e in body["events"]] == ["created", "stage_changed", "stage_changed"]
        assert [e["to_value"] for e in body["events"]] == ["applied", "screening", "shortlisted"]
        assert all(e["actor"] for e in body["events"])
        assert body["candidate"]["first_name"] == "Anonymized"

    def test_free_text_notes_are_cleared_everywhere(self, client, session_factory):
        app = make_application(client, internal_notes="He told me about his divorce")
        move(client, app["id"], "rejected", note="Mentioned his health problems")
        anonymize(client, app["candidate"]["id"])
        body = client.get(f"{APPS}/{app['id']}").json()
        assert body["internal_notes"] is None
        assert all(e["note"] is None for e in body["events"])
        assert "divorce" not in json.dumps(body) and "health" not in json.dumps(body)

    def test_the_rejected_event_itself_is_kept(self, client):
        app = make_application(client)
        move(client, app["id"], "rejected", note="reason")
        anonymize(client, app["candidate"]["id"])
        events = client.get(f"{APPS}/{app['id']}").json()["events"]
        assert events[-1]["event_type"] == "rejected" and events[-1]["to_value"] == "rejected"

    def test_other_candidates_applications_keep_their_notes(self, client):
        a, b = make_application(client, 1, internal_notes="keep me"), make_application(client, 2, internal_notes="keep me too")
        move(client, b["id"], "rejected", note="keep this reason")
        anonymize(client, a["candidate"]["id"])
        other = client.get(f"{APPS}/{b['id']}").json()
        assert other["internal_notes"] == "keep me too" and other["events"][-1]["note"] == "keep this reason"

    def test_the_history_is_not_deleted(self, client, session_factory):
        app = make_application(client)
        move(client, app["id"], "screening")
        with session_factory() as db:
            before = db.scalar(text("select count(*) from application_events"))
        anonymize(client, app["candidate"]["id"])
        with session_factory() as db:
            assert db.scalar(text("select count(*) from application_events")) == before
            assert db.scalar(text("select count(*) from applications")) == 1

    def test_the_list_never_shows_anonymized_people_but_applications_still_do(self, client):
        app = make_application(client)
        anonymize(client, app["candidate"]["id"])
        assert client.get(CANDIDATES).json()["total"] == 0
        assert client.get(APPS).json()["items"][0]["candidate"]["last_name"] == "Candidate"


class TestIdempotency:
    def test_doing_it_twice_changes_nothing_the_second_time(self, client, session_factory):
        cand = rich_candidate(client)
        first = anonymize(client, cand["id"]).json()
        second = anonymize(client, cand["id"])
        assert second.status_code == 200 and second.json()["changed"] is False
        assert second.json()["candidate"]["anonymized_at"] == first["candidate"]["anonymized_at"]

    def test_the_second_call_writes_no_second_audit_event(self, client, session_factory):
        cand = rich_candidate(client)
        anonymize(client, cand["id"])
        anonymize(client, cand["id"])
        with session_factory() as db:
            n = db.scalar(text("select count(*) from candidate_audit_events where event_type = 'candidate_anonymized'"))
        assert n == 1

    def test_two_simultaneous_requests_only_anonymize_once(self, client, session_factory, monkeypatch):
        """The second request starts before the first has committed, then finds it already done."""
        from app.services import privacy as service

        cand = rich_candidate(client)
        real_get = service.get_candidate
        calls = {"n": 0}

        def racing_get(db, cid):
            candidate = real_get(db, cid)
            if calls["n"] == 0:  # a rival request completes right after we read the row
                calls["n"] += 1
                with session_factory() as other:
                    service.anonymize_candidate(other, client.user, cid)
            return candidate

        monkeypatch.setattr(service, "get_candidate", racing_get)
        res = anonymize(client, cand["id"])
        assert res.status_code == 200 and res.json()["changed"] is False
        with session_factory() as db:
            assert db.scalar(text("select count(*) from candidate_audit_events where event_type = 'candidate_anonymized'")) == 1


class TestAfterwards:
    def test_the_record_can_no_longer_be_edited(self, client):
        cand = rich_candidate(client)
        anonymize(client, cand["id"])
        for body in ({"first_name": "Zebulon"}, {"email": "zeb1@example.com"}, {"phone": "+92 300 5550199"}):
            res = client.patch(f"{CANDIDATES}/{cand['id']}", json=body)
            assert res.status_code == 409 and "anonymized" in res.json()["detail"]
        assert client.get(f"{CANDIDATES}/{cand['id']}").json()["first_name"] == "Anonymized"

    def test_the_old_email_is_free_to_be_reused_by_a_new_candidate(self, client):
        cand = rich_candidate(client)
        anonymize(client, cand["id"])
        assert client.post(CANDIDATES, json=candidate_payload(5, email="zeb1@example.com")).status_code == 201

    def test_the_candidate_cannot_be_applied_to_a_new_job(self, client):
        cand = rich_candidate(client)
        anonymize(client, cand["id"])
        assert apply(client, cand, open_job(client)).status_code == 422

    def test_placeholder_emails_never_collide(self, client):
        ids = [rich_candidate(client, n)["id"] for n in (1, 2, 3)]
        assert all(anonymize(client, i).status_code == 200 for i in ids)

    def test_it_is_recorded_with_actor_and_counts_only(self, client_as, session_factory):
        hr = client_as(UserRole.HR_MANAGER)
        app = make_application(hr, internal_notes="x")
        anonymize(hr, app["candidate"]["id"])
        with session_factory() as db:
            event = db.scalar(select(CandidateAuditEvent).where(CandidateAuditEvent.event_type == "candidate_anonymized"))
        assert event.actor_id == hr.user.id and str(event.candidate_id) == app["candidate"]["id"]
        assert event.event_metadata == {"applications": 1, "application_notes_cleared": 1, "history_notes_cleared": 0}

    def test_it_can_be_undone_by_nobody(self, client):
        """There is no restore endpoint; originals are not kept anywhere."""
        cand = rich_candidate(client)
        anonymize(client, cand["id"])
        for method, path in [("post", "restore"), ("post", "deanonymize"), ("delete", "anonymize")]:
            assert getattr(client, method)(f"{CANDIDATES}/{cand['id']}/{path}").status_code in (404, 405)


class TestConfirmation:
    @pytest.mark.parametrize("body", [{}, {"confirm": False}, {"confirm": "yes"}, {"confirm": 0}, {"confirm": True, "extra": 1}])
    def test_it_does_nothing_without_explicit_confirmation(self, client, body):
        cand = rich_candidate(client)
        assert client.post(f"{CANDIDATES}/{cand['id']}/anonymize", json=body).status_code == 422
        assert client.get(f"{CANDIDATES}/{cand['id']}").json()["first_name"] == "Zebulon"

    def test_a_failed_audit_write_rolls_the_anonymization_back(self, client, session_factory, monkeypatch):
        from app.services import audit as audit_service

        cand = rich_candidate(client)
        monkeypatch.setattr(audit_service, "record", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
        with pytest.raises(RuntimeError):
            anonymize(client, cand["id"])
        monkeypatch.undo()
        after = client.get(f"{CANDIDATES}/{cand['id']}").json()
        assert after["first_name"] == "Zebulon" and after["anonymized_at"] is None

    def test_unknown_candidate_is_404(self, client):
        assert anonymize(client, uuid.uuid4()).status_code == 404
        assert client.post(f"{CANDIDATES}/not-a-uuid/anonymize", json={"confirm": True}).status_code == 422
