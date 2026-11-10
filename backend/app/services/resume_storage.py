"""Private file storage for resumes.

Rules this module enforces:
  * Files live under ONE private folder (RESUME_STORAGE_DIR), never inside the frontend or any
    static folder, and are reachable only through the authenticated API.
  * The on-disk name is a random 32-hex key. The user's filename is never part of a path, so path
    traversal and overwrite attacks are impossible by construction (keys are re-validated on use).
  * Uploads are read in bounded chunks into a temp file inside the storage folder, hashed on the
    way, and moved into place with an atomic rename. Nothing is ever read fully into memory.
  * Absolute paths never leave this module.
"""

import hashlib
import logging
import os
import re
import tempfile
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from app.core.config import settings
from app.core.exceptions import PayloadTooLargeError, StorageUnavailableError

logger = logging.getLogger(__name__)  # keys / counts only, never file contents or names

KEY_RE = re.compile(r"^[0-9a-f]{32}$")
CHUNK = 64 * 1024
HEAD_BYTES = 8192
TMP_MAX_AGE_SECONDS = 3600
_BACKEND_DIR = Path(__file__).resolve().parents[2]


@dataclass
class Received:
    tmp_path: Path
    size: int
    sha256: str
    head: bytes


def root() -> Path:
    """The storage folder (created on first use). Refuses to live inside the frontend folder."""
    configured = Path(settings.RESUME_STORAGE_DIR)
    path = (configured if configured.is_absolute() else _BACKEND_DIR / configured).resolve()
    frontend = (_BACKEND_DIR.parent / "frontend").resolve()
    if path == frontend or frontend in path.parents:
        raise StorageUnavailableError("Resume storage is misconfigured.")
    try:
        (path / "tmp").mkdir(parents=True, exist_ok=True)
    except OSError:
        logger.error("Resume storage folder is not writable")
        raise StorageUnavailableError("File storage is unavailable right now.") from None
    return path


def new_key() -> str:
    return uuid.uuid4().hex


def path_for(key: str) -> Path:
    """The file for a storage key. Anything that is not a 32-hex key is refused outright."""
    if not isinstance(key, str) or not KEY_RE.fullmatch(key):
        raise ValueError("invalid storage key")
    base = root()
    path = (base / key[:2] / key).resolve()
    if base not in path.parents:  # belt and braces: the resolved path must stay inside the root
        raise ValueError("invalid storage key")
    return path


def receive(stream: BinaryIO, max_bytes: int) -> Received:
    """Copy an upload to a temp file in bounded chunks, hashing it. Raises if it is too large."""
    tmp_dir = root() / "tmp"
    digest = hashlib.sha256()
    size = 0
    head = b""
    try:
        fd, name = tempfile.mkstemp(dir=tmp_dir, prefix="up-")
    except OSError:
        logger.error("Could not create a temporary upload file")
        raise StorageUnavailableError("File storage is unavailable right now.") from None
    tmp_path = Path(name)
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = stream.read(CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise PayloadTooLargeError(
                        f"The file is larger than the {max_bytes // (1024 * 1024)} MB limit."
                    )
                if len(head) < HEAD_BYTES:
                    head += chunk[: HEAD_BYTES - len(head)]
                digest.update(chunk)
                out.write(chunk)
    except OSError:
        discard(tmp_path)
        logger.error("Could not write an upload to storage")
        raise StorageUnavailableError("File storage is unavailable right now.") from None
    except BaseException:
        discard(tmp_path)
        raise
    return Received(tmp_path=tmp_path, size=size, sha256=digest.hexdigest(), head=head)


def commit(tmp_path: Path, key: str) -> None:
    """Move a finished upload into place atomically. Never overwrites an existing file."""
    final = path_for(key)
    try:
        final.parent.mkdir(parents=True, exist_ok=True)
        if final.exists():  # random keys never collide; if one somehow did, refuse to overwrite
            raise FileExistsError
        os.replace(tmp_path, final)
    except OSError:
        discard(tmp_path)
        logger.error("Could not move an upload into storage")
        raise StorageUnavailableError("File storage is unavailable right now.") from None


def discard(tmp_path: Path) -> None:
    try:
        tmp_path.unlink(missing_ok=True)
    except OSError:
        logger.warning("Could not remove a temporary upload file")


def delete(key: str | None) -> bool:
    """Remove a stored file. Idempotent; a failure is logged and left for orphan cleanup."""
    if not key:
        return False
    try:
        path = path_for(key)
        path.unlink(missing_ok=True)
        return True
    except (OSError, ValueError, StorageUnavailableError):
        logger.warning("Could not delete stored file key=%s", key)
        return False


def delete_many(keys: list[str]) -> int:
    return sum(1 for k in keys if delete(k))


def open_for_read(key: str) -> BinaryIO:
    try:
        return open(path_for(key), "rb")  # noqa: SIM115  (closed by the streaming generator)
    except FileNotFoundError:
        raise
    except (OSError, ValueError):
        raise FileNotFoundError from None


def iter_file(handle: BinaryIO) -> Iterator[bytes]:
    try:
        while True:
            chunk = handle.read(CHUNK)
            if not chunk:
                break
            yield chunk
    finally:
        handle.close()


def orphans(known_keys: set[str]) -> tuple[list[Path], list[Path]]:
    """(stored files no database row refers to, stale temp files). Nothing is deleted here."""
    base = root()
    unreferenced: list[Path] = []
    for shard in base.iterdir():
        if shard.name == "tmp" or not shard.is_dir():
            continue
        for f in shard.iterdir():
            if f.is_file() and f.name not in known_keys:
                unreferenced.append(f)
    cutoff = time.time() - TMP_MAX_AGE_SECONDS
    stale = [f for f in (base / "tmp").iterdir() if f.is_file() and f.stat().st_mtime < cutoff]
    return unreferenced, stale
