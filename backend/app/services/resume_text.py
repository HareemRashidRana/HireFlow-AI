"""Reading the text out of a stored resume. Pure text extraction: nothing in the document is ever
executed, no macros run, no embedded files or links are followed, and no OCR is attempted (an
image-only PDF is reported as such instead of inventing text).

Failures raise `ExtractionError` with a short CODE. Codes never contain document content.
"""

import logging
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_SPACES = re.compile(r"[ \t  -​  　]+")
_BLANKS = re.compile(r"\n{3,}")


class ExtractionError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code  # corrupt | encrypted | parser_error | file_missing


@dataclass
class Extracted:
    text: str
    truncated: bool
    pages: int | None = None


def normalize(text: str) -> str:
    """Readable plain text: NFC, no control characters, tidy spaces and blank lines."""
    text = unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL.sub("", text)
    lines = [_SPACES.sub(" ", line).strip() for line in text.split("\n")]
    return _BLANKS.sub("\n\n", "\n".join(lines)).strip()


def _pdf(path: Path, max_chars: int, max_pages: int) -> Extracted:
    from pypdf import PdfReader  # imported lazily: only needed when a PDF is parsed

    try:
        reader = PdfReader(str(path), strict=False)
        if reader.is_encrypted:
            try:
                ok = reader.decrypt("")  # PDFs "encrypted" with an empty user password
            except Exception:
                ok = 0
            if not ok:
                raise ExtractionError("encrypted")
        total_pages = len(reader.pages)
        parts: list[str] = []
        used = 0
        truncated = total_pages > max_pages
        for page in list(reader.pages)[:max_pages]:
            chunk = page.extract_text() or ""
            parts.append(chunk)
            used += len(chunk)
            if used > max_chars:
                truncated = True
                break
        return Extracted(text="\n".join(parts)[:max_chars], truncated=truncated, pages=total_pages)
    except ExtractionError:
        raise
    except Exception:
        logger.info("PDF could not be read")
        raise ExtractionError("corrupt") from None


def _docx(path: Path, max_chars: int) -> Extracted:
    import docx  # python-docx (reads the XML parts; never runs macros or embedded content)

    try:
        document = docx.Document(str(path))
        parts: list[str] = []
        for section in document.sections[:1]:  # contact details are often in the page header
            parts.extend(p.text for p in section.header.paragraphs)
        parts.extend(p.text for p in document.paragraphs)
        for table in document.tables:
            for row in table.rows:
                seen: list[str] = []
                for cell in row.cells:
                    cell_text = " ".join(p.text for p in cell.paragraphs).strip()
                    if cell_text and cell_text not in seen:  # merged cells repeat their text
                        seen.append(cell_text)
                if seen:
                    parts.append(" | ".join(seen))
        text = "\n".join(parts)
        return Extracted(text=text[:max_chars], truncated=len(text) > max_chars)
    except Exception:
        logger.info("DOCX could not be read")
        raise ExtractionError("corrupt") from None


def extract(path: Path, extension: str, *, max_chars: int, max_pages: int) -> Extracted:
    if not path.is_file():
        raise ExtractionError("file_missing")
    raw = _pdf(path, max_chars, max_pages) if extension == "pdf" else _docx(path, max_chars)
    return Extracted(text=normalize(raw.text), truncated=raw.truncated, pages=raw.pages)
