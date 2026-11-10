"""Deciding whether an upload is really a PDF or DOCX. The browser's claims are never trusted: the
type is read from the file's own bytes, and the extension and any declared MIME type must agree."""

import re
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path

from app.core.exceptions import BusinessRuleError, UnsupportedMediaError

PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
ALLOWED_EXTENSIONS = {"pdf": PDF_MIME, "docx": DOCX_MIME}
# What a browser may legitimately send for these files. Anything else is refused (but a matching or
# generic value is never treated as proof: only the signature decides).
ACCEPTABLE_DECLARED = {PDF_MIME, "application/x-pdf", DOCX_MIME, "application/octet-stream", ""}

MAX_ZIP_ENTRIES = 2000
MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


@dataclass(frozen=True)
class Detected:
    extension: str
    mime_type: str


def sanitize_filename(name: str | None) -> str:
    """A display-only filename: no directories, no control characters, bounded length."""
    text = unicodedata.normalize("NFC", name or "")
    text = text.replace("\\", "/").rsplit("/", 1)[-1]
    text = _CONTROL.sub("", text).strip().strip(".") or "resume"
    if len(text) > 255:  # cut the NAME, never the extension (it decides what kind of file this is)
        stem, dot, suffix = text.rpartition(".")
        keep = 255 - len(suffix) - 1
        has_suffix = dot and 0 < len(suffix) <= 8 and keep > 0
        text = f"{stem[:keep]}.{suffix}" if has_suffix else text[:255]
    return text


def extension_of(name: str) -> str | None:
    suffix = Path(name).suffix.lower().lstrip(".")
    return suffix if suffix in ALLOWED_EXTENSIONS else None


def _check_docx(path: Path) -> None:
    """A .docx is a ZIP of XML parts: check its shape; refuse macro-carrying or bomb-like files."""
    try:
        with zipfile.ZipFile(path) as z:
            infos = z.infolist()
            if len(infos) > MAX_ZIP_ENTRIES:
                raise BusinessRuleError("This document has an unusual structure and was refused.")
            names = {i.filename for i in infos}
            if "[Content_Types].xml" not in names or "word/document.xml" not in names:
                raise UnsupportedMediaError("This is not a valid Word (.docx) document.")
            if any(n.lower().endswith("vbaproject.bin") for n in names):
                raise UnsupportedMediaError("Documents that contain macros are not accepted.")
            total = 0
            for i in infos:
                total += i.file_size
                if i.compress_size and i.file_size / i.compress_size > MAX_COMPRESSION_RATIO:
                    raise BusinessRuleError("This document looks like a compression bomb.")
            if total > MAX_UNCOMPRESSED_BYTES:
                raise BusinessRuleError("This document expands to an unreasonable size.")
    except zipfile.BadZipFile:
        raise UnsupportedMediaError("This is not a valid Word (.docx) document.") from None


def detect(
    filename: str, declared_type: str | None, size: int, head: bytes, path: Path
) -> Detected:
    """Validate a fully received upload. Raises an AppError that describes the problem."""
    if size == 0:
        raise BusinessRuleError("The file is empty.")
    ext = extension_of(filename)
    if ext is None:
        raise UnsupportedMediaError("Only PDF and DOCX resumes are accepted.")
    if (declared_type or "").split(";")[0].strip().lower() not in ACCEPTABLE_DECLARED:
        raise UnsupportedMediaError("Only PDF and DOCX resumes are accepted.")

    if head.startswith(b"%PDF-"):
        kind = "pdf"
    elif head.startswith(b"PK\x03\x04"):
        kind = "docx"
    else:
        raise UnsupportedMediaError("The file's content is not a PDF or DOCX document.")
    if kind != ext:
        raise UnsupportedMediaError("The file's content does not match its extension.")
    if kind == "docx":
        _check_docx(path)
    return Detected(extension=kind, mime_type=ALLOWED_EXTENSIONS[kind])
