# HireFlow AI

> AI-assisted HR Management System: recruitment, employee records, leave and attendance, in one full-stack app.

**Status:** Employee Management, Authentication/RBAC and Recruitment (jobs, candidates, applications, pipeline board, candidate privacy and retention, resume upload and parsing) are built. Leave, attendance, match scoring and dashboards are planned (see [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md)).

## Features

- **Auth and roles (built):** login with Admin, HR Manager, Recruiter and Employee roles; account lockout and rate limiting; rotating refresh tokens
- **Employees (built):** directory, profiles, create/edit/delete, manager hierarchy
- **Departments (planned):** proper department records
- **Recruitment (built):** job postings, candidates, applications and a hiring pipeline board with one-step stage rules, rejection reasons, per-column paging and filters
- **Candidate privacy (built):** audit trail, anonymization, export (CSV/JSON), retention review and an opt-in, admin-only purge. See [docs/RECRUITMENT_PRIVACY.md](docs/RECRUITMENT_PRIVACY.md) for behaviour, permissions and limits (this is tooling, not a compliance guarantee)
- **Resumes (built):** secure PDF/DOCX upload, private storage, version history with one active resume, deterministic text extraction and parsing with confidence, and a human review step (parsed data never changes a candidate on its own). No OCR and no scoring. See [docs/RESUMES.md](docs/RESUMES.md) for behaviour, limits and operations
- **Requirements Coverage (built, advisory):** a transparent, deterministic comparison of a job's required and preferred skills with a human-reviewed resume (80/20 weights, curated alias table), with versioned immutable assessments, stale detection, human judgement kept separate, full audit and privacy scrubbing. It never ranks, filters or changes an application's stage. See [docs/REQUIREMENTS_COVERAGE.md](docs/REQUIREMENTS_COVERAGE.md) for the method, limits and privacy behaviour
- **Interview management (built):** scheduling with time-zone-safe times and race-safe conflict detection, a one-way lifecycle (scheduled, confirmed, completed, cancelled, rescheduled with history kept), several interviewers per interview, human-written feedback with private notes and versioned edits, a weekly calendar, list, detail and stats. It never ranks, scores or changes an application's stage. Needs migration `d34d0c31088c`. See [docs/INTERVIEWS.md](docs/INTERVIEWS.md) for the workflow, permissions, API, privacy and limits
- **Recruitment analytics and HR dashboard (built):** the landing page for recruitment staff. Live KPIs, a current-stage hiring funnel, application, interview and hire trends, interview and source breakdowns, time to hire and per-job performance, with period, department and job filters. Read-only aggregate queries (no new tables, no personal data, no caching); employees have no access. See [docs/ANALYTICS.md](docs/ANALYTICS.md) for every definition, the time-zone rules and the limits
- **AI screening:** further screening features (resume parsing and Requirements Coverage are built, see above)
- **Leave and attendance:** requests, approvals, balances
- **Dashboard (leave and attendance analytics):** planned; recruitment analytics are built, see above

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, React Hook Form + Zod |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2 |
| Database | PostgreSQL 16 |
| Auth | Short-lived JWT access token held in memory, rotating refresh token in an HttpOnly cookie (reuse detection), Argon2id password hashing |
| AI | Resume parsing (pdfplumber/python-docx) plus an LLM or embedding provider behind a service interface |
| Testing | pytest + httpx (backend), Vitest (frontend logic tests) |
| Tooling | ESLint, Prettier, Ruff, pre-commit, GitHub Actions, Docker Compose |

## Project Structure

```
HireFlow-AI/
├── frontend/
│   ├── public/
│   └── src/
│       ├── api/            # API client and per-resource request functions
│       ├── assets/
│       ├── components/     # Reusable UI (ui/, layout/, forms/)
│       ├── features/       # Feature modules: auth, employees, recruitment, leave, dashboard
│       ├── hooks/
│       ├── lib/            # Utils, constants, validation schemas
│       ├── pages/          # Route-level components
│       ├── routes/         # Router config, protected routes
│       ├── store/          # Auth/session state
│       ├── types/
│       ├── App.tsx
│       └── main.tsx
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── deps.py     # Shared dependencies (DB session, current user, role guards)
│   │   │   └── v1/         # Routers: auth, users, employees, jobs, candidates, leave
│   │   ├── core/           # Config, security, logging
│   │   ├── db/             # Engine, session, base model
│   │   ├── models/         # SQLAlchemy models
│   │   ├── schemas/        # Pydantic request/response schemas
│   │   ├── services/       # Business logic (incl. AI screening)
│   │   └── main.py
│   ├── alembic/            # Database migrations
│   ├── tests/
│   ├── requirements.txt
│   └── .env.example
├── docs/                   # Architecture notes, ER diagram, API notes
├── .github/workflows/      # CI
├── docker-compose.yml      # Postgres (and later the full stack)
├── .gitignore
└── README.md
```

**Design rules:** routers stay thin and call services. Services own business logic and talk to models. Schemas are the only shape exposed over the API. The frontend is organized by feature, not by file type.

## Prerequisites

- Node.js 20+ and npm
- Python 3.12+
- Git
- PostgreSQL 16+ (local install or Docker)

## Getting Started

```bash
git clone https://github.com/HareemRashidRana/HireFlow-AI.git
cd HireFlow-AI
```

### 1. Database

From `backend/` (after step 2's `pip install`), run the setup script. It generates `backend/.env` with random secrets if missing, then asks (hidden prompt) for your PostgreSQL admin password to create a least-privilege app user and the database:

```bash
python scripts/setup_db.py
```

### 2. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python scripts/setup_db.py      # creates .env + DB user/database (see step 1)
alembic upgrade head            # apply migrations
python scripts/create_admin.py  # create the first admin (hidden password prompt)
uvicorn app.main:app --reload   # http://127.0.0.1:8000  (docs at /docs when DEBUG=true)
```

Health check: `GET http://127.0.0.1:8000/api/v1/health`. Run tests with `pytest` and lint with `ruff check .`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173 (proxies /api to the backend)
npm test                        # unit tests (session / single-flight refresh logic)
npm run lint && npm run build   # lint, typecheck and production build
```

Sign in at http://localhost:5173/login with the admin account you created. Accounts are created by an administrator (there is no self-registration).

### Candidate privacy settings

`backend/.env.example` documents `CANDIDATE_RETENTION_MONTHS` (default 12), `PRIVACY_PURGE_ENABLED` (default `false`: permanent deletion is off unless you turn it on) and `EXPORT_MAX_ROWS`. Nothing is ever deleted automatically.

### Resume storage settings

Resume files are kept **outside the database**, in a private folder that is never served over HTTP: `RESUME_STORAGE_DIR` (default `storage/resumes` under `backend/`, git-ignored), with `RESUME_MAX_BYTES` (default 5 MB) and `RESUME_MAX_PER_CANDIDATE` (default 20). Back this folder up together with the database. To find files no record refers to: `python scripts/cleanup_resume_files.py` (report only; add `--delete` to remove). Details in [docs/RESUMES.md](docs/RESUMES.md).

### Secrets

`.env` files are git-ignored. Only `.env.example` (placeholders) is committed. Never commit real credentials.

## Development Roadmap

| Phase | Scope | Outcome |
|-------|-------|---------|
| **1. Foundation** | Environment check, architecture, README, repo hygiene | Approved plan and structure |
| **2. Scaffolding** | Create `frontend/` (Vite) and `backend/` (FastAPI), env config, health endpoint, Postgres connection, lint/format | Both apps run locally and talk to the DB |
| **3. Auth and users** | User model, migrations, register/login/refresh, role-based guards, login UI, protected routes | Secure login end to end |
| **4. Employees and departments** | CRUD APIs and UI, search, pagination | Core HR records |
| **5. Recruitment** | Jobs, candidates, pipeline stages, interviews (built) | Working hiring workflow |
| **6. Leave and attendance** | Requests, approvals, balances | Employee self-service |
| **7. AI screening** | Resume upload and parsing, match scoring, recruiter review UI | The "AI" in HireFlow |
| **8. Dashboard and reports** | KPIs and charts | Management insights |
| **9. Quality and deploy** | Test coverage, CI, Docker, deployment, docs | Production-ready release |

Each phase ends with a working, committed, demonstrable state.

## License

TBD
