"""Find (and optionally delete) resume files that no database row refers to.

Usage (from the backend/ folder, venv active):
    python scripts/cleanup_resume_files.py            # report only: nothing is deleted
    python scripts/cleanup_resume_files.py --delete   # delete the unreferenced and stale temp files

Only files inside the resume storage folder are considered. A file that a database row refers to is
never touched. File names are random keys; no personal data is printed.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal  # noqa: E402
from app.services import resume as resume_service  # noqa: E402


def main(argv: list[str]) -> int:
    delete = "--delete" in argv
    with SessionLocal() as db:
        result = resume_service.cleanup_orphans(db, dry_run=not delete)
    print(
        f"Unreferenced files: {result['orphaned_files']}; stale temporary files: "
        f"{result['stale_temp_files']}; removed: {result['removed']}"
        + ("" if delete else " (dry run: pass --delete to remove them)")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
