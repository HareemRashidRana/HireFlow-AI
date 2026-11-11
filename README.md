# HireFlow AI

> A full-stack HR management system covering employee records, recruitment, interviews, attendance and leave, with role-based access for four kinds of users and a strong focus on privacy and human oversight.

![Status](https://img.shields.io/badge/status-feature--complete-blue) ![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20TypeScript-61dafb) ![Backend](https://img.shields.io/badge/backend-FastAPI-009688) ![Database](https://img.shields.io/badge/database-PostgreSQL%2016-336791)

> ## Copyright and usage notice
>
> **Copyright © 2026 HareemRashidRana (GitHub: [@HareemRashidRana](https://github.com/HareemRashidRana)). All rights reserved.**
>
> The source code in this repository is publicly available **for viewing and educational review only** (for example, so that recruiters, hiring managers and peers can read it and assess my work).
> **No licence is granted.** Reuse, copying, modification, redistribution, sublicensing or commercial use of any part of this project requires my **prior written permission**. To ask for permission, contact me through my GitHub profile.
>
> The repository is public, and GitHub's own Terms of Service allow anyone to view and fork public repositories on GitHub. That platform feature is **not** a licence to use the code in any other way: public visibility does not change the rules above.

## Contents

[Overview](#overview) · [Features](#features) · [User roles](#user-roles) · [Tech stack](#tech-stack) · [Architecture](#architecture-overview) · [Database](#database-overview) · [Auth and RBAC](#authentication-and-rbac) · [Resumes and screening](#resume-parsing-and-human-reviewed-screening) · [Install (Windows)](#installation-on-windows) · [Run](#running-the-app) · [Tests](#testing) · [Demo accounts](#demo-accounts) · [Screenshots](#screenshots) · [Limitations and future work](#current-limitations-and-future-enhancements) · [Documentation](#documentation) · [About](#about-this-project)

## Overview

Small and mid-sized organisations often run HR on spreadsheets and email: employee details in one place, candidates in another, leave requests in chat. That is error-prone, hard to audit, and exposes personal data too widely.

**HireFlow AI** brings these jobs into one application:

- keep **employee records** and a manager hierarchy,
- run a **hiring pipeline** from job posting to offer, including resumes and interviews,
- let employees **check in and out** and **request leave**, with an approval workflow,
- give each person only the screens and data their **role** allows,
- keep an **audit trail** and give candidates' data proper privacy tools.

### Objectives

1. A realistic, end-to-end HR system, not a collection of demos.
2. **Security by design:** server-side permission checks on every request, hashed passwords, append-only audit records.
3. **Human in control:** automated helpers (resume reading, skills comparison) are advisory only and never move, reject or hire anyone.
4. **Trustworthy data:** integrity rules enforced in the database, and behaviour proven by automated tests.

## Features

| Module | What it does | Details |
|---|---|---|
| **Authentication and roles** | Sign in, account lockout, rate limiting, rotating sessions, per-role access | [Auth and RBAC](#authentication-and-rbac) |
| **Role panels** | Each role has its own home page, grouped menu and account menu with Sign out | [docs/ROLE_PANELS.md](docs/ROLE_PANELS.md) |
| **Employees** | Directory, profiles, create/edit/delete, manager hierarchy | |
| **Recruitment** | Job postings, candidates, applications, a hiring pipeline board with one-step stage rules | |
| **Candidate privacy** | Audit trail, anonymisation, CSV/JSON export, retention review, opt-in purge | [docs/RECRUITMENT_PRIVACY.md](docs/RECRUITMENT_PRIVACY.md) |
| **Resumes** | Secure PDF/DOCX upload, private storage, versions, text extraction and parsing, human review | [docs/RESUMES.md](docs/RESUMES.md) |
| **Requirements Coverage** | Transparent, advisory comparison of a job's skills with a reviewed resume | [docs/REQUIREMENTS_COVERAGE.md](docs/REQUIREMENTS_COVERAGE.md) |
| **Interviews** | Scheduling with conflict detection, lifecycle, several interviewers, private feedback | [docs/INTERVIEWS.md](docs/INTERVIEWS.md) |
| **Attendance** | Check in/out in the company time zone, late/early/absent rules, HR corrections with reasons | [docs/ATTENDANCE.md](docs/ATTENDANCE.md) |
| **Leave** | Requests, working-day counting, approvals (never your own), append-only balance ledger, calendar | [docs/LEAVE_MANAGEMENT.md](docs/LEAVE_MANAGEMENT.md) |
| **Analytics** | Recruitment KPIs and funnel; attendance and leave figures for HR. Aggregates only | [docs/ANALYTICS.md](docs/ANALYTICS.md) |

## User roles

| Role | Lands on | What they do |
|---|---|---|
| **Administrator** | Admin Console | Manage accounts and roles, company settings, data privacy; can reach every management area |
| **HR Manager** | HR Workspace | Employees, attendance corrections, leave approvals and balances, work schedule, hiring decisions, privacy tools |
| **Recruiter** | Recruiting | Jobs, candidates and resumes, applications, pipeline, interviews, recruitment analytics |
| **Employee** | My Portal | Check in/out, attendance history, apply for leave, leave balances, own profile |

Menus only decide what is *listed*. Every request is checked again by the server. The full permission table is in [docs/ROLE_PANELS.md](docs/ROLE_PANELS.md).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, React Router |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, Pydantic v2, Alembic |
| Database | PostgreSQL 16 |
| Auth | Argon2id password hashing, short-lived JWT access token kept in memory, rotating refresh token in an HttpOnly cookie with reuse detection |
| Documents | `pypdf` and `python-docx` for resume text (no external AI service, no OCR) |
| Testing | pytest + httpx (backend), Vitest + Testing Library (frontend) |
| Tooling | Ruff (Python lint), oxlint (frontend lint), TypeScript type checking |

## Architecture overview

```
 Browser (React SPA)  ──HTTPS/JSON──▶  FastAPI  ──SQLAlchemy──▶  PostgreSQL
  role-based UI                         routers → services → models
  access token in memory                permission checks, validation,
  refresh cookie (HttpOnly)             audit writing, business rules
                                              │
                                              └─▶ private resume storage (files on disk, never served directly)
```

- **Routers stay thin**, **services own the business rules**, **models** map to tables, **schemas** (Pydantic) are the only shapes the API exposes.
- The frontend is organised **by feature** (`features/recruitment`, `features/workforce`, …) with one typed API client.
- The scoring engine for Requirements Coverage is a **pure module** with no database or web imports, enforced by tests.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Database overview

25 tables, created and evolved by 10 Alembic migrations. In groups: **people and access** (users, employees, refresh tokens, login attempts), **recruitment** (jobs, candidates, applications and their history, resumes, screening assessments and reviews, candidate audit events), **interviews** (interviews, interviewers, feedback and revisions, events), **attendance and leave** (records, corrections, leave types, requests, ledger, events, holidays, work settings). Integrity rules (unique constraints, check constraints, "one active resume per candidate") live in the database, not only in code. See [docs/DATABASE.md](docs/DATABASE.md).

## Authentication and RBAC

- **Passwords:** Argon2id hashes; strength rules; admins create accounts (there is no self-registration).
- **Sessions:** 15-minute access tokens held in memory only; 7-day rotating refresh tokens in an `HttpOnly`, `SameSite=Strict` cookie. Re-using an old refresh token revokes the whole session family.
- **Abuse protection:** per-account lockout and per-IP rate limiting on sign-in.
- **RBAC:** four roles. Every API route declares which roles may call it, and the server enforces it regardless of what the UI shows. Employees can only ever read their own data. Nobody can approve their own leave, and an admin cannot change or deactivate their own account.
- **Frontend guards** mirror the rules only to avoid showing pages that would be refused; a test fails if the front-end rules drift from the real route guards.

Details: [SECURITY.md](SECURITY.md) and [docs/ROLE_PANELS.md](docs/ROLE_PANELS.md).

## Resume parsing and human-reviewed screening

1. **Upload:** PDF or DOCX only, size-limited, content-checked (not just the file extension), stored privately under random names.
2. **Parse:** text is extracted and read by deterministic rules (name, email, phone, skills, education, experience), each value with a confidence level. Scanned images are reported, not guessed (no OCR).
3. **Human review:** a person checks and corrects the values and explicitly confirms them. Parsed data **never** changes a candidate on its own.

### Requirements Coverage

A transparent *skills comparison*, not a candidate score. It counts how many of a job's required skills (80% of the figure) and preferred skills (20%) are **listed** in the **human-reviewed** resume. A missing skill is shown as "not listed", never "lacks". Experience is shown for context only and is not scored. Every assessment is immutable, versioned and auditable; the recruiter's own judgement is stored separately; if the job or resume changes, the old result is marked **outdated** (never silently re-scored). It never ranks, filters, hides or moves anyone. See [docs/REQUIREMENTS_COVERAGE.md](docs/REQUIREMENTS_COVERAGE.md).

## Installation on Windows

**You need:** [Git](https://git-scm.com/), [Python 3.12](https://www.python.org/downloads/), [Node.js 22.12 or newer](https://nodejs.org/) (developed on Node 24) and [PostgreSQL 16](https://www.postgresql.org/download/windows/) (remember the `postgres` administrator password you set during installation).

Open **PowerShell** and run:

```powershell
git clone https://github.com/HareemRashidRana/HireFlow-AI.git
cd HireFlow-AI\backend

python -m venv .venv
.\.venv\Scripts\Activate.ps1        # if PowerShell blocks scripts, run:  Set-ExecutionPolicy -Scope Process Bypass
pip install -r requirements.txt

python scripts/setup_db.py          # creates backend\.env with random secrets, and the database + app user
alembic upgrade head                # creates all tables
python scripts/create_admin.py      # creates your first administrator (password typed at a hidden prompt)
```

`setup_db.py` asks for the PostgreSQL administrator password (hidden prompt). It is used once, never stored, and nothing secret is printed. The generated `.env` file is git-ignored; never commit it.

Then open a **second** PowerShell window. A new window may open in a different folder (often your user folder), so go to the frontend folder using the **full path** to where you cloned the project. For example, if you ran the `git clone` command in `C:\Users\you\Projects`, run:

```powershell
cd C:\Users\you\Projects\HireFlow-AI\frontend
npm install
```

Replace `C:\Users\you\Projects` with your own folder. Tip: in File Explorer, open the `frontend` folder, click the address bar, type `powershell` and press Enter to open a PowerShell window already in that folder.

## Running the app

| Part | Command (from the folder shown) | Address |
|---|---|---|
| Backend | `uvicorn app.main:app --reload` (in `backend`, virtual environment active) | http://127.0.0.1:8000, health check at `/api/v1/health` |
| Frontend | `npm run dev` (in `frontend`) | http://localhost:5173 |

Open **http://localhost:5173/login** and sign in with the administrator you created. Each role lands on its own home page after sign-in.

## Testing

```powershell
# Backend (from backend\, virtual environment active). Uses an in-memory database: no PostgreSQL needed.
pytest
ruff check .

# Frontend (from frontend\)
npm test
npm run lint
npx tsc -b
npm run build
```

**Verified results** (Windows 10, Python 3.12, Node 24, last full run on 11 Nov 2026):

| Check | Result |
|---|---|
| Backend tests (pytest) | **2,626 passed** |
| Frontend tests (Vitest) | **1,589 passed** in 78 files |
| Ruff, oxlint, TypeScript | clean |
| Production build | succeeds |

The backend tests run on an in-memory SQLite database. Database behaviour that SQLite cannot prove (concurrency, constraints, migrations up and down) was rehearsed separately on throwaway PostgreSQL instances. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Demo accounts

No passwords are published in this repository. To try every role yourself:

1. Sign in as the administrator you created.
2. **Employees → Add employee** to create people (an *Employee* login needs an employee record).
3. **Users & accounts → New user**: choose the role (HR Manager, Recruiter, Employee), link the employee record, set a temporary password of at least 12 characters (the person must replace it at first sign-in).
4. Sign in with each account (a private window is handy) to see that role's home page and menu.

A suggested walkthrough of every module is in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#trying-every-role). Use fictional data only.

## Screenshots

Screenshots will be added in `docs/screenshots/`. Planned images:

| Role | Screens |
|---|---|
| Administrator | Admin Console · Users & accounts · Roles & permissions |
| HR Manager | HR dashboard · Leave approvals · Attendance records |
| Recruiter | Hiring pipeline · Requirements Coverage on an application · Interview detail |
| Employee | My Portal with Check in · Leave request · Attendance history |
| Mobile | Menu drawer at phone width |

_(Placeholders: no images yet.)_

## Current limitations and future enhancements

**Limitations (known and documented):**

- Not deployed; designed and tested for local use. There is no CI pipeline or container setup yet.
- No email sending (so no email-based password reset: an administrator resets passwords), and no multi-factor authentication.
- Resume files are stored on the server's local disk; scanned (image-only) resumes are not read (no OCR); no malware scanning.
- The resume parser and skill matching are rule-based and tuned for typical English resumes; version-suffixed skill names such as "Python 3.11" do not match "Python".
- Departments are free text rather than their own records. Single organisation (not multi-tenant).
- Privacy tooling (anonymisation, retention, export) supports good practice; it is **not** a legal compliance guarantee. Any use of automated comparison in hiring may be regulated where you operate.

**Future enhancements:** automated test pipeline and containers, email notifications and password reset, multi-factor authentication, object storage and virus scanning for resumes, OCR, department records, payroll, and performance reviews.

## Documentation

| Document | Topic |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system is built |
| [docs/DATABASE.md](docs/DATABASE.md) | Tables, migrations, backups |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Setup, running, testing, trying every role |
| [docs/ROLE_PANELS.md](docs/ROLE_PANELS.md) | Roles, permissions, menus, sign-in landing |
| [SECURITY.md](SECURITY.md) | Security and privacy model, reporting a problem |
| [docs/RECRUITMENT_PRIVACY.md](docs/RECRUITMENT_PRIVACY.md) · [RESUMES.md](docs/RESUMES.md) · [REQUIREMENTS_COVERAGE.md](docs/REQUIREMENTS_COVERAGE.md) | Recruitment data, resumes, advisory screening |
| [docs/INTERVIEWS.md](docs/INTERVIEWS.md) · [ATTENDANCE.md](docs/ATTENDANCE.md) · [LEAVE_MANAGEMENT.md](docs/LEAVE_MANAGEMENT.md) · [ANALYTICS.md](docs/ANALYTICS.md) | Module guides |
| [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) | Project status and future work |

## About this project

HireFlow AI was designed and built by **HareemRashidRana** as a portfolio project. It was developed with AI-assisted tooling (Claude Code): the product decisions, safety rules, review, testing and verification were directed and checked by me, and the commit history credits the assistant as co-author.

## Copyright and licence

Copyright © 2026 HareemRashidRana. **All rights reserved.** No open-source or other licence is granted. The code is public for viewing and educational review only; reuse, modification, redistribution or commercial use requires prior written permission (see the notice at the top of this page).
