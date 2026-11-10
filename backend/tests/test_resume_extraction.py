"""Reading text out of real PDF and DOCX files, and the storage layer underneath."""

import io
import os
import time

import pytest

from app.core.exceptions import PayloadTooLargeError, StorageUnavailableError
from app.services import resume_storage as storage
from app.services import resume_text as text
from tests.resume_files import CV_LINES, make_docx, make_pdf


def write(tmp_path, name, data):
    path = tmp_path / name
    path.write_bytes(data)
    return path


def extract(path, ext, **kw):
    return text.extract(path, ext, max_chars=kw.pop("max_chars", 100_000), max_pages=kw.pop("max_pages", 40))


class TestPdf:
    def test_reads_the_text_of_a_normal_pdf(self, tmp_path):
        out = extract(write(tmp_path, "a.pdf", make_pdf(CV_LINES)), "pdf")
        assert out.text.splitlines()[0] == "Ayesha Khan"
        assert "ayesha.khan@example.com" in out.text and "Computer Science" in out.text
        assert out.pages == 1 and out.truncated is False

    def test_latin1_text_survives(self, tmp_path):
        out = extract(write(tmp_path, "a.pdf", make_pdf(["José Núñez – Zürich"])), "pdf")
        assert "José Núñez" in out.text and "Zürich" in out.text

    def test_parentheses_and_backslashes(self, tmp_path):
        out = extract(write(tmp_path, "a.pdf", make_pdf(["Skills (Python) C:\\path"])), "pdf")
        assert "Skills (Python)" in out.text

    def test_an_image_only_pdf_gives_no_text_instead_of_inventing_some(self, tmp_path):
        out = extract(write(tmp_path, "scan.pdf", make_pdf(None)), "pdf")
        assert out.text == ""

    def test_multiple_pages_are_joined(self, tmp_path):
        out = extract(write(tmp_path, "a.pdf", make_pdf(["Page text"], pages=3)), "pdf")
        assert out.pages == 3 and out.text.count("Page text") == 3

    def test_the_page_limit_is_enforced_and_reported(self, tmp_path):
        out = extract(write(tmp_path, "a.pdf", make_pdf(["x"], pages=5)), "pdf", max_pages=2)
        assert out.truncated is True and out.text.count("x") == 2

    def test_the_character_limit_is_enforced_and_reported(self, tmp_path):
        out = extract(write(tmp_path, "a.pdf", make_pdf(["abcdefghij"] * 50)), "pdf", max_chars=100)
        assert len(out.text) <= 100 and out.truncated is True

    @pytest.mark.parametrize("data", [b"%PDF-1.4 this is not really a pdf", b"%PDF-1.4\n" + os.urandom(2000), make_pdf(CV_LINES)[:200]])
    def test_corrupt_pdfs_fail_with_a_code_and_no_content(self, tmp_path, data):
        with pytest.raises(text.ExtractionError) as err:
            extract(write(tmp_path, "bad.pdf", data), "pdf")
        assert err.value.code == "corrupt" and "Ayesha" not in str(err.value)

    def test_a_password_protected_pdf_is_reported_as_encrypted(self, tmp_path):
        from pypdf import PdfReader, PdfWriter

        writer = PdfWriter(clone_from=PdfReader(io.BytesIO(make_pdf(CV_LINES))))
        writer.encrypt("a-password-we-do-not-know", algorithm="RC4-128")
        buffer = io.BytesIO()
        writer.write(buffer)
        with pytest.raises(text.ExtractionError) as err:
            extract(write(tmp_path, "enc.pdf", buffer.getvalue()), "pdf")
        assert err.value.code == "encrypted"

    def test_a_pdf_with_an_empty_password_is_still_readable(self, tmp_path):
        from pypdf import PdfReader, PdfWriter

        writer = PdfWriter(clone_from=PdfReader(io.BytesIO(make_pdf(CV_LINES))))
        writer.encrypt("", algorithm="RC4-128")  # "encrypted", but anyone can open it
        buffer = io.BytesIO()
        writer.write(buffer)
        assert "Ayesha Khan" in extract(write(tmp_path, "e.pdf", buffer.getvalue()), "pdf").text

    def test_a_missing_file_is_a_coded_error(self, tmp_path):
        with pytest.raises(text.ExtractionError) as err:
            extract(tmp_path / "nope.pdf", "pdf")
        assert err.value.code == "file_missing"


class TestDocx:
    def test_reads_paragraphs(self, tmp_path):
        out = extract(write(tmp_path, "a.docx", make_docx(CV_LINES)), "docx")
        assert out.text.splitlines()[0] == "Ayesha Khan" and "FAST University" in out.text

    def test_reads_tables_row_by_row(self, tmp_path):
        out = extract(write(tmp_path, "a.docx", make_docx(["Skills"], table=[["Python", "Expert"], ["SQL", "Good"]])), "docx")
        assert "Python | Expert" in out.text and "SQL | Good" in out.text

    def test_reads_the_page_header_where_contact_details_often_live(self, tmp_path):
        out = extract(write(tmp_path, "a.docx", make_docx(["Body"], header=["ayesha@example.com"])), "docx")
        assert "ayesha@example.com" in out.text

    def test_unicode_is_preserved(self, tmp_path):
        out = extract(write(tmp_path, "a.docx", make_docx(["Zoë Łukasz – 北京 – العربية"])), "docx")
        assert "Zoë Łukasz" in out.text and "北京" in out.text and "العربية" in out.text

    def test_the_character_limit_applies(self, tmp_path):
        out = extract(write(tmp_path, "a.docx", make_docx(["abcdefghij"] * 100)), "docx", max_chars=50)
        assert len(out.text) <= 50 and out.truncated is True

    @pytest.mark.parametrize("data", [b"PK\x03\x04 not a zip", b"PK\x03\x04" + os.urandom(500), b"just text"])
    def test_corrupt_docx_fails_with_a_code(self, tmp_path, data):
        with pytest.raises(text.ExtractionError) as err:
            extract(write(tmp_path, "bad.docx", data), "docx")
        assert err.value.code == "corrupt"

    def test_an_empty_document_gives_empty_text(self, tmp_path):
        assert extract(write(tmp_path, "e.docx", make_docx([])), "docx").text == ""


class TestNormalize:
    def test_cleans_control_characters_and_spaces(self):
        assert text.normalize("a\x00b\x07 \u00a0 c\r\n\r\n\r\n\r\nd") == "ab c\n\nd"

    def test_keeps_newlines_and_unicode(self):
        assert text.normalize("Zoë\nŁukasz") == "Zoë\nŁukasz"


class TestStorage:
    def test_keys_are_validated_everywhere(self):
        for bad in ["../x", "a/b", "x" * 32, "0" * 31, "0" * 33, "", "G" * 32, "../../etc/passwd", "0" * 30 + ".."]:
            with pytest.raises(ValueError):
                storage.path_for(bad)

    def test_a_valid_key_resolves_inside_the_private_root(self):
        key = storage.new_key()
        path = storage.path_for(key)
        assert storage.root() in path.parents and path.name == key and path.parent.name == key[:2]

    def test_keys_are_random(self):
        assert len({storage.new_key() for _ in range(500)}) == 500

    def test_receive_hashes_and_bounds(self):
        import hashlib

        data = os.urandom(300_000)
        got = storage.receive(io.BytesIO(data), 1_000_000)
        assert got.size == 300_000 and got.sha256 == hashlib.sha256(data).hexdigest()
        assert got.head == data[: storage.HEAD_BYTES] and got.tmp_path.read_bytes() == data

    def test_an_oversized_upload_is_rejected_and_leaves_no_temp_file(self):
        with pytest.raises(PayloadTooLargeError):
            storage.receive(io.BytesIO(b"x" * 5000), 1000)
        assert list((storage.root() / "tmp").iterdir()) == []

    def test_reading_is_chunked_not_all_at_once(self):
        sizes = []

        class Spy(io.BytesIO):
            def read(self, n=-1):
                sizes.append(n)
                return super().read(n)

        storage.receive(Spy(b"x" * 500_000), 1_000_000)
        assert sizes and all(0 < n <= storage.CHUNK for n in sizes)

    def test_commit_moves_the_file_atomically_into_place(self):
        got = storage.receive(io.BytesIO(b"hello"), 100)
        key = storage.new_key()
        storage.commit(got.tmp_path, key)
        assert not got.tmp_path.exists() and storage.path_for(key).read_bytes() == b"hello"

    def test_commit_never_overwrites(self):
        key = storage.new_key()
        first = storage.receive(io.BytesIO(b"first"), 100)
        storage.commit(first.tmp_path, key)
        second = storage.receive(io.BytesIO(b"second"), 100)
        with pytest.raises(StorageUnavailableError):
            storage.commit(second.tmp_path, key)
        assert storage.path_for(key).read_bytes() == b"first" and not second.tmp_path.exists()

    def test_delete_is_idempotent_and_ignores_bad_keys(self):
        key = storage.new_key()
        storage.commit(storage.receive(io.BytesIO(b"x"), 10).tmp_path, key)
        assert storage.delete(key) is True and not storage.path_for(key).exists()
        assert storage.delete(key) is True  # already gone: still fine
        assert storage.delete("../../evil") is False and storage.delete(None) is False

    def test_files_are_never_stored_under_the_frontend_folder(self, monkeypatch):
        from app.core.config import settings

        monkeypatch.setattr(settings, "RESUME_STORAGE_DIR", str(storage._BACKEND_DIR.parent / "frontend" / "public" / "cv"))
        with pytest.raises(StorageUnavailableError):
            storage.root()

    def test_an_unwritable_storage_folder_is_a_clean_503_error(self, monkeypatch):
        from app.core.config import settings

        monkeypatch.setattr(settings, "RESUME_STORAGE_DIR", "Z:\\definitely\\not\\a\\drive\\x" if os.name == "nt" else "/proc/nope/x")
        with pytest.raises(StorageUnavailableError):
            storage.root()

    def test_orphans_and_stale_temp_files_are_found_but_not_deleted(self):
        keep, lost = storage.new_key(), storage.new_key()
        for k in (keep, lost):
            storage.commit(storage.receive(io.BytesIO(b"x"), 10).tmp_path, k)
        stale = storage.receive(io.BytesIO(b"x"), 10).tmp_path
        os.utime(stale, (time.time() - 7200, time.time() - 7200))
        fresh = storage.receive(io.BytesIO(b"x"), 10).tmp_path
        orphans, old_tmp = storage.orphans({keep})
        assert [p.name for p in orphans] == [lost] and old_tmp == [stale]
        assert fresh.exists() and storage.path_for(lost).exists()

    def test_open_for_read_streams_in_chunks_and_closes(self):
        key = storage.new_key()
        storage.commit(storage.receive(io.BytesIO(b"a" * 200_000), 1_000_000).tmp_path, key)
        handle = storage.open_for_read(key)
        chunks = list(storage.iter_file(handle))
        assert handle.closed and b"".join(chunks) == b"a" * 200_000 and len(chunks) > 1

    def test_reading_a_missing_key_raises_file_not_found(self):
        with pytest.raises(FileNotFoundError):
            storage.open_for_read(storage.new_key())
        with pytest.raises(FileNotFoundError):
            storage.open_for_read("../../etc/passwd")
