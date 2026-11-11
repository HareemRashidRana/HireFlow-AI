# Architecture

A short tour of how HireFlow AI is built and why. For the module-by-module behaviour see the other guides in this folder.

## The big picture

```
Browser (React SPA)
   │  JSON over HTTP, /api/v1/...
   │  (in development the Vite server proxies /api to the backend)
   ▼
FastAPI application
   api/v1/*     routers: parse the request, check the caller's role, call a service
   services/*   business rules and database work
   schemas/*    Pydantic models: the only shapes the API accepts and returns
   models/*     SQLAlchemy ORM models (tables)
   core/*       settings, security helpers, domain exceptions, upload limit
   db/*         engine, session, constraint naming convention
   ▼
PostgreSQL 16 (schema managed by Alembic)        Private resume files on local disk
```

## Backend rules of thumb

- **Thin routers.** A router declares the route, the required role and the response shape. Rules live in services.
- **Services raise domain errors** (`NotFoundError` 404, `ConflictError` 409, `BusinessRuleError` 422, ...). A single handler turns them into `{"detail": ...}` responses.
- **The database enforces integrity**, not only Python: unique and check constraints, foreign keys, and partial unique indexes (for example, one *active* resume per candidate).
- **Append-only history where it matters.** Candidate audit events, application events, leave ledger entries and interview events are insert-only. Screening assessments are immutable (guarded in the ORM), and reviews are appended, never edited.
- **Pure logic is kept pure.** The Requirements Coverage scoring engine and the attendance and leave rule functions have no database or web imports; tests enforce that boundary, so the logic can be reasoned about and tested in isolation.
- **No hidden automation.** Resume parsing and skills comparison produce *suggestions*. Nothing in the backend moves, rejects, ranks or hires a candidate by itself.

## Request flow (example: approving a leave request)

1. The browser sends `POST /api/v1/leave/requests/{id}/approve` with the access token.
2. The router authenticates the user and checks that their role may manage leave.
3. The leave service loads the request, refuses if the approver is the requester, re-checks the balance, updates the status, and appends ledger and event rows in one transaction.
4. The router returns a schema; the frontend refreshes its list.

## Frontend structure

- Organised **by feature** under `src/features/` (employees, recruitment, workforce, privacy, dashboard, panels), with shared UI in `components/`, one typed API client in `api/`, and auth/session code in `auth/`.
- **Session handling:** the access token lives in memory only. On a 401 a single shared refresh runs (so parallel requests never trigger parallel refreshes, which would look like token theft), then the request is retried once.
- **Role-based UI:** menus and route guards are generated from one permission table that mirrors the server. They only decide what is shown; the server still decides what is allowed. A test fails if the guards and the table disagree.
- **Responsive layout:** the same panel menu is a sidebar on desktop and a drawer on narrow screens.

## Testing strategy

- **Backend:** pytest with FastAPI's test client on an in-memory SQLite database, covering API behaviour, permissions, business rules and boundaries.
- **PostgreSQL-only behaviour** (true concurrency, partial indexes, constraint names, migration upgrade and downgrade) was checked separately on throwaway PostgreSQL instances.
- **Frontend:** Vitest with Testing Library for components, pages, route guards and logic.
- Both suites are part of the "verified results" in the [README](../README.md#testing).

## Deliberate boundaries

- Single organisation, single time zone setting for attendance.
- No external services: no email, no cloud AI, no object storage.
- Not deployed by this repository: there is no Dockerfile or CI configuration yet (see [DEVELOPMENT_ROADMAP.md](../DEVELOPMENT_ROADMAP.md)).
