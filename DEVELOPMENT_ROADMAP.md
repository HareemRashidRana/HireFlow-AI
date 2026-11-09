# HireFlow AI: Development Roadmap

_Audit date: 2026-11-10. Snapshot of the repository at the start of the 48-hour sprint._

## 1. Status at a glance

| Area | Status |
|------|--------|
| Project foundation (Vite, FastAPI, PostgreSQL, Alembic) | Done and committed |
| Employee Management, backend and frontend | Done, committed and pushed (`902df15`) |
| Authentication and RBAC, backend | Done, migration `535134b74f34` applied locally, **not yet committed** |
| Authentication and RBAC, frontend | Done (login, session restore, single-flight refresh, guards), **not yet committed** |
| Every other HR module | Not started |

> **Git note:** only one commit exists (`69586b3 Initial HireFlow AI project setup`, equal to `origin/main`).
> All Employee Management work is uncommitted in the working tree and exists only on this machine.

## 2. Completed modules

### Foundation (committed)
- Monorepo layout: `frontend/` (React 19, TypeScript, Vite, Tailwind v4) and `backend/` (FastAPI, SQLAlchemy 2, Alembic).
- Environment configuration via `pydantic-settings`; `.env` is git-ignored and only `.env.example` is tracked.
- `scripts/setup_db.py` creates a least-privilege database user and generates random secrets without printing them.
- Health endpoint with a database check.

### Employee Management (complete, uncommitted)
- Full CRUD API with pagination, search and filters, duplicate protection and manager-hierarchy rules.
- Frontend: directory, create, details, edit, delete with confirmation, and loading, empty, error and success states.
- Verified: 55 backend tests, frontend typecheck, lint and build all pass, and the flows were exercised in a browser against PostgreSQL.

## 3. Pending modules

| # | Module | Summary |
|---|--------|---------|
| 1 | Authentication and roles | Users, login, JWT, role-based access, protected routes |
| 2 | Departments | Proper table replacing free-text department |
| 3 | Recruitment | Job postings, candidates, pipeline stages, interviews |
| 4 | Leave management | Leave types, requests, approvals, balances |
| 5 | Attendance | Check-in and out, timesheets |
| 6 | AI resume screening | Resume upload and parsing, match scoring |
| 7 | Dashboard and reports | Headcount, hiring funnel, leave analytics |
| 8 | Quality and deployment | CI, Docker, frontend tests, docs |

## 4. Current architecture

```
Browser (React SPA, :5173)
   │  fetch /api/v1/...   (Vite dev proxy → no CORS in development)
   ▼
FastAPI (:8000)
   api/v1/*        thin routers: parse request, call service, return schema
   services/*      business rules (duplicates, manager loops, search)
   schemas/*       Pydantic v2 validation and response shapes
   models/*        SQLAlchemy 2 ORM models
   core/*          settings, domain exceptions → HTTP errors
   db/*            engine, session dependency, Base (constraint naming convention)
   ▼
PostgreSQL 16 (migrations via Alembic)
```

**Conventions**
- Routers stay thin; services own business logic; services raise `AppError` subclasses (`NotFoundError` 404, `ConflictError` 409, `BusinessRuleError` 422).
- Errors return `{"detail": "text"}`. Field-validation errors return `{"detail": [{loc, msg}]}`. The frontend client normalises both.
- Backend tests run on in-memory SQLite and never touch the real database.
- Frontend is organised by feature (`features/<module>/`), with shared UI in `components/ui` and the API layer in `api/`.
- Design tokens (navy and lavender palette, Inter font) live in `frontend/src/index.css`.

**Tooling:** Ruff, pytest, ESLint-compatible `oxlint`, TypeScript strict mode.

## 5. Database models and migrations

### `employees` (table)
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `employee_id` | varchar(20) | Unique, indexed, stored uppercase |
| `first_name`, `last_name` | varchar(100) | |
| `work_email` | varchar(255) | Unique, indexed, stored lowercase |
| `phone_number` | varchar(20) | Optional |
| `job_title` | varchar(150) | |
| `department` | varchar(100) | Indexed, free text for now |
| `employment_type` | varchar + CHECK | `full_time`, `part_time`, `contract`, `intern` |
| `employment_status` | varchar + CHECK | `active`, `inactive`, `terminated` (indexed) |
| `date_of_joining` | date | |
| `manager_id` | UUID, FK → `employees.id` | `ON DELETE SET NULL`, indexed |
| `created_at`, `updated_at` | timestamptz | Server default `now()`; `updated_at` refreshed on update |

No sensitive personal data (salary, government IDs, address, date of birth) is stored by design.

### Migrations
| Revision | Description | Applied to dev DB |
|----------|-------------|-------------------|
| `67d7e79d6075` | create employees table (head) | Yes |

## 6. API endpoints

Base path: `/api/v1`. **None are authenticated yet.**

| Method | Path | Success | Notes |
|--------|------|---------|-------|
| GET | `/health` | 200 | `{status, database, version}`; `degraded` if DB is down |
| POST | `/employees` | 201 | Create. 409 on duplicate ID or email; 422 on invalid manager |
| GET | `/employees` | 200 | Query: `q`, `department`, `employment_status`, `employment_type`, `page`, `page_size` (max 100). Returns `{items, total, page, page_size}` |
| GET | `/employees/{id}` | 200 | 404 if missing |
| PATCH | `/employees/{id}` | 200 | Partial update; null clears `phone_number` and `manager_id` only |
| DELETE | `/employees/{id}` | 204 | Hard delete; direct reports kept with manager cleared |

## 7. Frontend routes and components

### Routes
| Path | Page |
|------|------|
| `/login` | Sign in (public). Shows session-expired / signed-out / password-changed notices, lockout countdown |
| `/change-password` | Change password. Forced (and the only reachable page) while an admin-set password is pending |
| `/` | Role-based redirect: staff to `/employees`, employees to `/profile` |
| `/profile` | The signed-in user's own employee record (read-only) |
| `/employees` | Directory: search, filters (URL-synced), pagination. Needs `employees:read` |
| `/employees/new` | Add employee. Needs `employees:write` (admin, HR manager) |
| `/employees/:id` | Employee details. Staff see anyone; employees only their own (the server enforces this) |
| `/employees/:id/edit` | Edit (PATCH with changed fields only). Needs `employees:write` |

All routes except `/login` require a signed-in user. Delete is admin-only.

### Components
- **Layout:** `AppShell`, `Sidebar` (with API status dot), `PageHeader`, `Logo`.
- **UI primitives:** `Button`, `Input` / `Select` (Field), `Card`, `Modal` (native dialog), `Toast`, `Avatar`, `Spinner`, `EmptyState` / `ErrorState` / `Alert`, icon set.
- **Employee feature:** `EmployeeTable`, `EmployeeFilters`, `EmployeeForm`, `ManagerPicker`, `StatusBadge`, `DeleteEmployeeDialog`, `lib/formValues.ts`.
- **Shared logic:** `api/client.ts` (ApiError), `hooks/useQuery`, `useDebounce`, `useApiHealth`.

## 8. Remaining tasks in priority order

| Priority | Task | Why / notes | Est. |
|----------|------|-------------|------|
| **P0** | **Commit Authentication and RBAC** (backend and frontend) | Built, tested and applied locally but not yet committed. Needs your go-ahead; nothing is pushed without approval. | 5 min |
| ~~P1~~ | ~~Authentication and RBAC~~ | Done. See sections 5, 6, 7 and 9. Not yet built: user-management screens for admins (the API exists), MFA, email password reset. | done |
| **P2** | Departments | Replace free-text department with a table and dropdown; migrate existing values. Small and unblocks reporting. | 2–3 h |
| **P3** | Recruitment | Jobs, candidates, pipeline stages, interviews. Highest business value after auth. | 10–12 h |
| **P4** | Leave management | Leave types, requests, manager approval, balances. | 6–8 h |
| **P5** | Attendance | Check-in and out and timesheets. | 4–6 h |
| **P6** | AI resume screening | Resume upload and parsing, match scoring, recruiter review. Builds on Recruitment. | 8–10 h |
| **P7** | Dashboard and reports | Headcount, hiring funnel, leave charts. Needs data from P3–P5. | 4–6 h |
| **P8** | Quality and deployment | Postgres-backed CI tests, Docker Compose, Vitest component/UI tests (logic tests exist), gitleaks pre-commit hook, deployment. | 6–8 h |

_Estimates are rough planning figures, not commitments._

### Housekeeping (small, do alongside the modules)
- Root `README.md` still says "Phase 1, planning only". Update status, features and structure.
- `frontend/README.md` is the unmodified Vite template. Replace or remove it.
- Tests use SQLite while production uses PostgreSQL. Add a PostgreSQL CI job to catch dialect differences.
- Employee delete is permanent. Consider soft-delete or an audit log once auth exists.
- Add `psql` to PATH (`C:\Program Files\PostgreSQL\16\bin`) for local convenience.

## 9. Frontend authentication requirements

**Status: implemented** in `frontend/src/auth/session.ts` and `frontend/src/api/client.ts`, covered
by 50 Vitest tests (`npm test`) and exercised in a real browser (see the test report in the PR / chat).
The requirements below remain the acceptance criteria for any future change to that code.

The backend rotates refresh tokens on every use and treats a re-used token as theft: it revokes
the whole session. Two requests refreshing at once would therefore sign the user out. The
frontend **must** guarantee that at most one refresh is in flight per browser session.

**Single-flight refresh (acceptance criteria)**
1. **One shared promise per tab.** All callers that need a new access token (a 401 retry, the
   page-load session restore, a proactive timer) call one `refreshAccessToken()`. If a refresh is
   already running they await the same promise instead of starting another request.
2. **Concurrent 401s share one refresh.** When several API calls fail with 401 at the same time,
   they all wait for that single refresh and then each retries once with the new token.
3. **Retry exactly once.** A request is retried at most one time. A 401 on the retry, or on
   `/auth/refresh` itself, ends the session (clear in-memory state and go to `/login`) and is
   never retried in a loop.
4. **Cross-tab safety.** Tabs share the same refresh cookie, so use the Web Locks API
   (`navigator.locks.request('hireflow-refresh', ...)`) around the refresh and publish the result
   with `BroadcastChannel` so other tabs adopt the new access token instead of refreshing again.
   If Web Locks is unavailable, fall back to a `localStorage` lock with a timeout.
5. **Headers.** Every call to `/auth/login`, `/auth/refresh` and `/auth/logout` sends
   `X-Requested-With: HireFlow` (required by the server's CSRF check) and `credentials: 'include'`.
6. **Storage.** The access token lives only in memory (never `localStorage`/`sessionStorage`).
   The refresh token is the HttpOnly cookie and is never visible to JavaScript.
7. **Tests.** Cover: N parallel 401s cause exactly one `/auth/refresh` call; a failed refresh
   signs out once; no retry loops; a second tab's refresh result is adopted.

**Backend facts the frontend can rely on**
- `POST /auth/refresh` returns `{access_token, token_type, expires_in, user}` and rotates the cookie.
- Failed refresh returns 401 and clears the cookie.
- Login throttling returns 429 with a `Retry-After` header.
- 403 "You must change your password before continuing." means show the change-password screen.
