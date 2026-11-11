# Database and migrations

HireFlow AI uses **PostgreSQL 16**. The schema is created and changed only through **Alembic** migrations in `backend/alembic/versions/`. Never edit tables by hand.

## Tables (25)

| Group | Tables |
|---|---|
| People and access | `employees`, `users`, `refresh_tokens`, `login_attempts` |
| Recruitment | `job_postings`, `candidates`, `applications`, `application_events`, `candidate_audit_events` |
| Resumes and screening | `resumes`, `screening_assessments`, `screening_reviews` |
| Interviews | `interviews`, `interview_interviewers`, `interview_feedback`, `interview_feedback_revisions`, `interview_events` |
| Attendance | `attendance_records`, `attendance_corrections`, `work_settings`, `holidays` |
| Leave | `leave_types`, `leave_requests`, `leave_ledger`, `leave_events` |

Alembic also keeps its own `alembic_version` table.

## Design notes

- **Primary keys are UUIDs.** Timestamps are stored in UTC.
- **Constraints carry names** (a naming convention in `app/db/`), so migrations and error handling stay predictable.
- **Integrity in the database:** unique work emails and employee IDs, enum-style `CHECK` constraints, foreign keys, and partial unique indexes (for example, one active resume per candidate).
- **Append-only tables:** `candidate_audit_events`, `application_events`, `leave_ledger`, `leave_events`, `interview_events`, and screening assessments and reviews are written once and never updated. The audit table also refuses to store resume-derived content.
- **Personal data minimised:** no salary, government IDs, address or date of birth are stored.

## Migrations (oldest to newest)

| Revision | Adds |
|---|---|
| `67d7e79d6075` | employees |
| `535134b74f34` | users, refresh tokens, login attempts |
| `b715414ab1c6` | job postings |
| `fe06a57b2010` | candidates |
| `5773edf6f24d` | applications and their history |
| `2b9e429a0526` | candidate audit events |
| `1845342c233e` | resumes |
| `e06ccfa51fe7` | screening assessments and reviews |
| `d34d0c31088c` | interviews, feedback and events |
| `99db234e646c` | attendance and leave (**current head**) |

## Everyday commands

Run in `backend\` with the virtual environment active.

```powershell
alembic current            # which revision the database is on
alembic heads              # the newest revision in the code
alembic upgrade head       # bring the database up to date
alembic history            # list all revisions
```

## Upgrading an existing database safely

1. **Back up first** (see below).
2. Run `alembic upgrade head`.
3. Restart the backend.

If you pull new code that includes a new migration and skip step 2, the affected pages show an error until the migration is applied.

## Backup and restore (PostgreSQL tools)

```powershell
# Backup (prompts for the password; never put it in a script or commit it)
pg_dump -h localhost -U <app_user> -F c -f hireflow-backup.dump <database_name>

# Restore into an empty database
pg_restore -h localhost -U <app_user> -d <empty_database_name> hireflow-backup.dump
```

Backup files contain personal data. Keep them private; `.gitignore` already excludes `*.dump` and `*.bak`.

## Resume files

Uploaded resumes are files on disk (`RESUME_STORAGE_DIR`), not database rows, and must be backed up together with the database. `python scripts/cleanup_resume_files.py` reports files that no database row refers to; it deletes nothing unless you add `--delete` (see [RESUMES.md](RESUMES.md)).
