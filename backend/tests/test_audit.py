"""The candidate audit trail: what is recorded, what is never recorded, and that it cannot be skipped."""

import json
import uuid

import pytest
from sqlalchemy import select

from app.models.audit import AuditEventType, AuditIsAppendOnly, CandidateAuditEvent
from app.models.user import UserRole
from app.services import audit as audit_service
from tests.test_candidates import CANDIDATES, candidate_payload

AUDIT = "/api/v1/privacy/audit"


def events(session_factory, **where) -> list[CandidateAuditEvent]:
    with session_factory() as db:
        stmt = select(CandidateAuditEvent).order_by(CandidateAuditEvent.created_at)
        rows = list(db.scalars(stmt))
        return [r for r in rows if all(getattr(r, k) == v for k, v in where.items())]


def kinds(session_factory, candidate_id: str) -> list[str]:
    return [e.event_type.value for e in events(session_factory, candidate_id=uuid.UUID(candidate_id))]


class TestRecording:
    def test_creating_a_candidate_is_recorded_with_the_actor(self, client, session_factory):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        [event] = events(session_factory, candidate_id=uuid.UUID(cand["id"]))
        assert event.event_type == AuditEventType.CANDIDATE_CREATED
        assert event.actor_id == client.user.id
        assert event.event_metadata == {"consent_basis": "legitimate_interest"}

    def test_opening_a_profile_is_recorded_each_time(self, client, session_factory):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        client.get(f"{CANDIDATES}/{cand['id']}")
        client.get(f"{CANDIDATES}/{cand['id']}")
        assert kinds(session_factory, cand["id"]) == ["candidate_created", "candidate_viewed", "candidate_viewed"]

    def test_the_list_is_not_logged_per_row(self, client, session_factory):
        client.post(CANDIDATES, json=candidate_payload(1))
        before = len(events(session_factory))
        client.get(CANDIDATES)
        client.get(CANDIDATES, params={"q": "iqbal"})
        assert len(events(session_factory)) == before

    def test_an_edit_records_field_names_never_values(self, client, session_factory):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        client.patch(f"{CANDIDATES}/{cand['id']}", json={"location": "Secret City", "phone": "+92 300 7654321"})
        updated = [e for e in events(session_factory) if e.event_type == AuditEventType.CANDIDATE_UPDATED][0]
        assert updated.event_metadata == {"fields": ["location", "phone"]}
        blob = json.dumps([e.event_metadata for e in events(session_factory)])
        assert "Secret City" not in blob and "7654321" not in blob

    def test_changing_consent_is_recorded_separately(self, client, session_factory):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        client.patch(f"{CANDIDATES}/{cand['id']}", json={"consent_basis": "consent"})
        consent = [e for e in events(session_factory) if e.event_type == AuditEventType.CONSENT_CHANGED]
        assert len(consent) == 1
        assert consent[0].event_metadata == {"from_basis": "legitimate_interest", "to_basis": "consent"}

    def test_a_routine_edit_is_not_a_consent_change(self, client, session_factory):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        client.patch(f"{CANDIDATES}/{cand['id']}", json={"location": "Karachi"})
        assert "consent_changed" not in kinds(session_factory, cand["id"])

    def test_an_empty_edit_logs_nothing(self, client, session_factory):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        client.patch(f"{CANDIDATES}/{cand['id']}", json={})
        assert kinds(session_factory, cand["id"]) == ["candidate_created"]

    def test_a_refused_edit_logs_nothing(self, client, session_factory):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        assert client.patch(f"{CANDIDATES}/{cand['id']}", json={"email": "not-an-email"}).status_code == 422
        assert kinds(session_factory, cand["id"]) == ["candidate_created"]

    def test_deleting_a_mistaken_entry_is_recorded_and_the_trail_survives(self, client, session_factory):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        assert client.delete(f"{CANDIDATES}/{cand['id']}").status_code == 204
        assert kinds(session_factory, cand["id"]) == ["candidate_created", "candidate_deleted"]

    def test_who_viewed_is_the_real_user_not_whatever_the_client_claims(self, client_as, session_factory):
        rec = client_as(UserRole.RECRUITER)
        cand = rec.post(CANDIDATES, json=candidate_payload(1)).json()
        rec.get(f"{CANDIDATES}/{cand['id']}", headers={"X-Actor": str(uuid.uuid4())})
        assert {e.actor_id for e in events(session_factory)} == {rec.user.id}


class TestRequestCorrelation:
    def test_a_safe_request_id_is_kept(self, client, session_factory):
        cand = client.post(CANDIDATES, json=candidate_payload(1), headers={"X-Request-ID": "req-abc-12345"}).json()
        assert events(session_factory, candidate_id=uuid.UUID(cand["id"]))[0].request_id == "req-abc-12345"

    @pytest.mark.parametrize("bad", ["short", "has spaces in it", "x" * 65, "semi;colon-1234", "<script>alert(1)</script>"])
    def test_an_unsafe_request_id_is_replaced(self, client, session_factory, bad):
        cand = client.post(CANDIDATES, json=candidate_payload(1), headers={"X-Request-ID": bad}).json()
        rid = events(session_factory, candidate_id=uuid.UUID(cand["id"]))[0].request_id
        assert rid != bad and len(rid) == 32

    def test_every_event_gets_one_when_none_is_sent(self, client, session_factory):
        client.post(CANDIDATES, json=candidate_payload(1))
        assert all(e.request_id for e in events(session_factory))


class TestNoPersonalDataInTheTrail:
    def test_a_full_lifecycle_leaves_no_personal_data_anywhere_in_the_audit_table(self, client, session_factory):
        cand = client.post(CANDIDATES, json=candidate_payload(1, first_name="Zebulon", last_name="Quirke",
                                                              email="zeb.quirke@example.com", phone="+92 300 5550199",
                                                              location="Hidden Valley", current_company="Hushco")).json()
        client.get(f"{CANDIDATES}/{cand['id']}")
        client.patch(f"{CANDIDATES}/{cand['id']}", json={"location": "Elsewhere", "consent_basis": "consent"})
        client.post(f"{CANDIDATES}/{cand['id']}/export", json={"format": "json"})
        client.post(f"{CANDIDATES}/{cand['id']}/anonymize", json={"confirm": True})
        client.get(CANDIDATES, params={"q": "Zebulon"})
        with session_factory() as db:
            rows = db.execute(select(CandidateAuditEvent)).scalars().all()
            dump = json.dumps([{"m": r.event_metadata, "r": r.request_id, "t": r.event_type.value} for r in rows])
        for secret in ("Zebulon", "Quirke", "zeb.quirke", "5550199", "Hidden Valley", "Elsewhere", "Hushco"):
            assert secret not in dump

    def test_the_search_term_is_never_logged(self, client, session_factory):
        client.post(CANDIDATES, json=candidate_payload(1))
        client.get(CANDIDATES, params={"q": "needle-in-a-haystack"})
        with session_factory() as db:
            assert "needle-in-a-haystack" not in json.dumps([r.event_metadata for r in db.scalars(select(CandidateAuditEvent))])

    @pytest.mark.parametrize("key", ["email", "name", "first_name", "phone", "q", "query", "password", "token", "note", "Email", "LOCATION"])
    def test_metadata_with_personal_keys_is_refused(self, key):
        with pytest.raises(ValueError):
            audit_service.clean_metadata({key: "x"})

    @pytest.mark.parametrize("value", [{"a": 1}, object(), "x" * 101, b"bytes"])
    def test_metadata_values_must_be_small_and_simple(self, value):
        with pytest.raises(ValueError):
            audit_service.clean_metadata({"fields": value})

    def test_field_names_and_small_values_are_fine(self):
        assert audit_service.clean_metadata({"fields": ["location", "phone"], "count": 3, "ok": True}) == {
            "fields": ["location", "phone"], "count": 3, "ok": True}


class TestCannotBeSkipped:
    """If the audit row cannot be written, the sensitive action must not happen."""

    @pytest.fixture
    def broken_audit(self, monkeypatch):
        def broken(*_a, **_k):
            raise RuntimeError("audit store unavailable")

        monkeypatch.setattr(audit_service, "record", broken)

    def test_creating_fails_and_creates_nothing(self, client, session_factory, broken_audit):
        with pytest.raises(RuntimeError):
            client.post(CANDIDATES, json=candidate_payload(1))
        assert client.get(CANDIDATES).json()["total"] == 0

    def test_viewing_fails_and_returns_no_data(self, client, session_factory, monkeypatch):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        monkeypatch.setattr(audit_service, "record", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
        with pytest.raises(RuntimeError):
            client.get(f"{CANDIDATES}/{cand['id']}")

    def test_editing_fails_and_changes_nothing(self, client, monkeypatch):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        monkeypatch.setattr(audit_service, "record", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
        with pytest.raises(RuntimeError):
            client.patch(f"{CANDIDATES}/{cand['id']}", json={"location": "Changed"})
        monkeypatch.undo()
        assert client.get(f"{CANDIDATES}/{cand['id']}").json()["location"] == cand["location"]

    def test_deleting_fails_and_keeps_the_candidate(self, client, monkeypatch):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        monkeypatch.setattr(audit_service, "record", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
        with pytest.raises(RuntimeError):
            client.delete(f"{CANDIDATES}/{cand['id']}")
        monkeypatch.undo()
        assert client.get(f"{CANDIDATES}/{cand['id']}").status_code == 200


class TestAppendOnly:
    def test_audit_rows_cannot_be_edited_or_deleted_through_the_orm(self, client, session_factory):
        client.post(CANDIDATES, json=candidate_payload(1))
        with session_factory() as db:
            row = db.scalar(select(CandidateAuditEvent))
            row.request_id = "tampered-0001"
            with pytest.raises(AuditIsAppendOnly):
                db.flush()
            db.rollback()
            db.delete(db.scalar(select(CandidateAuditEvent)))
            with pytest.raises(AuditIsAppendOnly):
                db.flush()

    def test_there_is_no_endpoint_to_change_audit_records(self, client):
        for method in ("post", "put", "patch", "delete"):
            assert getattr(client, method)(AUDIT).status_code in (404, 405, 422)
            assert getattr(client, method)(f"{AUDIT}/{uuid.uuid4()}").status_code in (404, 405)

    def test_deleting_the_actor_keeps_the_event(self, client_as, session_factory):
        from app.models.user import User

        hr = client_as(UserRole.HR_MANAGER)
        cand = hr.post(CANDIDATES, json=candidate_payload(1)).json()
        with session_factory() as db:
            db.delete(db.get(User, hr.user.id))
            db.commit()
        [event] = events(session_factory, candidate_id=uuid.UUID(cand["id"]))
        assert event.actor_id is None


class TestReading:
    def test_hr_can_read_the_trail_newest_first_with_actor(self, client_as):
        hr = client_as(UserRole.HR_MANAGER)
        cand = hr.post(CANDIDATES, json=candidate_payload(1)).json()
        hr.get(f"{CANDIDATES}/{cand['id']}")
        body = hr.get(AUDIT, params={"candidate_id": cand["id"]}).json()
        assert body["total"] == 2
        assert [e["event_type"] for e in body["items"]] == ["candidate_viewed", "candidate_created"]
        assert body["items"][0]["actor"]["email"] == hr.user.email
        assert body["items"][0]["metadata"] == {}
        assert "event_metadata" not in body["items"][0]

    def test_filters_and_pagination(self, client):
        a = client.post(CANDIDATES, json=candidate_payload(1)).json()
        client.post(CANDIDATES, json=candidate_payload(2))
        for _ in range(3):
            client.get(f"{CANDIDATES}/{a['id']}")
        assert client.get(AUDIT, params={"event_type": "candidate_viewed"}).json()["total"] == 3
        assert client.get(AUDIT, params={"candidate_id": a["id"]}).json()["total"] == 4
        page = client.get(AUDIT, params={"page": 2, "page_size": 2}).json()
        assert page["total"] == 5 and len(page["items"]) == 2

    def test_reading_the_trail_does_not_write_to_it(self, client, session_factory):
        client.post(CANDIDATES, json=candidate_payload(1))
        before = len(events(session_factory))
        client.get(AUDIT)
        assert len(events(session_factory)) == before

    @pytest.mark.parametrize("params", [{"page": 0}, {"page_size": 101}, {"event_type": "bogus"}, {"candidate_id": "x"}])
    def test_bad_parameters_are_422(self, client, params):
        assert client.get(AUDIT, params=params).status_code == 422
