"""Generators for REAL (tiny) PDF and DOCX files used as test fixtures. No real documents are used."""

import io
import zipfile

import docx


def _pdf_escape(text: str) -> bytes:
    raw = text.encode("cp1252", errors="replace")
    return raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def make_pdf(lines: list[str] | None, *, pages: int = 1) -> bytes:
    """A valid text PDF (one font, Latin-1 text). `lines=None` makes a page with no text at all,
    which is what a scanned / image-only PDF looks like to a text extractor."""
    objects: list[bytes] = []
    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(pages))
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>".encode())
    font_id = 3 + 2 * pages
    for i in range(pages):
        content_id = 4 + 2 * i
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_id} 0 R "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> >>".encode()
        )
        if lines is None:
            stream = b""
        else:
            body = b"BT /F1 11 Tf 50 740 Td 14 TL\n"
            for line in lines:
                body += b"(" + _pdf_escape(line) + b") Tj T*\n"
            stream = body + b"ET"
        objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def make_docx(
    paragraphs: list[str],
    *,
    table: list[list[str]] | None = None,
    header: list[str] | None = None,
) -> bytes:
    document = docx.Document()
    if header:
        for text in header:
            document.sections[0].header.add_paragraph(text)
    for text in paragraphs:
        document.add_paragraph(text)
    if table:
        t = document.add_table(rows=len(table), cols=max(len(r) for r in table))
        for r, row in enumerate(table):
            for c, cell in enumerate(row):
                t.cell(r, c).text = cell
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def docx_with_extra_part(base: bytes, name: str, payload: bytes) -> bytes:
    """A copy of a DOCX with one more ZIP entry (e.g. a macro project)."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(base)) as src, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            dst.writestr(item, src.read(item.filename))
        dst.writestr(name, payload)
    return out.getvalue()


def zip_bomb_docx(base: bytes, megabytes: int = 20) -> bytes:
    """A DOCX holding a highly compressible part: tiny on disk, huge when expanded."""
    return docx_with_extra_part(base, "word/media/bomb.bin", b"\0" * (megabytes * 1024 * 1024))


CV_LINES = [
    "Ayesha Khan",
    "Lahore, Pakistan | +92 300 1234567 | ayesha.khan@example.com",
    "",
    "Skills",
    "Python, SQL, Docker, PostgreSQL",
    "",
    "Experience",
    "Senior Software Engineer - Acme Technologies   Jan 2021 - Present",
    "Software Engineer",
    "Globex Ltd",
    "Mar 2018 - Dec 2020",
    "",
    "Education",
    "Bachelor of Science in Computer Science, FAST University  2014 - 2018",
]
