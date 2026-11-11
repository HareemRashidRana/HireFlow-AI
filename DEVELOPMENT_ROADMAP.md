# HireFlow AI: project status and roadmap

_Last updated: 2026-11-11. This replaces an earlier sprint-planning snapshot; the old text remains in the Git history._

## Status

HireFlow AI is **feature-complete for its planned scope** and verified by automated tests. It is a portfolio project designed for local use and is **not deployed**.

| Module | Status | Guide |
|---|---|---|
| Foundation (FastAPI, React, PostgreSQL, Alembic) | Done | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Employee management | Done | |
| Authentication, roles and RBAC | Done | [SECURITY.md](SECURITY.md) |
| Recruitment (jobs, candidates, applications, pipeline) | Done | [docs/RECRUITMENT_PRIVACY.md](docs/RECRUITMENT_PRIVACY.md) |
| Resumes: upload, parsing, human review | Done | [docs/RESUMES.md](docs/RESUMES.md) |
| Requirements Coverage (advisory skills comparison) | Done | [docs/REQUIREMENTS_COVERAGE.md](docs/REQUIREMENTS_COVERAGE.md) |
| Interviews | Done | [docs/INTERVIEWS.md](docs/INTERVIEWS.md) |
| Recruitment analytics and HR dashboard | Done | [docs/ANALYTICS.md](docs/ANALYTICS.md) |
| Attendance and leave | Done | [docs/ATTENDANCE.md](docs/ATTENDANCE.md), [docs/LEAVE_MANAGEMENT.md](docs/LEAVE_MANAGEMENT.md) |
| Role-based panels, account menu, sign-out | Done | [docs/ROLE_PANELS.md](docs/ROLE_PANELS.md) |

Test results are listed in the [README](README.md#testing).

## Not built (candidate future work)

| Area | Notes |
|---|---|
| Payroll | Intentionally not started |
| Departments as records | Department is currently free text on an employee |
| Email notifications and password reset | No email sending exists; administrators reset passwords |
| Multi-factor authentication | |
| Automated pipeline | CI for tests, lint, type check and build; a PostgreSQL job to catch dialect differences |
| Containers and deployment | Dockerfiles, Compose, HTTPS, production settings, backups, monitoring |
| Resume handling | OCR for scanned resumes, malware scanning, object storage |
| Performance reviews | |

## Known limitations

- Resume parsing and skill matching are rule-based and tuned for typical English resumes.
- Single organisation and a single attendance time zone.
- Privacy tools support good practice; they are not a legal compliance guarantee.
- Not security-audited and not hardened for exposure to the internet.

## Housekeeping notes

- Employee deletion is permanent (admin only); direct reports are kept with their manager cleared.
- Database changes must go through Alembic migrations ([docs/DATABASE.md](docs/DATABASE.md)).
