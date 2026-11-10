"""Retention review and the manual, opt-in purge. No test ever purges anything real: every database
here is an in-memory throwaway."""

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text

from app.core.config import settings
from app.models.application import Application
from app.models.audit import AuditEventType, CandidateAuditEvent
from app.models.candidate import Candidate
from app.models.user import UserRole
from app.services import privacy as privacy_service
from tests.test_applications import APPS, apply, make_application, open_job
from tests.test_candidates import CANDIDATES, candidate_payload

RET = "/api/v1/privacy/retention"
PURGE = "/api/v1/privacy/purge"


def today():
    return datetime.now(UTC).date()


def set_retention(session_factory, cid: str, days_from_today: int):
    with session_factory() as db:
        db.get(Candidate, uuid.UUID(cid)).retain_until = today() + timedelta(days=days_from_today)
        db.commit()


def person(client, session_factory, n: int, days: int) -> dict:
    cand = client.post(CANDIDATES, json=candidate_payload(n)).json()
    set_retention(session_factory, cand["id"], days)
    return cand


def count(session_factory, table="candidates") -> int:
    with session_factory() as db:
        return db.scalar(text(f"select count(*) from {table}"))


@pytest.fixture
def purge_on(monkeypatch):
    monkeypatch.setattr(settings, "PRIVACY_PURGE_ENABLED", True)


@pytest.fixture
def world(client, session_factory):
    """expired(2), expiring soon, active, anonymized, and an expired one holding applications."""
    return {
        "expired_a": person(client, session_factory, 1, -10),
        "expired_b": person(client, session_factory, 2, -1),
        "expiring": person(client, session_factory, 3, 10),
        "active": person(client, session_factory, 4, 200),
        "with_apps": _expired_with_application(client, session_factory),
    }


def _expired_with_application(client, session_factory):
    app = make_application(client, 90)
    set_retention(session_factory, app["candidate"]["id"], -30)
    return app["candidate"]


class TestRetentionOverview:
    def test_the_summary_counts_each_group(self, client, world):
        client.post(f"{CANDIDATES}/{world['active']['id']}/anonymize", json={"confirm": True})
        s = client.get(RET).json()["summary"]
        assert s["expired"] == 3 and s["expiring"] == 1 and s["anonymized"] == 1
        assert s["purge_eligible"] == 2 and s["expired_with_applications"] == 1
        assert s["retention_months"] == settings.CANDIDATE_RETENTION_MONTHS and s["purge_enabled"] is False

    def test_the_list_is_soonest_to_expire_first(self, client, world):
        items = client.get(RET).json()["items"]
        dates = [i["retain_until"] for i in items]
        assert dates == sorted(dates)

    @pytest.mark.parametrize("status,expected", [("expired", 3), ("expiring", 1), ("anonymized", 0), ("all", 5)])
    def test_filtering_by_status(self, client, world, status, expected):
        body = client.get(RET, params={"status": status}).json()
        assert body["total"] == expected and len(body["items"]) == expected

    def test_each_row_says_what_it_is(self, client, world):
        by_email = {i["email"]: i for i in client.get(RET).json()["items"]}
        assert by_email[world["expired_a"]["email"]]["status"] == "expired"
        assert by_email[world["expired_a"]["email"]]["purge_eligible"] is True
        assert by_email[world["with_apps"]["email"]]["purge_eligible"] is False
        assert by_email[world["with_apps"]["email"]]["application_count"] == 1
        assert by_email[world["expiring"]["email"]]["status"] == "expiring"
        assert by_email[world["active"]["email"]]["status"] == "active"
        row = by_email[world["active"]["email"]]
        assert row["consent_basis"] == "legitimate_interest" and row["consent_date"] and row["last_activity_at"]

    def test_anonymized_people_show_as_anonymized(self, client, world):
        client.post(f"{CANDIDATES}/{world['active']['id']}/anonymize", json={"confirm": True})
        [item] = client.get(RET, params={"status": "anonymized"}).json()["items"]
        assert item["status"] == "anonymized" and item["first_name"] == "Anonymized" and item["anonymized_at"]

    def test_pagination(self, client, world):
        page1 = client.get(RET, params={"page_size": 2}).json()
        page3 = client.get(RET, params={"page_size": 2, "page": 3}).json()
        assert page1["total"] == 5 and len(page1["items"]) == 2 and len(page3["items"]) == 1
        ids = {i["id"] for p in (1, 2, 3) for i in client.get(RET, params={"page_size": 2, "page": p}).json()["items"]}
        assert len(ids) == 5

    def test_a_date_equal_to_today_is_not_yet_expired(self, client, session_factory):
        cand = person(client, session_factory, 1, 0)
        item = client.get(RET).json()["items"][0]
        assert item["id"] == cand["id"] and item["status"] == "expiring" and item["purge_eligible"] is False

    def test_opening_the_page_does_not_touch_retention_dates(self, client, world, session_factory):
        with session_factory() as db:
            before = {r.id: (r.retain_until, r.last_activity_at) for r in db.scalars(select(Candidate))}
        client.get(RET)
        client.get(RET, params={"status": "expired"})
        client.get(f"{CANDIDATES}/{world['expired_a']['id']}")  # even opening a profile
        with session_factory() as db:
            after = {r.id: (r.retain_until, r.last_activity_at) for r in db.scalars(select(Candidate))}
        assert before == after

    @pytest.mark.parametrize("params", [{"status": "bogus"}, {"page": 0}, {"page_size": 101}])
    def test_bad_parameters_are_422(self, client, params):
        assert client.get(RET, params=params).status_code == 422

    def test_the_retention_period_follows_the_setting(self, client, monkeypatch):
        monkeypatch.setattr(settings, "CANDIDATE_RETENTION_MONTHS", 6)
        assert client.get(RET).json()["summary"]["retention_months"] == 6


class TestPurgePreview:
    def test_a_dry_run_is_the_default_and_deletes_nothing(self, client, world, session_factory):
        res = client.post(PURGE, json={})
        body = res.json()
        assert res.status_code == 200 and body["dry_run"] is True and body["deleted"] == 0
        assert body["eligible_total"] == 2 and body["batch_size"] == 2
        assert set(body["candidate_ids"]) == {world["expired_a"]["id"], world["expired_b"]["id"]}
        assert count(session_factory) == 5

    def test_it_reports_who_is_protected_by_having_applications(self, client, world):
        assert client.post(PURGE, json={}).json()["expired_with_applications"] == 1

    def test_the_candidate_with_applications_is_never_in_the_batch(self, client, world):
        assert world["with_apps"]["id"] not in client.post(PURGE, json={}).json()["candidate_ids"]

    def test_the_preview_works_even_when_purging_is_switched_off(self, client, world):
        body = client.post(PURGE, json={"dry_run": True}).json()
        assert body["purge_enabled"] is False and body["eligible_total"] == 2

    def test_the_preview_is_open_to_hr_but_not_to_recruiters(self, client, client_as, world):
        assert client_as(UserRole.HR_MANAGER).post(PURGE, json={}).status_code == 200
        assert client_as(UserRole.RECRUITER).post(PURGE, json={}).status_code == 403

    def test_the_batch_is_bounded(self, client, session_factory):
        for n in range(1, 6):
            person(client, session_factory, n, -5)
        body = client.post(PURGE, json={"limit": 2}).json()
        assert body["batch_size"] == 2 and body["eligible_total"] == 5

    @pytest.mark.parametrize("limit", [0, 101, -1, "ten"])
    def test_limits_outside_the_range_are_422(self, client, limit):
        assert client.post(PURGE, json={"limit": limit}).status_code == 422

    def test_a_preview_writes_no_audit_events(self, client, world, session_factory):
        before = count(session_factory, "candidate_audit_events")
        client.post(PURGE, json={})
        assert count(session_factory, "candidate_audit_events") == before


class TestPurgeSafeguards:
    def real(self, c, **over):
        return c.post(PURGE, json={"dry_run": False, "confirm": "PURGE", **over})

    def test_off_by_default(self, client, world, session_factory):
        res = self.real(client)
        assert res.status_code == 409 and "PRIVACY_PURGE_ENABLED" in res.json()["detail"]
        assert count(session_factory) == 5

    def test_only_admins_may_delete(self, client_as, world, purge_on, session_factory):
        res = self.real(client_as(UserRole.HR_MANAGER))
        assert res.status_code == 403
        assert count(session_factory) == 5

    @pytest.mark.parametrize("confirm", [None, "", "purge", "PURGE ", "yes", "DELETE"])
    def test_the_exact_confirmation_word_is_required(self, client, world, purge_on, session_factory, confirm):
        res = client.post(PURGE, json={"dry_run": False, "confirm": confirm})
        assert res.status_code == 422 and "PURGE" in res.json()["detail"]
        assert count(session_factory) == 5

    def test_leaving_dry_run_out_never_deletes(self, client, world, purge_on, session_factory):
        assert client.post(PURGE, json={"confirm": "PURGE"}).json()["dry_run"] is True
        assert count(session_factory) == 5

    def test_recruiters_and_employees_cannot_even_try(self, client_as, world, purge_on):
        assert self.real(client_as(UserRole.RECRUITER)).status_code == 403

    def test_anonymous_gets_401(self, anon):
        assert anon.post(PURGE, json={"dry_run": False, "confirm": "PURGE"}).status_code == 401


class TestPurgeExecution:
    def real(self, c, **over):
        return c.post(PURGE, json={"dry_run": False, "confirm": "PURGE", **over})

    def test_deletes_only_expired_candidates_without_applications(self, client, world, purge_on, session_factory):
        res = self.real(client)
        body = res.json()
        assert res.status_code == 200 and body["deleted"] == 2 and body["dry_run"] is False
        assert set(body["candidate_ids"]) == {world["expired_a"]["id"], world["expired_b"]["id"]}
        assert body["remaining_eligible"] == 0
        for keep in ("expiring", "active", "with_apps"):
            assert client.get(f"{CANDIDATES}/{world[keep]['id']}").status_code == 200
        for gone in ("expired_a", "expired_b"):
            assert client.get(f"{CANDIDATES}/{world[gone]['id']}").status_code == 404

    def test_hiring_history_is_untouched(self, client, world, purge_on, session_factory):
        self.real(client)
        assert count(session_factory, "applications") == 1 and count(session_factory, "application_events") == 1
        assert client.get(APPS).json()["total"] == 1

    def test_running_it_again_is_harmless(self, client, world, purge_on, session_factory):
        assert self.real(client).json()["deleted"] == 2
        again = self.real(client).json()
        assert again["deleted"] == 0 and again["candidate_ids"] == [] and again["remaining_eligible"] == 0
        assert count(session_factory) == 3

    def test_work_is_done_in_bounded_batches(self, client, session_factory, purge_on):
        for n in range(1, 6):
            person(client, session_factory, n, -5)
        first = self.real(client, limit=2).json()
        assert first["deleted"] == 2 and first["remaining_eligible"] == 3
        assert count(session_factory) == 3
        assert self.real(client, limit=100).json()["deleted"] == 3

    def test_oldest_expiry_goes_first(self, client, session_factory, purge_on):
        newer = person(client, session_factory, 1, -2)
        older = person(client, session_factory, 2, -100)
        assert self.real(client, limit=1).json()["candidate_ids"] == [older["id"]]
        assert client.get(f"{CANDIDATES}/{newer['id']}").status_code == 200

    def test_an_application_created_after_the_preview_protects_the_candidate(self, client, session_factory, purge_on):
        cand = person(client, session_factory, 1, -10)
        preview = client.post(PURGE, json={}).json()
        assert cand["id"] in preview["candidate_ids"]
        job = open_job(client)
        # Someone applies the candidate to a job before the purge runs (their retention restarts too).
        assert apply(client, cand, job).status_code == 201
        set_retention(session_factory, cand["id"], -10)  # even if the date still looks expired
        assert self.real(client).json()["deleted"] == 0
        assert client.get(f"{CANDIDATES}/{cand['id']}").status_code == 200

    def test_a_race_between_selecting_and_deleting_cannot_delete_a_protected_candidate(
        self, client, session_factory, purge_on, monkeypatch
    ):
        """An application appears AFTER the batch was chosen but BEFORE the DELETE runs."""
        cand = person(client, session_factory, 1, -10)
        job = open_job(client)
        real_condition = privacy_service._purge_condition
        calls = {"n": 0}

        def racing(day):
            calls["n"] += 1
            if calls["n"] == 3:  # 1 = summary, 2 = choosing the batch, 3 = the DELETE itself
                from app.core import security

                now = security.utcnow()
                with session_factory() as other:
                    other.add(Application(candidate_id=uuid.UUID(cand["id"]), job_id=uuid.UUID(job["id"]),
                                          stage="applied", source="direct", applied_at=now, stage_changed_at=now))
                    other.commit()
            return real_condition(day)

        monkeypatch.setattr(privacy_service, "_purge_condition", racing)
        res = self.real(client).json()
        assert calls["n"] >= 3, "the race hook never fired"
        assert res["deleted"] == 0
        monkeypatch.undo()
        assert client.get(f"{CANDIDATES}/{cand['id']}").status_code == 200
        assert client.get(APPS, params={"candidate_id": cand["id"]}).json()["total"] == 1

    def test_anonymized_expired_shells_without_applications_can_be_purged(self, client, session_factory, purge_on):
        cand = person(client, session_factory, 1, -10)
        client.post(f"{CANDIDATES}/{cand['id']}/anonymize", json={"confirm": True})
        assert self.real(client).json()["deleted"] == 1

    def test_anonymized_candidates_with_applications_are_kept_for_statistics(self, client, session_factory, purge_on):
        app = make_application(client)
        client.post(f"{CANDIDATES}/{app['candidate']['id']}/anonymize", json={"confirm": True})
        set_retention(session_factory, app["candidate"]["id"], -10)
        assert self.real(client).json()["deleted"] == 0
        assert client.get(f"{APPS}/{app['id']}").status_code == 200


class TestPurgeAudit:
    def real(self, c, **over):
        return c.post(PURGE, json={"dry_run": False, "confirm": "PURGE", **over})

    def test_each_deletion_is_recorded_with_no_personal_data(self, client, world, purge_on, session_factory):
        self.real(client, limit=100)
        with session_factory() as db:
            events = db.scalars(select(CandidateAuditEvent).where(CandidateAuditEvent.event_type == AuditEventType.CANDIDATE_PURGED)).all()
        assert {str(e.candidate_id) for e in events} == {world["expired_a"]["id"], world["expired_b"]["id"]}
        assert all(e.actor_id == client.user.id for e in events)
        for e in events:
            assert set(e.event_metadata) == {"reason", "retain_until", "was_anonymized", "resumes_removed"}
            assert e.event_metadata["reason"] == "retention_expired"
        blob = json.dumps([e.event_metadata for e in events])
        assert world["expired_a"]["email"] not in blob and "Iqbal" not in blob

    def test_the_trail_outlives_the_candidate(self, client, world, purge_on, session_factory):
        gone = world["expired_a"]["id"]
        self.real(client)
        body = client.get("/api/v1/privacy/audit", params={"candidate_id": gone}).json()
        assert [e["event_type"] for e in body["items"]][0] == "candidate_purged"
        assert "candidate_created" in [e["event_type"] for e in body["items"]]

    def test_a_failed_audit_write_deletes_nothing(self, client, world, purge_on, session_factory, monkeypatch):
        from app.services import audit as audit_service

        monkeypatch.setattr(audit_service, "record", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
        with pytest.raises(RuntimeError):
            self.real(client)
        monkeypatch.undo()
        assert count(session_factory) == 5

    def test_a_real_run_with_nothing_to_do_records_nothing(self, client, session_factory, purge_on):
        before = count(session_factory, "candidate_audit_events")
        self.real(client)
        assert count(session_factory, "candidate_audit_events") == before
