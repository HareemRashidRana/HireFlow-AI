# Development guide

How to set HireFlow AI up on Windows, run it, test it, and try every role. The short version is in the [README](../README.md).

## Prerequisites

| Tool | Version |
|---|---|
| Git | any recent |
| Python | 3.12 |
| Node.js | 22.12 or newer (developed on Node 24) |
| PostgreSQL | 16 (note the `postgres` administrator password you set at install) |

## First-time setup

PowerShell, from the repository root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1      # if blocked:  Set-ExecutionPolicy -Scope Process Bypass
pip install -r requirements.txt
python scripts/setup_db.py        # creates .env (random secrets), the database and an app user
alembic upgrade head              # creates the tables
python scripts/create_admin.py    # creates the first administrator (hidden password prompt)

cd ..\frontend
npm install
```

In Command Prompt, activate the environment with `.venv\Scripts\activate.bat` instead.

`setup_db.py` uses the PostgreSQL administrator password once, at a hidden prompt, and never stores it. The generated `backend\.env` is git-ignored: **never commit it or paste it anywhere**. `backend\.env.example` lists every setting with placeholder values.

## Running

Two terminals:

```powershell
# 1. Backend (in backend\, virtual environment active)
uvicorn app.main:app --reload          # http://127.0.0.1:8000  (health: /api/v1/health)

# 2. Frontend (in frontend\)
npm run dev                            # http://localhost:5173
```

Open http://localhost:5173/login. FastAPI's interactive API docs are available at `/docs` only when `DEBUG=true` in `backend/.env`.

### Useful settings (in `backend\.env`)

| Setting | Meaning |
|---|---|
| `CANDIDATE_RETENTION_MONTHS` | How long candidate data is kept before it appears in the retention review |
| `PRIVACY_PURGE_ENABLED` | `false` by default. Permanent purge is refused unless this is `true` |
| `EXPORT_MAX_ROWS` | Safety cap on exports |
| `RESUME_STORAGE_DIR`, `RESUME_MAX_BYTES`, `RESUME_MAX_PER_CANDIDATE` | Where resumes are stored and their limits |
| `CORS_ORIGINS` | Allowed browser origins |

## Testing guide

```powershell
# Backend: in backend\, virtual environment active
pytest                   # whole suite; no PostgreSQL needed (in-memory SQLite)
pytest -k leave          # only tests with "leave" in their name
ruff check .             # lint

# Frontend: in frontend\
npm test                 # Vitest
npm run lint             # oxlint
npx tsc -b               # type check
npm run build            # production build
```

Run everything before committing. Expected results are listed in the [README](../README.md#testing).

Backend tests never touch your real database. Behaviour only PostgreSQL can show (true concurrency, partial indexes, migrations up and down) was rehearsed on temporary PostgreSQL instances, not in the automated suite.

## Trying every role

Use **fictional data only**. A common trick: one normal browser window for one role and a private window for another.

1. Sign in as the administrator.
2. **Employees → Add employee**: add a few fictional people (give them clearly fake emails such as `name@example.com`).
3. **Users & accounts → New user**: create one account each for *HR Manager*, *Recruiter* and *Employee*. Link each to an employee record, set a temporary password of at least 12 characters (it must be replaced at first sign-in).
4. Walk through each role:
   - **Employee:** Check in, then out; open Leave and send a request; try to open `/employees` by its address (you should be refused).
   - **HR Manager:** approve the request (you cannot approve your own); grant leave balances; correct an attendance record.
   - **Recruiter:** create a job; add a candidate and an application; upload a fictional resume, review its details, then run **Requirements Coverage**; move the application one stage; schedule an interview.
   - **Administrator:** review *Roles & permissions*, *Data privacy* and the system reports.

## Troubleshooting

| Problem | What to try |
|---|---|
| `Activate.ps1 cannot be loaded` | `Set-ExecutionPolicy -Scope Process Bypass` in that window |
| Backend cannot reach the database | Check the PostgreSQL service (`postgresql-x64-16`) is running and `backend\.env` was created by `setup_db.py` |
| Pages show a database error after pulling new code | Run `alembic upgrade head` (back up first), then restart the backend |
| Port 5173 or 8000 already in use | Close the other program or stop the old dev server |
| Locked out after failed sign-ins | Wait for the lockout (15 minutes) |
