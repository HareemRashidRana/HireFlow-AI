"""Resume uploads, validation, versions, parsing, review, download and deletion."""

import io
import json
import os
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.exceptions import StorageUnavailableError
from app.models.resume import Resume, ResumeStatus
from app.services import resume as resume_service
from app.services import resume_storage as storage
from tests.resume_files import (
    CV_LINES,
    docx_with_extra_part,
    make_docx,
    make_pdf,
    zip_bomb_docx,
)
from tests.test_applications import APPS, make_application
from tests.test_candidates import CANDIDATES, candidate_payload

PDF, DOCX = "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
RESUMES = "/api/v1/resumes"


def upload(c, candidate_id, name="cv.pdf", data=None, ctype=PDF, **form):
    data = make_pdf(CV_LINES) if data is None else data
    return c.post(f"{CANDIDATES}/{candidate_id}/resumes", files={"file": (name, data, ctype)}, data=form)


def stored_files() -> list[Path]:
    base = storage.root()
    return [p for p in base.rglob("*") if p.is_file()]


def tmp_files() -> list[Path]:
    return [p for p in (storage.root() / "tmp").iterdir()]


def other_pdf(n: int) -> bytes:
    return make_pdf([*CV_LINES, f"Distinct line {n}"])


@pytest.fixture
def cand(client):
    return client.post(CANDIDATES, json=candidate_payload(1)).json()


class TestValidUploads:
    def test_a_pdf_is_stored_parsed_and_made_active(self, client, cand):
        res = upload(client, cand["id"])
        assert res.status_code == 201, res.text
        body = res.json()
        assert body["status"] == "parsed" and body["version_number"] == 1 and body["is_active"] is True
        assert (body["extension"], body["mime_type"]) == ("pdf", PDF)
        assert body["original_filename"] == "cv.pdf" and body["size_bytes"] == len(make_pdf(CV_LINES))
        assert body["candidate_id"] == cand["id"] and body["uploaded_by"]["email"] == client.user.email
        assert body["parse_error_code"] is None and body["reviewed"] is False and body["application_id"] is None

    def test_a_docx_is_stored_and_parsed(self, client, cand):
        res = upload(client, cand["id"], "cv.docx", make_docx(CV_LINES), DOCX)
        assert res.status_code == 201 and res.json()["mime_type"] == DOCX and res.json()["status"] == "parsed"

    def test_the_extension_is_case_insensitive(self, client, cand):
        assert upload(client, cand["id"], "CV.PDF").status_code == 201

    def test_a_generic_browser_type_is_fine_because_only_the_content_decides(self, client, cand):
        assert upload(client, cand["id"], ctype="application/octet-stream").status_code == 201

    def test_the_file_lands_in_private_storage_under_a_random_key_not_its_name(self, client, cand):
        upload(client, cand["id"], "Ayesha_Khan_CV_2026.pdf")
        [path] = stored_files()
        assert path.name != "Ayesha_Khan_CV_2026.pdf" and len(path.name) == 32 and path.parent.name == path.name[:2]
        assert path.read_bytes() == make_pdf(CV_LINES)
        assert "Ayesha" not in str(path.relative_to(storage.root()))

    def test_the_response_never_exposes_paths_keys_hashes_text_or_parsed_data(self, client, cand):
        body = upload(client, cand["id"]).json()
        blob = json.dumps(body).lower()
        for forbidden in ("storage", "sha256", "path", "ayesha.khan@example.com", "+92 300", "parsed_data", "reviewed_data", str(storage.root()).lower().replace("\\", "/")):
            assert forbidden not in blob, forbidden
        assert set(body) == {"id", "candidate_id", "application_id", "version_number", "original_filename", "extension", "mime_type", "size_bytes", "status", "parse_error_code", "text_chars", "is_active", "created_at", "uploaded_by", "parsed_at", "reviewed_at", "reviewed_by", "file_removed_at", "reviewed"}

    def test_parsed_data_is_available_on_its_own_endpoint_with_confidence(self, client, cand):
        rid = upload(client, cand["id"]).json()["id"]
        body = client.get(f"{RESUMES}/{rid}/parsed").json()
        assert body["parsed"]["name"] == {"value": "Ayesha Khan", "confidence": "high"}
        assert body["parsed"]["email"]["value"] == "ayesha.khan@example.com"
        assert [j["title"] for j in body["parsed"]["experience"]][0] == "Senior Software Engineer"
        assert body["parsed"]["education"][0]["institution"] == "FAST University"
        assert body["reviewed"] is None and body["resume"]["id"] == rid

    def test_text_length_is_recorded_but_not_the_text(self, client, cand):
        body = upload(client, cand["id"]).json()
        assert body["text_chars"] > 100 and "text" not in body

    def test_uploading_never_changes_the_candidates_profile(self, client, cand):
        upload(client, cand["id"])
        after = client.get(f"{CANDIDATES}/{cand['id']}").json()
        for field in ("first_name", "last_name", "email", "phone", "location", "current_title", "current_company"):
            assert after[field] == cand[field]

    def test_uploading_does_not_extend_retention(self, client, cand):
        upload(client, cand["id"])
        after = client.get(f"{CANDIDATES}/{cand['id']}").json()
        assert (after["last_activity_at"], after["retain_until"]) == (cand["last_activity_at"], cand["retain_until"])

    def test_candidate_responses_carry_no_resume_data(self, client, cand):
        upload(client, cand["id"])
        for body in (client.get(f"{CANDIDATES}/{cand['id']}").text, client.get(CANDIDATES).text):
            assert "resume" not in body.lower() and "Computer Science" not in body


class TestRejectedUploads:
    @pytest.mark.parametrize("name", ["cv.txt", "cv.exe", "cv.doc", "cv", "cv.pdf.exe", "cv.docm", ".pdf", "cv.zip"])
    def test_other_extensions(self, client, cand, name):
        res = upload(client, cand["id"], name)
        assert res.status_code == 415 and stored_files() == [] and tmp_files() == []

    @pytest.mark.parametrize("ctype", ["text/plain", "image/png", "application/x-msdownload", "application/zip", "text/html", "application/javascript"])
    def test_a_clearly_wrong_declared_type_is_refused(self, client, cand, ctype):
        assert upload(client, cand["id"], ctype=ctype).status_code == 415

    @pytest.mark.parametrize("payload", [b"MZ\x90\x00\x03" + b"\0" * 200, b"#!/bin/sh\nrm -rf /", b"<html><script>alert(1)</script></html>", b"\x89PNG\r\n\x1a\n" + b"\0" * 50, b"GIF89a" + b"\0" * 50, b"just some text pretending to be a pdf"])
    def test_spoofed_content_with_a_pdf_name_and_pdf_mime_is_refused_by_its_signature(self, client, cand, payload):
        res = upload(client, cand["id"], "cv.pdf", payload, PDF)
        assert res.status_code == 415 and stored_files() == [] and tmp_files() == []
        assert client.get(f"{CANDIDATES}/{cand['id']}/resumes").json()["total"] == 0

    def test_a_pdf_renamed_to_docx_is_refused(self, client, cand):
        assert upload(client, cand["id"], "cv.docx", make_pdf(CV_LINES), DOCX).status_code == 415

    def test_a_docx_renamed_to_pdf_is_refused(self, client, cand):
        assert upload(client, cand["id"], "cv.pdf", make_docx(CV_LINES), PDF).status_code == 415

    def test_the_signature_must_be_at_the_very_start(self, client, cand):
        assert upload(client, cand["id"], "cv.pdf", b"junk" + make_pdf(CV_LINES)).status_code == 415

    def test_an_empty_file(self, client, cand):
        res = upload(client, cand["id"], data=b"")
        assert res.status_code == 422 and "empty" in res.json()["detail"]

    def test_a_file_over_the_limit(self, client, cand, monkeypatch):
        monkeypatch.setattr(settings, "RESUME_MAX_BYTES", 2000)
        res = upload(client, cand["id"], data=make_pdf(["x" * 200] * 30))
        assert res.status_code == 413 and "limit" in res.json()["detail"] and stored_files() == [] and tmp_files() == []

    def test_a_file_exactly_at_the_limit_is_accepted(self, client, cand, monkeypatch):
        data = make_pdf(CV_LINES)
        monkeypatch.setattr(settings, "RESUME_MAX_BYTES", len(data))
        assert upload(client, cand["id"], data=data).status_code == 201

    def test_a_far_oversized_request_is_refused_before_its_body_is_read(self, client, cand, monkeypatch):
        monkeypatch.setattr(settings, "RESUME_MAX_BYTES", 2000)
        res = upload(client, cand["id"], data=b"%PDF-" + b"0" * 500_000)
        assert res.status_code == 413 and stored_files() == [] and tmp_files() == []

    def test_a_docx_with_macros_is_refused(self, client, cand):
        data = docx_with_extra_part(make_docx(CV_LINES), "word/vbaProject.bin", b"macro")
        res = upload(client, cand["id"], "cv.docx", data, DOCX)
        assert res.status_code == 415 and "macro" in res.json()["detail"]

    def test_a_zip_bomb_docx_is_refused(self, client, cand):
        res = upload(client, cand["id"], "cv.docx", zip_bomb_docx(make_docx(CV_LINES)), DOCX)
        assert res.status_code == 422 and stored_files() == []

    @pytest.mark.parametrize("data", [b"PK\x03\x04 garbage not a zip", b"PK\x03\x04" + os.urandom(300)])
    def test_a_broken_docx_is_refused(self, client, cand, data):
        assert upload(client, cand["id"], "cv.docx", data, DOCX).status_code == 415

    def test_a_zip_that_is_not_a_word_document(self, client, cand):
        import zipfile

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("hello.txt", "hi")
        assert upload(client, cand["id"], "cv.docx", buf.getvalue(), DOCX).status_code == 415

    def test_failed_validation_leaves_no_row_and_no_file(self, client, cand, session_factory):
        upload(client, cand["id"], "cv.pdf", b"MZ....")
        with session_factory() as db:
            assert db.scalar(text("select count(*) from resumes")) == 0
        assert stored_files() == [] and tmp_files() == []

    def test_missing_file_field_is_422(self, client, cand):
        assert client.post(f"{CANDIDATES}/{cand['id']}/resumes", data={}).status_code == 422

    def test_unknown_candidate_is_404_and_leaves_nothing(self, client):
        assert upload(client, uuid.uuid4()).status_code == 404 and stored_files() == []
        assert client.post(f"{CANDIDATES}/not-a-uuid/resumes", files={"file": ("a.pdf", b"x", PDF)}).status_code in (404, 422)

    def test_an_anonymized_candidate_cannot_receive_resumes(self, client, cand):
        client.post(f"{CANDIDATES}/{cand['id']}/anonymize", json={"confirm": True})
        res = upload(client, cand["id"])
        assert res.status_code == 409 and "anonymized" in res.json()["detail"] and stored_files() == []


class TestFilenamesAndPaths:
    @pytest.mark.parametrize("name", ["../../evil.pdf", "..\\..\\evil.pdf", "C:\\Windows\\System32\\evil.pdf", "/etc/passwd.pdf", "a/b/c/cv.pdf", "..%2f..%2fevil.pdf", "cv\x00.exe.pdf", "cv\r\nX-Injected: 1.pdf"])
    def test_hostile_filenames_cannot_escape_or_inject(self, client, cand, name):
        before = {p for p in Path(storage.root()).parent.rglob("*") if p.is_file()}
        res = upload(client, cand["id"], name)
        assert res.status_code == 201, res.text
        shown = res.json()["original_filename"]
        assert "/" not in shown and "\\" not in shown and "\x00" not in shown and "\r" not in shown and "\n" not in shown
        new = {p for p in Path(storage.root()).parent.rglob("*") if p.is_file()} - before
        assert len(new) == 1 and storage.root() in next(iter(new)).parents  # only ever inside private storage
        assert not any("evil" in str(p) for p in new)

    def test_a_very_long_filename_is_cut(self, client, cand):
        res = upload(client, cand["id"], "a" * 400 + ".pdf")
        assert res.status_code == 201 and len(res.json()["original_filename"]) <= 255

    def test_the_filename_is_stored_only_as_display_text(self, client, cand, session_factory):
        upload(client, cand["id"], "../../etc/passwd.pdf")
        with session_factory() as db:
            row = db.scalar(select(Resume))
            assert row.original_filename == "passwd.pdf" and row.storage_key not in row.original_filename

    def test_the_download_name_never_contains_the_uploaded_name(self, client, cand):
        rid = upload(client, cand["id"], "Ayesha Khan CV; evil=1.pdf").json()["id"]
        disposition = client.get(f"{RESUMES}/{rid}/download").headers["content-disposition"]
        assert disposition == 'attachment; filename="resume-v1.pdf"'


class TestDuplicatesAndVersions:
    def test_the_same_file_twice_for_one_candidate_is_refused(self, client, cand):
        upload(client, cand["id"])
        res = upload(client, cand["id"], "renamed.pdf")
        assert res.status_code == 409 and "version 1" in res.json()["detail"]
        assert len(stored_files()) == 1 and client.get(f"{CANDIDATES}/{cand['id']}/resumes").json()["total"] == 1

    def test_the_same_file_for_another_candidate_is_fine(self, client, cand):
        other = client.post(CANDIDATES, json=candidate_payload(2)).json()
        assert upload(client, cand["id"]).status_code == 201 and upload(client, other["id"]).status_code == 201
        assert len(stored_files()) == 2

    def test_new_uploads_become_new_versions_and_the_active_one(self, client, cand):
        first = upload(client, cand["id"], data=other_pdf(1)).json()
        second = upload(client, cand["id"], data=other_pdf(2)).json()
        assert (first["version_number"], second["version_number"]) == (1, 2)
        listing = client.get(f"{CANDIDATES}/{cand['id']}/resumes").json()["items"]
        assert [(r["version_number"], r["is_active"]) for r in listing] == [(2, True), (1, False)]

    def test_only_one_resume_is_ever_active(self, client, cand):
        ids = [upload(client, cand["id"], data=other_pdf(n)).json()["id"] for n in range(4)]
        client.post(f"{RESUMES}/{ids[1]}/activate")
        items = client.get(f"{CANDIDATES}/{cand['id']}/resumes").json()["items"]
        assert [r["id"] for r in items if r["is_active"]] == [ids[1]]

    def test_activating_switches_the_active_resume(self, client, cand):
        v1 = upload(client, cand["id"], data=other_pdf(1)).json()["id"]
        upload(client, cand["id"], data=other_pdf(2))
        res = client.post(f"{RESUMES}/{v1}/activate")
        assert res.status_code == 200 and res.json()["is_active"] is True

    def test_versions_belong_to_one_candidate_each(self, client, cand):
        other = client.post(CANDIDATES, json=candidate_payload(2)).json()
        upload(client, cand["id"], data=other_pdf(1))
        assert upload(client, other["id"], data=other_pdf(2)).json()["version_number"] == 1
        assert [r["is_active"] for r in client.get(f"{CANDIDATES}/{cand['id']}/resumes").json()["items"]] == [True]

    def test_the_per_candidate_limit(self, client, cand, monkeypatch):
        monkeypatch.setattr(settings, "RESUME_MAX_PER_CANDIDATE", 2)
        upload(client, cand["id"], data=other_pdf(1))
        upload(client, cand["id"], data=other_pdf(2))
        res = upload(client, cand["id"], data=other_pdf(3))
        assert res.status_code == 422 and "at most 2" in res.json()["detail"]

    def test_listing_paginates_newest_first(self, client, cand):
        for n in range(5):
            upload(client, cand["id"], data=other_pdf(n))
        page = client.get(f"{CANDIDATES}/{cand['id']}/resumes", params={"page": 2, "page_size": 2}).json()
        assert page["total"] == 5 and [r["version_number"] for r in page["items"]] == [3, 2]

    @pytest.mark.parametrize("params", [{"page": 0}, {"page_size": 0}, {"page_size": 101}, {"application_id": "x"}])
    def test_bad_listing_parameters(self, client, cand, params):
        assert client.get(f"{CANDIDATES}/{cand['id']}/resumes", params=params).status_code == 422

    def test_listing_for_an_unknown_candidate_is_404(self, client):
        assert client.get(f"{CANDIDATES}/{uuid.uuid4()}/resumes").status_code == 404


class TestApplicationLinks:
    def test_a_resume_can_be_uploaded_for_one_of_the_candidates_applications(self, client):
        app = make_application(client)
        res = upload(client, app["candidate"]["id"], application_id=app["id"])
        assert res.status_code == 201 and res.json()["application_id"] == app["id"]

    def test_another_candidates_application_is_refused(self, client):
        mine, theirs = make_application(client, 1), make_application(client, 2)
        res = upload(client, mine["candidate"]["id"], application_id=theirs["id"])
        assert res.status_code == 422 and stored_files() == []
        assert theirs["candidate"]["email"] not in res.text

    def test_an_unknown_application_is_refused_with_the_same_answer(self, client, cand):
        unknown = upload(client, cand["id"], application_id=str(uuid.uuid4()))
        assert unknown.status_code == 422

    def test_link_and_unlink_later(self, client):
        app = make_application(client)
        rid = upload(client, app["candidate"]["id"]).json()["id"]
        assert client.patch(f"{RESUMES}/{rid}", json={"application_id": app["id"]}).json()["application_id"] == app["id"]
        assert client.patch(f"{RESUMES}/{rid}", json={"application_id": None}).json()["application_id"] is None

    def test_linking_to_someone_elses_application_is_refused(self, client):
        mine, theirs = make_application(client, 1), make_application(client, 2)
        rid = upload(client, mine["candidate"]["id"]).json()["id"]
        assert client.patch(f"{RESUMES}/{rid}", json={"application_id": theirs["id"]}).status_code == 422
        assert client.get(f"{RESUMES}/{rid}").json()["application_id"] is None

    def test_the_list_can_be_filtered_by_application(self, client):
        app = make_application(client)
        a = upload(client, app["candidate"]["id"], data=other_pdf(1), application_id=app["id"]).json()["id"]
        upload(client, app["candidate"]["id"], data=other_pdf(2))
        items = client.get(f"{CANDIDATES}/{app['candidate']['id']}/resumes", params={"application_id": app["id"]}).json()["items"]
        assert [r["id"] for r in items] == [a]

    def test_extra_fields_in_the_link_body_are_refused(self, client, cand):
        rid = upload(client, cand["id"]).json()["id"]
        assert client.patch(f"{RESUMES}/{rid}", json={"application_id": None, "is_active": True}).status_code == 422

    def test_resumes_do_not_change_an_applications_stage_or_history(self, client):
        app = make_application(client)
        upload(client, app["candidate"]["id"], application_id=app["id"])
        after = client.get(f"{APPS}/{app['id']}").json()
        assert after["stage"] == "applied" and len(after["events"]) == 1

    def test_deleting_the_link_target_cannot_happen_so_history_is_safe(self, client, session_factory):
        app = make_application(client)
        rid = upload(client, app["candidate"]["id"], application_id=app["id"]).json()["id"]
        with session_factory() as db, pytest.raises(IntegrityError):
            db.execute(text("delete from applications where id = :a"), {"a": uuid.UUID(app["id"]).hex})
        assert client.get(f"{RESUMES}/{rid}").status_code == 200


class TestParsingStates:
    def test_an_image_only_pdf_is_flagged_not_invented(self, client, cand):
        body = upload(client, cand["id"], data=make_pdf(None)).json()
        assert body["status"] == "no_text" and body["parse_error_code"] == "ocr_unavailable" and body["text_chars"] == 0
        parsed = client.get(f"{RESUMES}/{body['id']}/parsed").json()
        assert parsed["parsed"] is None

    def test_an_empty_word_document(self, client, cand):
        body = upload(client, cand["id"], "e.docx", make_docx([]), DOCX).json()
        assert body["status"] == "no_text"

    def test_a_corrupt_pdf_is_stored_but_marked_failed_with_a_code(self, client, cand):
        res = upload(client, cand["id"], data=b"%PDF-1.4\n" + os.urandom(3000))
        assert res.status_code == 201
        assert res.json()["status"] == "failed" and res.json()["parse_error_code"] == "corrupt"

    def test_retrying_a_failed_parse_after_the_file_is_fixed(self, client, cand, session_factory):
        rid = upload(client, cand["id"], data=b"%PDF-1.4\n" + os.urandom(3000)).json()["id"]
        with session_factory() as db:
            key = db.get(Resume, uuid.UUID(rid)).storage_key
        storage.path_for(key).write_bytes(make_pdf(CV_LINES))  # a repaired file in the same place
        res = client.post(f"{RESUMES}/{rid}/parse")
        assert res.status_code == 200 and res.json()["status"] == "parsed" and res.json()["parse_error_code"] is None
        assert client.get(f"{RESUMES}/{rid}/parsed").json()["parsed"]["name"]["value"] == "Ayesha Khan"

    def test_a_retry_of_a_still_broken_file_fails_again_cleanly(self, client, cand):
        rid = upload(client, cand["id"], data=b"%PDF-1.4\n" + os.urandom(3000)).json()["id"]
        res = client.post(f"{RESUMES}/{rid}/parse")
        assert res.status_code == 200 and res.json()["status"] == "failed"

    def test_reparsing_a_good_resume_is_allowed_and_idempotent(self, client, cand):
        rid = upload(client, cand["id"]).json()["id"]
        before = client.get(f"{RESUMES}/{rid}/parsed").json()["parsed"]
        assert client.post(f"{RESUMES}/{rid}/parse").json()["status"] == "parsed"
        assert client.get(f"{RESUMES}/{rid}/parsed").json()["parsed"] == before

    def test_a_missing_file_is_a_coded_failure_not_a_crash(self, client, cand, session_factory):
        rid = upload(client, cand["id"]).json()["id"]
        with session_factory() as db:
            storage.path_for(db.get(Resume, uuid.UUID(rid)).storage_key).unlink()
        res = client.post(f"{RESUMES}/{rid}/parse")
        assert res.status_code == 200 and res.json()["parse_error_code"] == "file_missing"

    def test_an_unexpected_parser_crash_becomes_a_coded_failure(self, client, cand, monkeypatch):
        from app.services import resume_parser

        rid = upload(client, cand["id"]).json()["id"]
        monkeypatch.setattr(resume_parser, "parse_resume", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("secret internals")))
        res = client.post(f"{RESUMES}/{rid}/parse")
        assert res.status_code == 200 and res.json()["status"] == "failed" and res.json()["parse_error_code"] == "parser_error"
        assert "secret internals" not in res.text

    def test_two_simultaneous_parses_cannot_both_run(self, client, cand, session_factory):
        rid = upload(client, cand["id"]).json()["id"]
        with session_factory() as db:
            db.execute(text("update resumes set status = 'processing'"))
            db.commit()
        res = client.post(f"{RESUMES}/{rid}/parse")
        assert res.status_code == 409 and "already being processed" in res.json()["detail"]

    def test_a_stuck_processing_state_can_be_retried_after_a_while(self, client, cand, session_factory):
        from datetime import UTC, datetime, timedelta

        rid = upload(client, cand["id"]).json()["id"]
        with session_factory() as db:
            row = db.get(Resume, uuid.UUID(rid))
            row.status = ResumeStatus.PROCESSING
            row.updated_at = datetime.now(UTC) - timedelta(minutes=30)
            db.commit()
        assert client.post(f"{RESUMES}/{rid}/parse").json()["status"] == "parsed"

    def test_parsing_never_changes_the_candidate_profile(self, client, cand):
        rid = upload(client, cand["id"]).json()["id"]
        client.post(f"{RESUMES}/{rid}/parse")
        after = client.get(f"{CANDIDATES}/{cand['id']}").json()
        assert after["email"] == cand["email"] and after["first_name"] == cand["first_name"]

    def test_the_text_character_limit_is_reported_as_a_warning(self, client, cand, monkeypatch):
        monkeypatch.setattr(settings, "RESUME_MAX_TEXT_CHARS", 1000)
        rid = upload(client, cand["id"], data=make_pdf([f"A line of resume text number {i}" for i in range(200)])).json()["id"]
        assert "text_truncated" in client.get(f"{RESUMES}/{rid}/parsed").json()["parsed"]["warnings"]


REVIEW = {
    "name": "Ayesha Khan", "email": "ayesha.khan@example.com", "phone": "+92 300 1234567",
    "skills": ["Python", "SQL"],
    "education": [{"institution": "FAST University", "degree": "BS", "field": "Computer Science", "start_year": 2014, "end_year": 2018}],
    "experience": [{"title": "Engineer", "company": "Acme Ltd", "start": "2021-01", "end": None, "current": True}],
    "confirm": True,
}


class TestReview:
    def test_saving_a_review_keeps_what_the_parser_found_separate(self, client, cand):
        rid = upload(client, cand["id"]).json()["id"]
        original = client.get(f"{RESUMES}/{rid}/parsed").json()["parsed"]
        res = client.put(f"{RESUMES}/{rid}/review", json={**REVIEW, "name": "Ayesha K. Khan", "skills": ["Python"]})
        assert res.status_code == 200 and res.json()["reviewed"] is True and res.json()["reviewed_by"]["email"] == client.user.email
        body = client.get(f"{RESUMES}/{rid}/parsed").json()
        assert body["parsed"] == original  # the machine output is untouched
        assert body["reviewed"]["name"] == "Ayesha K. Khan" and body["reviewed"]["skills"] == ["Python"]

    def test_a_review_never_touches_the_candidate_profile(self, client, cand):
        rid = upload(client, cand["id"]).json()["id"]
        client.put(f"{RESUMES}/{rid}/review", json={**REVIEW, "name": "Someone Else", "email": "other@example.com", "phone": "+1 555 0100"})
        after = client.get(f"{CANDIDATES}/{cand['id']}").json()
        assert (after["first_name"], after["last_name"], after["email"], after["phone"]) == (cand["first_name"], cand["last_name"], cand["email"], cand["phone"])

    def test_explicit_confirmation_is_required(self, client, cand):
        rid = upload(client, cand["id"]).json()["id"]
        for body in ({**REVIEW, "confirm": False}, {k: v for k, v in REVIEW.items() if k != "confirm"}, {**REVIEW, "confirm": "yes"}):
            assert client.put(f"{RESUMES}/{rid}/review", json=body).status_code == 422
        assert client.get(f"{RESUMES}/{rid}").json()["reviewed"] is False

    @pytest.mark.parametrize("patch", [
        {"email": "not-an-email"}, {"skills": ["x"] * 101}, {"skills": ["a" * 61]}, {"skills": [""]},
        {"education": [{"start_year": 1800}]}, {"education": [{"end_year": 3000}]},
        {"experience": [{"start": "2021-13"}]}, {"experience": [{"start": "Jan 2021"}]},
        {"experience": [{"title": "t" * 151}]}, {"education": [{}] * 21}, {"experience": [{}] * 31},
        {"name": "n" * 101}, {"phone": "9" * 31}, {"unknown": "field"}, {"education": [{"extra": 1}]},
    ])
    def test_invalid_review_data_is_refused(self, client, cand, patch):
        rid = upload(client, cand["id"]).json()["id"]
        assert client.put(f"{RESUMES}/{rid}/review", json={**REVIEW, **patch}).status_code == 422
        assert client.get(f"{RESUMES}/{rid}").json()["reviewed"] is False

    def test_blank_values_become_nothing(self, client, cand):
        rid = upload(client, cand["id"]).json()["id"]
        client.put(f"{RESUMES}/{rid}/review", json={**REVIEW, "name": "   ", "email": "", "phone": None})
        rev = client.get(f"{RESUMES}/{rid}/parsed").json()["reviewed"]
        assert rev["name"] is None and rev["email"] is None and rev["phone"] is None

    def test_a_person_can_enter_data_by_hand_when_parsing_failed(self, client, cand):
        rid = upload(client, cand["id"], data=b"%PDF-1.4\n" + os.urandom(2000)).json()["id"]
        assert client.put(f"{RESUMES}/{rid}/review", json=REVIEW).status_code == 200
        assert client.get(f"{RESUMES}/{rid}/parsed").json()["reviewed"]["name"] == "Ayesha Khan"

    def test_reparsing_keeps_the_reviewed_data(self, client, cand):
        rid = upload(client, cand["id"]).json()["id"]
        client.put(f"{RESUMES}/{rid}/review", json={**REVIEW, "name": "Corrected Name"})
        client.post(f"{RESUMES}/{rid}/parse")
        assert client.get(f"{RESUMES}/{rid}/parsed").json()["reviewed"]["name"] == "Corrected Name"

    def test_text_is_stored_trimmed(self, client, cand):
        rid = upload(client, cand["id"]).json()["id"]
        client.put(f"{RESUMES}/{rid}/review", json={**REVIEW, "name": "  Spaced Name  ", "skills": ["  Python  "]})
        rev = client.get(f"{RESUMES}/{rid}/parsed").json()["reviewed"]
        assert rev["name"] == "Spaced Name" and rev["skills"] == ["Python"]

    def test_script_text_is_just_stored_as_text(self, client, cand):
        rid = upload(client, cand["id"]).json()["id"]
        res = client.put(f"{RESUMES}/{rid}/review", json={**REVIEW, "name": "<script>alert(1)</script>"})
        assert res.status_code == 200
        assert client.get(f"{RESUMES}/{rid}/parsed").json()["reviewed"]["name"] == "<script>alert(1)</script>"


class TestDownload:
    def test_the_exact_bytes_come_back_with_safe_headers(self, client, cand):
        data = make_pdf(CV_LINES)
        rid = upload(client, cand["id"], "private name.pdf", data).json()["id"]
        res = client.get(f"{RESUMES}/{rid}/download")
        assert res.status_code == 200 and res.content == data
        assert res.headers["content-type"] == PDF
        assert res.headers["content-disposition"] == 'attachment; filename="resume-v1.pdf"'
        assert res.headers["cache-control"] == "no-store" and res.headers["x-content-type-options"] == "nosniff"
        assert res.headers["content-length"] == str(len(data))

    def test_a_docx_download(self, client, cand):
        data = make_docx(CV_LINES)
        rid = upload(client, cand["id"], "cv.docx", data, DOCX).json()["id"]
        res = client.get(f"{RESUMES}/{rid}/download")
        assert res.content == data and res.headers["content-type"] == DOCX
        assert res.headers["content-disposition"].endswith('resume-v1.docx"')

    def test_a_missing_file_is_a_clear_404_and_is_not_logged_as_a_download(self, client, cand, session_factory):
        rid = upload(client, cand["id"]).json()["id"]
        with session_factory() as db:
            storage.path_for(db.get(Resume, uuid.UUID(rid)).storage_key).unlink()
            before = db.scalar(text("select count(*) from candidate_audit_events where event_type = 'resume_downloaded'"))
        res = client.get(f"{RESUMES}/{rid}/download")
        assert res.status_code == 404 and "no longer available" in res.json()["detail"]
        assert str(storage.root()) not in res.text
        with session_factory() as db:
            assert db.scalar(text("select count(*) from candidate_audit_events where event_type = 'resume_downloaded'")) == before

    def test_unknown_and_malformed_ids(self, client):
        assert client.get(f"{RESUMES}/{uuid.uuid4()}/download").status_code == 404
        assert client.get(f"{RESUMES}/nope/download").status_code == 422

    def test_there_is_no_static_or_public_route_to_the_files(self, anon, client, cand):
        rid = upload(client, cand["id"]).json()["id"]
        [path] = stored_files()
        for url in (f"/storage/{path.name}", f"/static/{path.name}", f"/uploads/{path.name}", f"/files/{path.name}", f"/api/v1/files/{path.name}", f"/{path.name}"):
            assert anon.get(url).status_code in (401, 404, 405)
        assert anon.get(f"{RESUMES}/{rid}/download").status_code == 401


class TestDeletion:
    def test_deleting_removes_the_row_and_the_file(self, client, cand):
        rid = upload(client, cand["id"]).json()["id"]
        assert len(stored_files()) == 1
        assert client.delete(f"{RESUMES}/{rid}").status_code == 204
        assert stored_files() == [] and client.get(f"{RESUMES}/{rid}").status_code == 404
        assert client.get(f"{CANDIDATES}/{cand['id']}/resumes").json()["total"] == 0

    def test_deleting_the_active_resume_promotes_the_newest_remaining(self, client, cand):
        v1 = upload(client, cand["id"], data=other_pdf(1)).json()["id"]
        v2 = upload(client, cand["id"], data=other_pdf(2)).json()["id"]
        v3 = upload(client, cand["id"], data=other_pdf(3)).json()["id"]
        client.delete(f"{RESUMES}/{v3}")
        items = {r["id"]: r["is_active"] for r in client.get(f"{CANDIDATES}/{cand['id']}/resumes").json()["items"]}
        assert items == {v2: True, v1: False}

    def test_deleting_an_inactive_resume_keeps_the_active_one(self, client, cand):
        v1 = upload(client, cand["id"], data=other_pdf(1)).json()["id"]
        v2 = upload(client, cand["id"], data=other_pdf(2)).json()["id"]
        client.delete(f"{RESUMES}/{v1}")
        assert client.get(f"{RESUMES}/{v2}").json()["is_active"] is True

    def test_only_that_resumes_file_is_removed(self, client, cand):
        a = upload(client, cand["id"], data=other_pdf(1)).json()["id"]
        upload(client, cand["id"], data=other_pdf(2))
        client.delete(f"{RESUMES}/{a}")
        assert len(stored_files()) == 1

    def test_a_deleted_version_number_is_not_reused_by_the_next_upload_of_the_same_file(self, client, cand):
        a = upload(client, cand["id"], data=other_pdf(1)).json()["id"]
        client.delete(f"{RESUMES}/{a}")
        assert upload(client, cand["id"], data=other_pdf(1)).status_code == 201  # no longer a duplicate

    def test_deleting_twice_is_a_clean_404(self, client, cand):
        rid = upload(client, cand["id"]).json()["id"]
        client.delete(f"{RESUMES}/{rid}")
        assert client.delete(f"{RESUMES}/{rid}").status_code == 404

    def test_a_file_that_cannot_be_removed_leaves_an_orphan_not_a_dangling_row(self, client, cand, monkeypatch):
        rid = upload(client, cand["id"]).json()["id"]
        with monkeypatch.context() as m:  # scoped: must not undo the storage-isolation fixture
            m.setattr(Path, "unlink", lambda self, missing_ok=False: (_ for _ in ()).throw(PermissionError("locked")))
            assert client.delete(f"{RESUMES}/{rid}").status_code == 204
        assert client.get(f"{RESUMES}/{rid}").status_code == 404 and len(stored_files()) == 1

    def test_orphans_can_be_found_and_removed(self, client, cand, session_factory):
        upload(client, cand["id"])
        stray = storage.new_key()
        storage.commit(storage.receive(io.BytesIO(b"stray"), 100).tmp_path, stray)
        with session_factory() as db:
            dry = resume_service.cleanup_orphans(db, dry_run=True)
            assert dry["orphaned_files"] == 1 and dry["removed"] == 0 and storage.path_for(stray).exists()
            real = resume_service.cleanup_orphans(db, dry_run=False)
            assert real["removed"] == 1
        assert not storage.path_for(stray).exists() and len(stored_files()) == 1  # the referenced file stays


class TestRacesAndFailures:
    @pytest.mark.parametrize("where", ["flush", "commit"])
    def test_a_version_number_race_is_retried_transparently(self, client, cand, session_factory, where):
        """A constraint fires once (as a concurrent upload would cause); the retry succeeds."""
        with session_factory() as db:
            from app.models.user import User

            actor = db.scalar(select(User))
            real, calls = getattr(db, where), {"n": 0}

            def flaky(*a, **k):
                calls["n"] += 1
                if calls["n"] == 1:
                    db.rollback()
                    raise IntegrityError("insert", {}, Exception("uq_resumes_candidate_id_version"))
                return real(*a, **k)

            setattr(db, where, flaky)
            resume = resume_service.upload_resume(
                db, actor, uuid.UUID(cand["id"]), stream=io.BytesIO(make_pdf(CV_LINES)),
                filename="cv.pdf", declared_type=PDF,
            )
            assert resume.version_number == 1 and len(stored_files()) == 1 and calls["n"] >= 2
        assert client.get(f"{CANDIDATES}/{cand['id']}/resumes").json()["total"] == 1

    def test_losing_a_race_with_the_same_file_is_a_clean_409_not_a_500_and_leaves_no_orphan(
        self, client, cand, session_factory
    ):
        """Two people upload the SAME file at once: the other upload lands between our duplicate
        check and our insert, so the database constraint decides. We must answer 409 and tidy up."""
        from app.core.exceptions import ConflictError
        from app.models.user import User

        data = make_pdf(CV_LINES)
        with session_factory() as db:
            actor = db.scalar(select(User))
            real, state = db.flush, {"raced": False}

            def flush_after_rival_wins(*a, **k):
                if not state["raced"]:
                    state["raced"] = True
                    assert upload(client, cand["id"], data=data).status_code == 201  # the rival
                    db.rollback()
                    raise IntegrityError("insert", {}, Exception("uq_resumes_candidate_id_sha256"))
                return real(*a, **k)

            db.flush = flush_after_rival_wins  # type: ignore[method-assign]
            with pytest.raises(ConflictError) as err:
                resume_service.upload_resume(
                    db, actor, uuid.UUID(cand["id"]), stream=io.BytesIO(data), filename="cv.pdf", declared_type=PDF
                )
            assert "already uploaded" in str(err.value)
        assert len(stored_files()) == 1  # only the rival's file; ours was removed
        assert client.get(f"{CANDIDATES}/{cand['id']}/resumes").json()["total"] == 1

    def test_persistent_clashes_give_up_with_a_clear_409_and_no_orphan(self, client, cand, session_factory):
        with session_factory() as db:
            from app.models.user import User

            actor = db.scalar(select(User))

            def always(*a, **k):
                db.rollback()
                raise IntegrityError("insert", {}, Exception("clash"))

            db.flush = always  # type: ignore[method-assign]
            from app.core.exceptions import ConflictError

            with pytest.raises(ConflictError) as err:
                resume_service.upload_resume(db, actor, uuid.UUID(cand["id"]), stream=io.BytesIO(make_pdf(CV_LINES)),
                                             filename="cv.pdf", declared_type=PDF)
            assert "simultaneous" in str(err.value)
        assert stored_files() == []

    def test_the_same_file_racing_in_twice_is_a_409_and_leaves_no_orphan(self, client, cand, session_factory, monkeypatch):
        """The duplicate appears after the pre-check passed but before our insert."""
        original_commit = storage.commit

        def commit_then_rival(tmp_path, key):
            original_commit(tmp_path, key)
            with session_factory() as other:
                other.add(Resume(
                    candidate_id=uuid.UUID(cand["id"]), version_number=1, original_filename="rival.pdf",
                    storage_key=storage.new_key(), mime_type=PDF, extension="pdf", size_bytes=10,
                    sha256=__import__("hashlib").sha256(make_pdf(CV_LINES)).hexdigest(), status=ResumeStatus.PENDING, is_active=True))
                other.commit()

        monkeypatch.setattr(storage, "commit", commit_then_rival)
        res = upload(client, cand["id"])
        assert res.status_code == 409
        assert stored_files() == []  # the file we moved into place was cleaned up again

    def test_a_filesystem_failure_while_storing_is_a_503_with_nothing_left(self, client, cand, session_factory, monkeypatch):
        def boom(tmp_path, key):
            storage.discard(tmp_path)
            raise StorageUnavailableError("File storage is unavailable right now.")

        monkeypatch.setattr(storage, "commit", boom)
        res = upload(client, cand["id"])
        assert res.status_code == 503 and "unavailable" in res.json()["detail"]
        assert str(storage.root()) not in res.text
        with session_factory() as db:
            assert db.scalar(text("select count(*) from resumes")) == 0
        assert stored_files() == [] and tmp_files() == []

    def test_a_failure_while_receiving_the_upload_is_a_503(self, client, cand, monkeypatch):
        import tempfile

        monkeypatch.setattr(tempfile, "mkstemp", lambda **k: (_ for _ in ()).throw(OSError("disk full")))
        assert upload(client, cand["id"]).status_code == 503
        assert stored_files() == []

    def test_a_database_failure_after_storing_removes_the_file(self, client, cand, monkeypatch):
        monkeypatch.setattr(resume_service, "_insert_version", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db down")))
        with pytest.raises(RuntimeError):
            upload(client, cand["id"])
        assert stored_files() == [] and tmp_files() == []

    def test_a_failed_audit_write_rolls_the_upload_back(self, client, cand, session_factory, monkeypatch):
        from app.services import audit as audit_service

        monkeypatch.setattr(audit_service, "record", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("audit down")))
        with pytest.raises(RuntimeError):
            upload(client, cand["id"])
        with session_factory() as db:
            assert db.scalar(text("select count(*) from resumes")) == 0
        assert stored_files() == []

    def test_a_failed_review_audit_saves_nothing(self, client, cand, monkeypatch):
        from app.services import audit as audit_service

        rid = upload(client, cand["id"]).json()["id"]
        with monkeypatch.context() as m:
            m.setattr(audit_service, "record", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
            with pytest.raises(RuntimeError):
                client.put(f"{RESUMES}/{rid}/review", json=REVIEW)
        assert client.get(f"{RESUMES}/{rid}").json()["reviewed"] is False

    def test_a_download_whose_audit_fails_returns_no_file(self, client, cand, monkeypatch):
        from app.services import audit as audit_service

        rid = upload(client, cand["id"]).json()["id"]
        monkeypatch.setattr(audit_service, "record", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
        with pytest.raises(RuntimeError):
            client.get(f"{RESUMES}/{rid}/download")


class TestUploadSizeMiddleware:
    def run(self, headers, method="POST", path="/api/v1/candidates/abc/resumes"):
        import asyncio

        from app.core.upload_limit import ResumeUploadLimit

        sent, called = [], []

        async def app(scope, receive, send):
            called.append(True)

        async def send(message):
            sent.append(message)

        asyncio.run(ResumeUploadLimit(app)({"type": "http", "method": method, "path": path, "headers": headers}, None, send))
        status = next((m["status"] for m in sent if m["type"] == "http.response.start"), None)
        return status, bool(called)

    def test_a_missing_length_is_refused(self):
        assert self.run([]) == (411, False)

    def test_a_declared_size_far_over_the_limit_is_refused_without_calling_the_app(self):
        assert self.run([(b"content-length", str(settings.RESUME_MAX_BYTES + 10 * 1024 * 1024).encode())]) == (413, False)

    def test_an_invalid_length_is_refused(self):
        assert self.run([(b"content-length", b"abc")]) == (400, False)
        assert self.run([(b"content-length", b"-5")]) == (400, False)

    def test_a_reasonable_size_passes_through(self):
        assert self.run([(b"content-length", b"1000")]) == (None, True)

    def test_other_routes_and_methods_are_untouched(self):
        assert self.run([], path="/api/v1/candidates") == (None, True)
        assert self.run([], method="GET") == (None, True)
        assert self.run([], path="/api/v1/candidates/abc/resumes/extra") == (None, True)


class TestDatabaseConstraints:
    def row(self, cid, **over):
        base = dict(candidate_id=cid, version_number=1, original_filename="a.pdf", storage_key=storage.new_key(),
                    mime_type=PDF, extension="pdf", size_bytes=10, sha256=os.urandom(32).hex(), status=ResumeStatus.PENDING, is_active=False)
        base.update(over)
        return Resume(**base)

    def test_one_active_per_candidate_is_enforced_by_the_database(self, client, cand, session_factory):
        cid = uuid.UUID(cand["id"])
        with session_factory() as db:
            db.add(self.row(cid, version_number=1, is_active=True))
            db.commit()
            db.add(self.row(cid, version_number=2, is_active=True))
            with pytest.raises(IntegrityError):
                db.commit()

    def test_many_inactive_are_fine_and_other_candidates_have_their_own_active(self, client, cand, session_factory):
        other = uuid.UUID(client.post(CANDIDATES, json=candidate_payload(2)).json()["id"])
        cid = uuid.UUID(cand["id"])
        with session_factory() as db:
            db.add_all([self.row(cid, version_number=1, is_active=True), self.row(cid, version_number=2), self.row(cid, version_number=3), self.row(other, version_number=1, is_active=True)])
            db.commit()

    @pytest.mark.parametrize("over", [{"extension": "exe"}, {"extension": "doc"}, {"size_bytes": 0}, {"size_bytes": -1}, {"version_number": 0}, {"status": ResumeStatus.REMOVED, "is_active": True}])
    def test_check_constraints(self, client, cand, session_factory, over):
        with session_factory() as db:
            db.add(self.row(uuid.UUID(cand["id"]), **over))
            with pytest.raises((IntegrityError, LookupError)):
                db.commit()

    def test_duplicate_version_and_duplicate_checksum_per_candidate(self, client, cand, session_factory):
        cid = uuid.UUID(cand["id"])
        with session_factory() as db:
            db.add(self.row(cid, version_number=1, sha256="a" * 64))
            db.commit()
            db.add(self.row(cid, version_number=1, sha256="b" * 64))
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()
            db.add(self.row(cid, version_number=2, sha256="a" * 64))
            with pytest.raises(IntegrityError):
                db.commit()

    def test_null_checksums_never_clash(self, client, cand, session_factory):
        cid = uuid.UUID(cand["id"])
        with session_factory() as db:
            db.add_all([self.row(cid, version_number=n, sha256=None, storage_key=None, status=ResumeStatus.REMOVED) for n in (1, 2, 3)])
            db.commit()

    def test_storage_keys_are_unique(self, client, cand, session_factory):
        cid = uuid.UUID(cand["id"])
        with session_factory() as db:
            db.add(self.row(cid, version_number=1, storage_key="a" * 32))
            db.commit()
            db.add(self.row(cid, version_number=2, storage_key="a" * 32))
            with pytest.raises(IntegrityError):
                db.commit()

    def test_a_resume_needs_a_real_candidate(self, session_factory):
        with session_factory() as db:
            db.add(self.row(uuid.uuid4()))
            with pytest.raises(IntegrityError):
                db.commit()


class TestRequestShapes:
    @pytest.mark.parametrize("method,path", [("get", "x"), ("put", "x/review"), ("post", "x/parse"), ("post", "x/activate"), ("patch", "x"), ("delete", "x")])
    def test_malformed_ids_are_422(self, client, method, path):
        body = {"json": REVIEW} if method == "put" else ({"json": {}} if method == "patch" else {})
        assert getattr(client, method)(f"{RESUMES}/{path}", **body).status_code == 422

    def test_unknown_ids_are_404(self, client):
        rid = uuid.uuid4()
        for method, suffix, body in [("get", "", {}), ("get", "/parsed", {}), ("post", "/parse", {}), ("post", "/activate", {}),
                                     ("put", "/review", {"json": REVIEW}), ("patch", "", {"json": {"application_id": None}}), ("delete", "", {})]:
            assert getattr(client, method)(f"{RESUMES}/{rid}{suffix}", **body).status_code == 404, (method, suffix)
