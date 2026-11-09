"""One-time local setup: create the application DB user and database.

Usage (from the backend/ folder, venv active):
    python scripts/setup_db.py

Credential handling:
  * If backend/.env does not exist, it is created from .env.example with a randomly generated
    app-user password and SECRET_KEY. Generated values are written to .env only, never printed.
  * The PostgreSQL superuser password is read with a hidden prompt (getpass). It is kept in
    memory only: never written to disk, never passed on a command line.
  * The app-user password is read from .env and sent to the server as a SQL literal over the
    connection. No SQL file or tracked file ever contains it.
"""

from __future__ import annotations

import getpass
import re
import secrets
import sys
from pathlib import Path

import psycopg
from psycopg import sql

BACKEND_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = BACKEND_DIR / ".env"
EXAMPLE_PATH = BACKEND_DIR / ".env.example"
PLACEHOLDERS = {"", "change-me", "CHANGE_ME"}


def ensure_env_file() -> None:
    if ENV_PATH.exists():
        return
    text = EXAMPLE_PATH.read_text(encoding="utf-8")
    db_pw = secrets.token_urlsafe(32)
    text = re.sub(r"^POSTGRES_PASSWORD=.*$", f"POSTGRES_PASSWORD={db_pw}", text, flags=re.M)
    text = re.sub(
        r"^SECRET_KEY=.*$", f"SECRET_KEY={secrets.token_urlsafe(48)}", text, flags=re.M
    )
    ENV_PATH.write_text(text, encoding="utf-8")
    print(f"Created {ENV_PATH.name} with generated secrets (not shown).")


def main() -> int:
    ensure_env_file()

    # Imported after .env exists so settings load it.
    sys.path.insert(0, str(BACKEND_DIR))
    from app.core.config import get_settings

    s = get_settings()
    if s.POSTGRES_PASSWORD in PLACEHOLDERS or len(s.POSTGRES_PASSWORD) < 16:
        print("POSTGRES_PASSWORD in .env is a placeholder or too short (<16). Fix it and retry.")
        return 1
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", s.POSTGRES_USER) or not re.fullmatch(
        r"[a-z_][a-z0-9_]*", s.POSTGRES_DB
    ):
        print("POSTGRES_USER and POSTGRES_DB must be lowercase letters, digits or underscores.")
        return 1

    admin_user = input("PostgreSQL admin username [postgres]: ").strip() or "postgres"
    admin_pw = getpass.getpass(f"Password for '{admin_user}' (hidden, not stored): ")

    with psycopg.connect(
        host=s.POSTGRES_HOST,
        port=s.POSTGRES_PORT,
        dbname="postgres",
        user=admin_user,
        password=admin_pw,
        autocommit=True,
    ) as conn:
        role = sql.Identifier(s.POSTGRES_USER)
        db = sql.Identifier(s.POSTGRES_DB)
        pw = sql.Literal(s.POSTGRES_PASSWORD)

        exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (s.POSTGRES_USER,))
        if exists.fetchone():
            # Keep the role's password in sync with .env.
            conn.execute(sql.SQL("ALTER ROLE {} WITH LOGIN PASSWORD {}").format(role, pw))
            print(f"Role '{s.POSTGRES_USER}' already existed: password synced with .env.")
        else:
            # Least privilege: no superuser, no createdb, no createrole.
            conn.execute(
                sql.SQL(
                    "CREATE ROLE {} WITH LOGIN PASSWORD {} "
                    "NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION"
                ).format(role, pw)
            )
            print(f"Created role '{s.POSTGRES_USER}'.")

        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (s.POSTGRES_DB,))
        if exists.fetchone():
            print(f"Database '{s.POSTGRES_DB}' already exists: left unchanged.")
        else:
            conn.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(db, role))
            print(f"Created database '{s.POSTGRES_DB}' owned by '{s.POSTGRES_USER}'.")

        # Other roles cannot connect to the app database.
        conn.execute(sql.SQL("REVOKE CONNECT ON DATABASE {} FROM PUBLIC").format(db))

    # Verify the app credentials work (as the app user, not the admin).
    with psycopg.connect(
        host=s.POSTGRES_HOST,
        port=s.POSTGRES_PORT,
        dbname=s.POSTGRES_DB,
        user=s.POSTGRES_USER,
        password=s.POSTGRES_PASSWORD,
    ) as conn:
        conn.execute("SELECT 1")
    print("Verified: the app user can log in to the app database.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
