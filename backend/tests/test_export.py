"""Exporting candidate data: content, safety of the file itself, limits, and the audit trail."""

import csv
import io
import json
import re
import uuid

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.audit import AuditEventType, CandidateAuditEvent
from app.models.candidate import Candidate
from app.models.user import UserRole
from app.services import audit as audit_service
from app.services.export import CSV_COLUMNS, csv_safe
from tests.test_applications import APPS, make_application, move
from tests.test_candidates import CANDIDATES, candidate_payload

BULK = f"{CANDIDATES}/export"


def one(c, cid, fmt="csv"):
    return c.post(f"{CANDIDATES}/{cid}/export", json={"format": fmt})


def bulk(c, **body):
    return c.post(BULK, json={"format": "csv", **body})


def parse(res) -> list[dict]:
    text = res.content.decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


class TestCsvSafetyHelper:
    @pytest.mark.parametrize("value", ["=1+1", "+1", "-1", "@SUM(A1)", "=cmd|' /C calc'!A0", "\t=1", "\r=1", "\n=1", "=HYPERLINK(\"http://evil\")"])
    def test_formula_starters_are_neutralised(self, value):
        assert csv_safe(value) == "'" + value

    @pytest.mark.parametrize("value", ["Ayesha", "a=b", "1+1", "x@y.com", " =space-first", "O'Brien", "", "0"])
    def test_ordinary_text_is_untouched(self, value):
        assert csv_safe(value) == value

    def test_none_and_non_strings(self):
        from datetime import date

        assert csv_safe(None) == "" and csv_safe(5) == "5" and csv_safe(True) == "True"
        assert csv_safe(date(2026, 1, 2)) == "2026-01-02"


class TestSingleExport:
    def test_csv_has_the_documented_columns_and_the_candidates_details(self, client):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        res = one(client, cand["id"])
        assert res.status_code == 200
        rows = parse(res)
        assert list(rows[0].keys()) == CSV_COLUMNS and len(rows) == 1
        row = rows[0]
        assert row["email"] == cand["email"] and row["first_name"] == cand["first_name"]
        assert row["consent_basis"] == "legitimate_interest" and row["anonymized"] == "False"
        assert row["application_count"] == "0"

    def test_json_includes_applications_with_job_stage_and_dates(self, client):
        app = make_application(client)
        move(client, app["id"], "screening")
        body = one(client, app["candidate"]["id"], "json").json()
        [cand] = body["candidates"]
        assert cand["email"] == app["candidate"]["email"] and body["exported_at"]
        [a] = cand["applications"]
        assert a["job_title"] == app["job"]["title"] and a["stage"] == "screening"
        assert set(a) == {
            "job_title", "stage", "source", "applied_at", "stage_changed_at",
            "requirements_coverage_assessments", "interviews",
        }
        assert a["requirements_coverage_assessments"] == []  # none made: the key is there, empty

    def test_staff_notes_and_internal_data_are_never_exported(self, client):
        app = make_application(client, internal_notes="CONFIDENTIAL-STAFF-OPINION")
        move(client, app["id"], "rejected", note="CONFIDENTIAL-REASON")
        for fmt in ("csv", "json"):
            text = one(client, app["candidate"]["id"], fmt).text
            for forbidden in ("CONFIDENTIAL", "password", "hash", "token", "internal_notes", "created_by", "actor"):
                assert forbidden not in text, (fmt, forbidden)

    def test_headers_are_safe(self, client):
        cand = client.post(CANDIDATES, json=candidate_payload(1, first_name="Évelyne")).json()
        res = one(client, cand["id"])
        assert res.headers["content-type"].startswith("text/csv")
        assert res.headers["cache-control"] == "no-store"
        assert res.headers["x-content-type-options"] == "nosniff"
        disposition = res.headers["content-disposition"]
        assert re.fullmatch(r'attachment; filename="candidates-\d{4}-\d{2}-\d{2}\.csv"', disposition)
        assert "velyne" not in disposition and cand["id"] not in disposition  # no names or ids in file names

    def test_json_content_type(self, client):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        res = one(client, cand["id"], "json")
        assert res.headers["content-type"].startswith("application/json")
        assert res.headers["content-disposition"].endswith('.json"')

    def test_formula_injection_in_every_text_field_is_defused_in_the_file(self, client):
        evil = "=cmd|' /C calc'!A0"
        cand = client.post(CANDIDATES, json=candidate_payload(
            1, first_name="=SUM(1)", last_name="+evil", current_title="@HYPERLINK", current_company=evil,
            location="-2+3", consent_basis="other", consent_basis_note="=1+1")).json()
        raw = one(client, cand["id"]).content.decode("utf-8-sig")
        row = parse(one(client, cand["id"]))[0]
        for field in ("first_name", "last_name", "current_title", "current_company", "location", "consent_basis_note"):
            assert row[field].startswith("'"), field
        # No cell of the raw file starts with a formula character.
        for line in csv.reader(io.StringIO(raw)):
            assert not any(cell[:1] in ("=", "+", "-", "@") for cell in line)

    def test_unicode_survives(self, client):
        cand = client.post(CANDIDATES, json=candidate_payload(1, first_name="Zoë", last_name="Łukasz", location="Zürich")).json()
        row = parse(one(client, cand["id"]))[0]
        assert (row["first_name"], row["last_name"], row["location"]) == ("Zoë", "Łukasz", "Zürich")

    def test_commas_quotes_and_newlines_stay_in_their_cell(self, client):
        cand = client.post(CANDIDATES, json=candidate_payload(1, current_company='Acme, "Best" Ltd')).json()
        assert parse(one(client, cand["id"]))[0]["current_company"] == 'Acme, "Best" Ltd'

    def test_an_anonymized_candidate_exports_only_placeholders(self, client):
        cand = client.post(CANDIDATES, json=candidate_payload(1, first_name="Zebulon", phone="+92 300 5550199")).json()
        client.post(f"{CANDIDATES}/{cand['id']}/anonymize", json={"confirm": True})
        res = one(client, cand["id"])
        row = parse(res)[0]
        assert row["anonymized"] == "True" and row["first_name"] == "Anonymized" and row["phone"] == ""
        assert "Zebulon" not in res.text and "5550199" not in res.text

    def test_unknown_or_malformed_ids(self, client):
        assert one(client, uuid.uuid4()).status_code == 404
        assert client.post(f"{CANDIDATES}/nope/export", json={"format": "csv"}).status_code == 422

    @pytest.mark.parametrize("body", [{"format": "xml"}, {"format": "CSV"}, {"format": 1}, {"format": "csv", "ids": []}])
    def test_bad_formats_are_422(self, client, body):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        assert client.post(f"{CANDIDATES}/{cand['id']}/export", json=body).status_code == 422


class TestBulkExport:
    @pytest.fixture
    def people(self, client):
        return [client.post(CANDIDATES, json=candidate_payload(n, source=src)).json()
                for n, src in enumerate(["linkedin", "referral", "agency", "linkedin"], start=1)]

    def test_exports_everyone_current(self, client, people):
        rows = parse(bulk(client))
        assert {r["email"] for r in rows} == {p["email"] for p in people}

    def test_filters_narrow_it(self, client, people):
        assert len(parse(bulk(client, source="linkedin"))) == 2

    def test_retention_filter(self, client, people, session_factory):
        from datetime import UTC, datetime, timedelta

        with session_factory() as db:
            db.get(Candidate, uuid.UUID(people[0]["id"])).retain_until = (datetime.now(UTC) - timedelta(days=2)).date()
            db.commit()
        rows = parse(bulk(client, retention="expired"))
        assert [r["email"] for r in rows] == [people[0]["email"]]

    def test_anonymized_people_are_left_out(self, client, people):
        client.post(f"{CANDIDATES}/{people[0]['id']}/anonymize", json={"confirm": True})
        assert len(parse(bulk(client))) == 3

    def test_an_empty_export_is_just_a_header(self, client):
        res = bulk(client)
        assert res.status_code == 200 and parse(res) == []

    def test_json_bulk(self, client, people):
        body = bulk(client, format="json").json()
        assert len(body["candidates"]) == 4 and all("applications" in c for c in body["candidates"])

    def test_too_large_an_export_is_refused_not_truncated(self, client, people, monkeypatch):
        monkeypatch.setattr(settings, "EXPORT_MAX_ROWS", 3)
        res = bulk(client)
        assert res.status_code == 422 and "more than 3 candidates" in res.json()["detail"]
        assert len(parse(bulk(client, source="linkedin"))) == 2  # a narrower one still works

    def test_exactly_at_the_limit_is_allowed(self, client, people, monkeypatch):
        monkeypatch.setattr(settings, "EXPORT_MAX_ROWS", 4)
        assert len(parse(bulk(client))) == 4

    def test_filters_travel_in_the_body_not_the_url(self, client, people):
        assert bulk(client, source="agency").status_code == 200
        assert client.get(BULK).status_code in (405, 422)  # no GET variant (which would put filters in URLs)

    @pytest.mark.parametrize("body", [{"source": "nonsense"}, {"retention": "forever"}, {"limit": 5}])
    def test_bad_filters_are_422(self, client, body):
        assert bulk(client, **body).status_code == 422


class TestAudit:
    def test_each_exported_candidate_is_recorded(self, client, session_factory):
        a = client.post(CANDIDATES, json=candidate_payload(1)).json()
        client.post(CANDIDATES, json=candidate_payload(2))
        one(client, a["id"], "json")
        bulk(client)
        with session_factory() as db:
            exported = db.scalars(select(CandidateAuditEvent).where(CandidateAuditEvent.event_type == AuditEventType.CANDIDATE_EXPORTED)).all()
        assert len(exported) == 3  # 1 single + 2 in the bulk
        assert {tuple(sorted(e.event_metadata.items())) for e in exported} == {
            (("format", "json"), ("scope", "single")), (("format", "csv"), ("scope", "bulk"))}
        assert all(e.actor_id == client.user.id for e in exported)

    def test_no_exported_content_is_logged(self, client, session_factory):
        cand = client.post(CANDIDATES, json=candidate_payload(1, first_name="Zebulon", phone="+92 300 5550199")).json()
        one(client, cand["id"])
        with session_factory() as db:
            dump = json.dumps([e.event_metadata for e in db.scalars(select(CandidateAuditEvent))])
        assert "Zebulon" not in dump and "5550199" not in dump and cand["email"] not in dump

    def test_a_failed_audit_write_means_no_file_is_returned(self, client, monkeypatch):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        monkeypatch.setattr(audit_service, "record", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
        with pytest.raises(RuntimeError):
            one(client, cand["id"])

    def test_a_refused_export_records_nothing(self, client, session_factory, monkeypatch):
        client.post(CANDIDATES, json=candidate_payload(1))
        client.post(CANDIDATES, json=candidate_payload(2))
        monkeypatch.setattr(settings, "EXPORT_MAX_ROWS", 1)
        with session_factory() as db:
            before = len(db.scalars(select(CandidateAuditEvent)).all())
        assert bulk(client).status_code == 422
        with session_factory() as db:
            assert len(db.scalars(select(CandidateAuditEvent)).all()) == before


class TestAccess:
    @pytest.mark.parametrize("role,expected", [(UserRole.ADMIN, 200), (UserRole.HR_MANAGER, 200), (UserRole.RECRUITER, 403), (UserRole.EMPLOYEE, 403)])
    def test_who_may_export(self, client, client_as, make_user, new_client, role, expected):
        from tests.conftest import sign_in

        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        if role == UserRole.EMPLOYEE:
            who = new_client()
            sign_in(who, make_user(role).email)
        else:
            who = client_as(role)
        assert one(who, cand["id"]).status_code == expected
        assert bulk(who).status_code == expected

    def test_a_forbidden_export_leaks_nothing_and_logs_nothing(self, client, client_as, session_factory):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        rec = client_as(UserRole.RECRUITER)
        res = one(rec, cand["id"])
        assert res.status_code == 403 and cand["email"] not in res.text
        with session_factory() as db:
            assert not db.scalars(select(CandidateAuditEvent).where(CandidateAuditEvent.event_type == AuditEventType.CANDIDATE_EXPORTED)).all()

    def test_anonymous_gets_401(self, anon):
        assert anon.post(BULK, json={"format": "csv"}).status_code == 401
        assert anon.post(f"{CANDIDATES}/{uuid.uuid4()}/export", json={"format": "csv"}).status_code == 401

    def test_there_is_no_public_download_url(self, anon, client):
        cand = client.post(CANDIDATES, json=candidate_payload(1)).json()
        for path in (f"{CANDIDATES}/{cand['id']}/export", BULK, f"{APPS}/export", "/api/v1/exports", "/api/v1/downloads"):
            assert anon.get(path).status_code in (401, 404, 405)
