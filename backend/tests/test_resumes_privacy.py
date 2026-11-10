"""Resumes and privacy: audit trail, anonymization, deletion, purge, export, retention."""

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select, text

from app.core.config import settings
from app.models.application import Application
from app.models.audit import CandidateAuditEvent
from app.models.candidate import Candidate
from app.models.resume import Resume, ResumeStatus
from app.services import privacy as privacy_service
from app.services import resume as resume_service
from tests.resume_files import CV_LINES, make_docx, make_pdf
from tests.test_applications import APPS, make_application, open_job
from tests.test_candidates import CANDIDATES, candidate_payload
from tests.test_resumes import DOCX, RESUMES, REVIEW, stored_files, upload

AUDIT = "/api/v1/privacy/audit"
PII = ["Ayesha Khan", "ayesha.khan@example.com", "+92 300 1234567", "FAST University", "Acme Technologies", "Globex",
       "Computer Science", "Senior Software Engineer", "Python", "ayesha", "khan", "Lahore"]


def pdf(n: int) -> bytes:
    return make_pdf([*CV_LINES, f"variant {n}"])


def events(session_factory, candidate_id: str | None = None) -> list[CandidateAuditEvent]:
    with session_factory() as db:
        rows = list(db.scalars(select(CandidateAuditEvent).order_by(CandidateAuditEvent.created_at)))
    return [r for r in rows if candidate_id is None or str(r.candidate_id) == candidate_id]


def kinds(session_factory, candidate_id: str) -> list[str]:
    return [e.event_type.value for e in events(session_factory, candidate_id)]


@pytest.fixture
def cand(client):
    return client.post(CANDIDATES, json=candidate_payload(1)).json()


class TestAuditTrail:
    def test_upload_records_uploaded_then_parsed(self, client, cand, session_factory):
        rid = upload(client, cand["id"]).json()["id"]
        evs = [e for e in events(session_factory, cand["id"]) if e.event_type.value.startswith("resume_")]
        assert [e.event_type.value for e in evs] == ["resume_uploaded", "resume_parsed"]
        assert evs[0].event_metadata == {"resume_id": rid, "version": 1, "extension": "pdf", "size_bytes": len(make_pdf(CV_LINES))}
        assert evs[1].event_metadata == {"resume_id": rid, "version": 1, "status": "parsed", "error_code": None}
        assert all(e.actor_id == client.user.id and e.request_id for e in evs)

    def test_every_action_is_recorded(self, client, cand, session_factory):
        a = upload(client, cand["id"], data=pdf(1)).json()["id"]
        b = upload(client, cand["id"], data=pdf(2)).json()["id"]
        client.get(f"{RESUMES}/{a}/parsed")
        client.get(f"{RESUMES}/{a}/download")
        client.put(f"{RESUMES}/{a}/review", json={**REVIEW, "name": "Corrected"})
        client.post(f"{RESUMES}/{a}/activate")
        client.patch(f"{RESUMES}/{a}", json={"application_id": None})  # no change: not logged
        client.post(f"{RESUMES}/{a}/parse")
        client.delete(f"{RESUMES}/{b}")
        got = kinds(session_factory, cand["id"])
        for expected in ("resume_uploaded", "resume_parsed", "resume_viewed", "resume_downloaded", "resume_reviewed", "resume_activated", "resume_deleted"):
            assert expected in got, expected
        assert got.count("resume_uploaded") == 2 and "resume_updated" not in got

    def test_a_retry_after_a_failure_is_its_own_event(self, client, cand, session_factory):
        import os

        rid = upload(client, cand["id"], data=b"%PDF-1.4\n" + os.urandom(2000)).json()["id"]
        client.post(f"{RESUMES}/{rid}/parse")
        assert "resume_parse_retried" in kinds(session_factory, cand["id"])
        failed = [e for e in events(session_factory, cand["id"]) if e.event_type.value == "resume_parsed"][0]
        assert failed.event_metadata["status"] == "failed" and failed.event_metadata["error_code"] == "corrupt"

    def test_review_records_which_fields_changed_never_their_values(self, client, cand, session_factory):
        rid = upload(client, cand["id"]).json()["id"]
        client.put(f"{RESUMES}/{rid}/review", json={**REVIEW, "name": "Totally Different Person", "skills": ["Cobol"]})
        ev = [e for e in events(session_factory, cand["id"]) if e.event_type.value == "resume_reviewed"][0]
        assert ev.event_metadata["changed_fields"] == ["name", "skills", "education", "experience"][: len(ev.event_metadata["changed_fields"])] or set(ev.event_metadata["changed_fields"]) >= {"name", "skills"}
        assert {"name", "skills"} <= set(ev.event_metadata["changed_fields"]) and ev.event_metadata["count"] == len(ev.event_metadata["changed_fields"])
        assert "Totally" not in json.dumps(ev.event_metadata) and "Cobol" not in json.dumps(ev.event_metadata)

    def test_saving_an_unchanged_review_reports_no_changed_fields_beyond_the_parsers_gaps(self, client, cand, session_factory):
        rid = upload(client, cand["id"]).json()["id"]
        parsed = client.get(f"{RESUMES}/{rid}/parsed").json()["parsed"]
        same = {"name": parsed["name"]["value"], "email": parsed["email"]["value"], "phone": parsed["phone"]["value"],
                "skills": parsed["skills"]["values"],
                "education": [{k: e[k] for k in ("institution", "degree", "field", "start_year", "end_year")} for e in parsed["education"]],
                "experience": [{k: e[k] for k in ("title", "company", "start", "end", "current")} for e in parsed["experience"]], "confirm": True}
        client.put(f"{RESUMES}/{rid}/review", json=same)
        ev = [e for e in events(session_factory, cand["id"]) if e.event_type.value == "resume_reviewed"][0]
        assert ev.event_metadata["changed_fields"] == [] and ev.event_metadata["count"] == 0

    def test_the_whole_audit_table_holds_no_resume_content_after_a_full_lifecycle(self, client, cand, session_factory):
        rid = upload(client, cand["id"], "Ayesha_Khan_CV.pdf").json()["id"]
        upload(client, cand["id"], "Ayesha_Khan_CV.docx", make_docx(CV_LINES), DOCX)
        client.get(f"{RESUMES}/{rid}/parsed")
        client.get(f"{RESUMES}/{rid}/download")
        client.put(f"{RESUMES}/{rid}/review", json={**REVIEW, "name": "Ayesha Khan"})
        client.post(f"{RESUMES}/{rid}/activate")
        client.post(f"{RESUMES}/{rid}/parse")
        client.delete(f"{RESUMES}/{rid}")
        with session_factory() as db:
            rows = db.execute(text("select event_type, candidate_id, metadata, request_id from candidate_audit_events")).all()
        dump = json.dumps([[str(c) for c in r] for r in rows]).lower()
        for secret in [*PII, "ayesha_khan_cv", ".pdf", ".docx", "%pdf"]:
            assert secret.lower() not in dump, secret

    def test_resume_events_are_readable_by_hr_and_filterable(self, client, client_as, cand):
        upload(client, cand["id"])
        hr = client_as(__import__("app.models.user", fromlist=["UserRole"]).UserRole.HR_MANAGER)
        body = hr.get(AUDIT, params={"event_type": "resume_uploaded", "candidate_id": cand["id"]}).json()
        assert body["total"] == 1 and body["items"][0]["event_type"] == "resume_uploaded"
        assert body["items"][0]["metadata"]["extension"] == "pdf" and "filename" not in json.dumps(body)

    def test_a_failed_upload_leaves_no_audit_event(self, client, cand, session_factory):
        before = len(events(session_factory))
        upload(client, cand["id"], "cv.pdf", b"MZ not a pdf")
        assert len(events(session_factory)) == before

    def test_a_refused_duplicate_logs_nothing(self, client, cand, session_factory):
        upload(client, cand["id"])
        before = len(events(session_factory))
        upload(client, cand["id"])
        assert len(events(session_factory)) == before

    def test_the_audit_metadata_guard_blocks_personal_keys_from_the_resume_code_paths(self):
        from app.services.audit import clean_metadata

        for key in ("name", "email", "phone", "text", "note", "filename", "original_filename", "content", "parsed_data"):
            with pytest.raises(ValueError):
                clean_metadata({key: "x"})


class TestAnonymization:
    def candidate_with_resumes(self, client, n=2):
        cand = client.post(CANDIDATES, json=candidate_payload(1, first_name="Ayesha", last_name="Khan")).json()
        ids = [upload(client, cand["id"], f"Ayesha_Khan_{i}.pdf", pdf(i)).json()["id"] for i in range(n)]
        for rid in ids:
            client.put(f"{RESUMES}/{rid}/review", json=REVIEW)
        return cand, ids

    def test_the_preview_says_how_many_files_would_be_deleted(self, client):
        cand, _ = self.candidate_with_resumes(client, 3)
        body = client.get(f"{CANDIDATES}/{cand['id']}/anonymization-preview").json()
        assert body["resumes_removed"] == 3

    def test_the_preview_for_someone_without_resumes_says_zero(self, client, cand):
        assert client.get(f"{CANDIDATES}/{cand['id']}/anonymization-preview").json()["resumes_removed"] == 0

    def test_anonymizing_deletes_every_resume_file(self, client):
        cand, _ = self.candidate_with_resumes(client)
        other = client.post(CANDIDATES, json=candidate_payload(2)).json()
        upload(client, other["id"], data=pdf(99))
        assert len(stored_files()) == 3
        assert client.post(f"{CANDIDATES}/{cand['id']}/anonymize", json={"confirm": True}).status_code == 200
        assert len(stored_files()) == 1  # only the other candidate's file remains
        assert client.get(f"{CANDIDATES}/{other['id']}/resumes").json()["total"] == 1

    def test_afterwards_no_resume_is_reachable_through_any_interface(self, client):
        cand, ids = self.candidate_with_resumes(client)
        client.post(f"{CANDIDATES}/{cand['id']}/anonymize", json={"confirm": True})
        assert client.get(f"{CANDIDATES}/{cand['id']}/resumes").json() == {"items": [], "total": 0, "page": 1, "page_size": 20}
        for rid in ids:
            for suffix in ("", "/parsed", "/download"):
                assert client.get(f"{RESUMES}/{rid}{suffix}").status_code == 404
            assert client.post(f"{RESUMES}/{rid}/parse").status_code == 404
            assert client.put(f"{RESUMES}/{rid}/review", json=REVIEW).status_code == 404
            assert client.post(f"{RESUMES}/{rid}/activate").status_code == 404

    def test_the_database_keeps_only_bare_tombstones(self, client, session_factory):
        cand, ids = self.candidate_with_resumes(client)
        client.post(f"{CANDIDATES}/{cand['id']}/anonymize", json={"confirm": True})
        with session_factory() as db:
            rows = db.scalars(select(Resume)).all()
            assert len(rows) == 2 and all(r.status == ResumeStatus.REMOVED for r in rows)
            for r in rows:
                assert (r.storage_key, r.sha256, r.parsed_data, r.reviewed_data, r.parse_error_code, r.text_chars) == (None,) * 6
                assert r.original_filename == "removed" and r.is_active is False and r.file_removed_at is not None
                assert r.reviewed_by_id is None
            blob = json.dumps([[str(getattr(r, c.name)) for c in Resume.__table__.columns] for r in rows]).lower()
        for secret in ("ayesha", "khan", "fast university", "example.com"):
            assert secret not in blob

    def test_anonymizing_records_how_many_files_were_removed(self, client, session_factory):
        cand, _ = self.candidate_with_resumes(client)
        client.post(f"{CANDIDATES}/{cand['id']}/anonymize", json={"confirm": True})
        ev = [e for e in events(session_factory, cand["id"]) if e.event_type.value == "candidate_anonymized"][0]
        assert ev.event_metadata["resumes_removed"] == 2

    def test_anonymizing_twice_does_nothing_more(self, client, session_factory):
        cand, _ = self.candidate_with_resumes(client)
        client.post(f"{CANDIDATES}/{cand['id']}/anonymize", json={"confirm": True})
        assert client.post(f"{CANDIDATES}/{cand['id']}/anonymize", json={"confirm": True}).json()["changed"] is False
        assert kinds(session_factory, cand["id"]).count("candidate_anonymized") == 1

    def test_application_history_survives(self, client):
        app = make_application(client)
        upload(client, app["candidate"]["id"], application_id=app["id"])
        client.post(f"{CANDIDATES}/{app['candidate']['id']}/anonymize", json={"confirm": True})
        body = client.get(f"{APPS}/{app['id']}").json()
        assert body["stage"] == "applied" and len(body["events"]) == 1 and stored_files() == []

    def test_a_file_that_could_not_be_deleted_is_found_and_removed_by_the_cleanup(self, client, session_factory, monkeypatch):
        cand, _ = self.candidate_with_resumes(client, 1)
        with monkeypatch.context() as m:
            m.setattr(Path, "unlink", lambda self, missing_ok=False: (_ for _ in ()).throw(PermissionError("locked")))
            assert client.post(f"{CANDIDATES}/{cand['id']}/anonymize", json={"confirm": True}).status_code == 200
        assert len(stored_files()) == 1  # the orphan the failed delete left behind
        with session_factory() as db:
            assert db.scalar(select(Resume.storage_key)) is None  # the database no longer refers to it
            assert resume_service.cleanup_orphans(db, dry_run=False)["removed"] == 1
        assert stored_files() == []

    def test_a_failed_audit_write_keeps_the_files_and_the_identity(self, client, session_factory, monkeypatch):
        from app.services import audit as audit_service

        cand, _ = self.candidate_with_resumes(client)
        with monkeypatch.context() as m:
            m.setattr(audit_service, "record", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("audit down")))
            with pytest.raises(RuntimeError):
                client.post(f"{CANDIDATES}/{cand['id']}/anonymize", json={"confirm": True})
        assert len(stored_files()) == 2 and client.get(f"{CANDIDATES}/{cand['id']}").json()["first_name"] == "Ayesha"
        assert client.get(f"{CANDIDATES}/{cand['id']}/resumes").json()["total"] == 2


class TestCandidateDeletion:
    def test_deleting_a_mistaken_candidate_removes_their_resumes_and_files(self, client, cand, session_factory):
        upload(client, cand["id"], data=pdf(1))
        upload(client, cand["id"], data=pdf(2))
        assert client.delete(f"{CANDIDATES}/{cand['id']}").status_code == 204
        assert stored_files() == []
        with session_factory() as db:
            assert db.scalar(text("select count(*) from resumes")) == 0
        ev = [e for e in events(session_factory, cand["id"]) if e.event_type.value == "candidate_deleted"][0]
        assert ev.event_metadata == {"resumes_removed": 2}

    def test_a_candidate_with_applications_is_still_protected_and_keeps_their_resumes(self, client):
        app = make_application(client)
        upload(client, app["candidate"]["id"])
        assert client.delete(f"{CANDIDATES}/{app['candidate']['id']}").status_code == 409
        assert len(stored_files()) == 1 and client.get(f"{CANDIDATES}/{app['candidate']['id']}/resumes").json()["total"] == 1

    def test_other_candidates_files_are_untouched(self, client, cand):
        other = client.post(CANDIDATES, json=candidate_payload(2)).json()
        upload(client, cand["id"], data=pdf(1))
        upload(client, other["id"], data=pdf(2))
        client.delete(f"{CANDIDATES}/{cand['id']}")
        assert len(stored_files()) == 1 and client.get(f"{CANDIDATES}/{other['id']}/resumes").json()["total"] == 1


def expire(session_factory, cid: str, days: int = -10):
    with session_factory() as db:
        db.get(Candidate, uuid.UUID(cid)).retain_until = datetime.now(UTC).date() + timedelta(days=days)
        db.commit()


@pytest.fixture
def purge_on(monkeypatch):
    monkeypatch.setattr(settings, "PRIVACY_PURGE_ENABLED", True)


class TestPurge:
    PURGE = "/api/v1/privacy/purge"

    def real(self, c, **over):
        return c.post(self.PURGE, json={"dry_run": False, "confirm": "PURGE", **over})

    def test_purging_an_expired_candidate_removes_their_resumes_and_files(self, client, cand, session_factory, purge_on):
        upload(client, cand["id"], data=pdf(1))
        upload(client, cand["id"], data=pdf(2))
        expire(session_factory, cand["id"])
        assert self.real(client).json()["deleted"] == 1
        assert stored_files() == []
        with session_factory() as db:
            assert db.scalar(text("select count(*) from resumes")) == 0
        ev = [e for e in events(session_factory, cand["id"]) if e.event_type.value == "candidate_purged"][0]
        assert ev.event_metadata["resumes_removed"] == 2 and set(ev.event_metadata) == {"reason", "retain_until", "was_anonymized", "resumes_removed"}

    def test_a_dry_run_touches_no_file(self, client, cand, session_factory, purge_on):
        upload(client, cand["id"])
        expire(session_factory, cand["id"])
        assert client.post(self.PURGE, json={}).json()["deleted"] == 0
        assert len(stored_files()) == 1 and client.get(f"{CANDIDATES}/{cand['id']}/resumes").json()["total"] == 1

    def test_an_expired_candidate_with_applications_keeps_everything(self, client, session_factory, purge_on):
        app = make_application(client)
        upload(client, app["candidate"]["id"])
        expire(session_factory, app["candidate"]["id"])
        assert self.real(client).json()["deleted"] == 0
        assert len(stored_files()) == 1

    def test_only_the_purged_candidates_files_go(self, client, cand, session_factory, purge_on):
        keep = client.post(CANDIDATES, json=candidate_payload(2)).json()
        upload(client, cand["id"], data=pdf(1))
        upload(client, keep["id"], data=pdf(2))
        expire(session_factory, cand["id"])
        self.real(client)
        assert len(stored_files()) == 1 and client.get(f"{CANDIDATES}/{keep['id']}/resumes").json()["total"] == 1

    def test_a_candidate_who_gains_an_application_mid_run_keeps_rows_and_files(self, client, cand, session_factory, purge_on, monkeypatch):
        upload(client, cand["id"])
        expire(session_factory, cand["id"])
        job = open_job(client)
        real_condition, calls = privacy_service._purge_condition, {"n": 0}

        def racing(day):
            calls["n"] += 1
            if calls["n"] == 3:  # the DELETE itself
                from app.core import security

                now = security.utcnow()
                with session_factory() as other:
                    other.add(Application(candidate_id=uuid.UUID(cand["id"]), job_id=uuid.UUID(job["id"]), stage="applied", source="direct", applied_at=now, stage_changed_at=now))
                    other.commit()
            return real_condition(day)

        with monkeypatch.context() as m:
            m.setattr(privacy_service, "_purge_condition", racing)
            assert self.real(client).json()["deleted"] == 0
        assert len(stored_files()) == 1 and client.get(f"{CANDIDATES}/{cand['id']}/resumes").json()["total"] == 1

    def test_a_file_that_cannot_be_deleted_does_not_undo_the_purge(self, client, cand, session_factory, purge_on, monkeypatch):
        upload(client, cand["id"])
        expire(session_factory, cand["id"])
        with monkeypatch.context() as m:
            m.setattr(Path, "unlink", lambda self, missing_ok=False: (_ for _ in ()).throw(PermissionError("locked")))
            assert self.real(client).json()["deleted"] == 1
        assert len(stored_files()) == 1
        with session_factory() as db:
            assert resume_service.cleanup_orphans(db, dry_run=False)["removed"] == 1
        assert stored_files() == []


class TestExportAndRetention:
    def test_json_export_lists_resume_metadata_without_names_hashes_or_contents(self, client, cand):
        upload(client, cand["id"], "Ayesha_Khan_CV.pdf")
        res = client.post(f"{CANDIDATES}/{cand['id']}/export", json={"format": "json"})
        [exported] = res.json()["candidates"]
        assert exported["resumes"] == [{"version": 1, "format": "pdf", "size_bytes": len(make_pdf(CV_LINES)), "uploaded_at": exported["resumes"][0]["uploaded_at"], "active": True, "status": "parsed"}]
        for secret in ("Ayesha_Khan_CV", "sha256", "storage", "Computer Science", "FAST University"):
            assert secret not in res.text

    def test_csv_export_is_unchanged(self, client, cand):
        from app.services.export import CSV_COLUMNS

        upload(client, cand["id"])
        header = client.post(f"{CANDIDATES}/{cand['id']}/export", json={"format": "csv"}).content.decode("utf-8-sig").splitlines()[0]
        assert header.split(",") == CSV_COLUMNS

    def test_an_exported_anonymized_candidate_lists_no_resumes(self, client, cand):
        upload(client, cand["id"])
        client.post(f"{CANDIDATES}/{cand['id']}/anonymize", json={"confirm": True})
        assert client.post(f"{CANDIDATES}/{cand['id']}/export", json={"format": "json"}).json()["candidates"][0]["resumes"] == []

    def test_uploading_a_resume_does_not_reset_retention(self, client, cand, session_factory):
        expire(session_factory, cand["id"], -5)
        upload(client, cand["id"])
        item = client.get("/api/v1/privacy/retention", params={"status": "expired"}).json()["items"][0]
        assert item["id"] == cand["id"] and item["status"] == "expired"

    def test_reviewing_and_parsing_do_not_reset_retention_either(self, client, cand, session_factory):
        rid = upload(client, cand["id"]).json()["id"]
        expire(session_factory, cand["id"], -5)
        client.put(f"{RESUMES}/{rid}/review", json=REVIEW)
        client.post(f"{RESUMES}/{rid}/parse")
        assert client.get("/api/v1/privacy/retention", params={"status": "expired"}).json()["total"] == 1


class TestNoOrphansAnywhere:
    def test_every_stored_file_is_referenced_after_a_busy_session(self, client, cand, session_factory):
        a = upload(client, cand["id"], data=pdf(1)).json()["id"]
        upload(client, cand["id"], data=pdf(2))
        upload(client, cand["id"], data=pdf(1))  # duplicate: refused
        upload(client, cand["id"], "x.pdf", b"MZ bad")  # refused
        client.delete(f"{RESUMES}/{a}")
        with session_factory() as db:
            result = resume_service.cleanup_orphans(db, dry_run=True)
        assert result["orphaned_files"] == 0 and result["stale_temp_files"] == 0 and len(stored_files()) == 1

    def test_cleanup_never_touches_referenced_files(self, client, cand, session_factory):
        upload(client, cand["id"])
        with session_factory() as db:
            assert resume_service.cleanup_orphans(db, dry_run=False)["removed"] == 0
        assert len(stored_files()) == 1 and client.get(f"{RESUMES}/{client.get(f'{CANDIDATES}/{cand[chr(105)+chr(100)]}/resumes').json()['items'][0]['id']}/download").status_code == 200
