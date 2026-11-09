"""Create the first administrator account.

Usage (from the backend/ folder, venv active, after `alembic upgrade head`):
    python scripts/create_admin.py

The password is read with a hidden prompt (twice). It is never printed, logged, put on a command
line or written to a file; it goes straight into an Argon2 hash in the database.
"""

from __future__ import annotations

import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import ValidationError  # noqa: E402

from app.core.exceptions import AppError  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.models.user import UserRole  # noqa: E402
from app.schemas.user import PASSWORD_MIN_LENGTH, UserCreate  # noqa: E402
from app.services import user as user_service  # noqa: E402


def main() -> int:
    email = input("Admin email: ").strip()
    print(f"Password rules: {PASSWORD_MIN_LENGTH}+ characters, not too common, not the email.")
    password = getpass.getpass("Password (hidden): ")
    if password != getpass.getpass("Repeat password (hidden): "):
        print("Passwords do not match.")
        return 1

    try:
        data = UserCreate(
            email=email,
            password=password,
            role=UserRole.ADMIN,
            must_change_password=False,  # you chose this password yourself just now
        )
    except ValidationError as exc:
        # Report the rules that failed without echoing any input value.
        for err in exc.errors():
            print(f"- {err['msg']}")
        return 1
    finally:
        del password  # drop our reference as soon as validation is done

    with SessionLocal() as db:
        try:
            user = user_service.create_user(db, data)
        except AppError as exc:
            print(f"Could not create the admin: {exc.detail}")
            return 1
    print(f"Created admin account {user.email}. You can now sign in.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
