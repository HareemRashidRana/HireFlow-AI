# Security and privacy

HireFlow AI handles personal data (employees and job candidates), so security and privacy shaped the design from the start. This page describes what the project does, what it deliberately does not do, and how to report a problem.

> HireFlow AI is a portfolio project designed for local use and has not been through an independent security audit or penetration test. It is not deployed by this repository.

## What is implemented

**Authentication**
- Passwords hashed with **Argon2id**; minimum strength rules; no self-registration (administrators create accounts).
- Short-lived (15 minute) **JWT access tokens**, signed with a pinned algorithm (HS256) and checked for type, held **in memory only**.
- **Rotating refresh tokens** (7 days, 30-day session cap) in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` outside development). Reusing an old refresh token is treated as theft and revokes the whole session.
- **Lockout and rate limiting:** failed sign-ins are counted over a rolling 15-minute window. Once an account has 5 failures, or one IP address has 30, further sign-in attempts are refused with a "try again in N minutes" message until the older failures leave the window. Refused attempts are not recorded, so an attacker cannot keep extending the lock. A successful sign-in clears that account's recorded failures. Sign-in responses do not reveal whether an email exists.

**Authorisation**
- Four roles with server-side checks on every route. Hidden menu items are a convenience, not a control. See the [permission matrix](docs/ROLE_PANELS.md#permission-matrix).
- Employees can only read their own attendance, leave and profile. Nobody approves their own leave. An administrator cannot change their own role or deactivate themselves.
- Cross-site requests are limited by CORS (`CORS_ORIGINS`), the `SameSite=Strict` cookie and the bearer access token.

**Data protection and privacy**
- Resume uploads: PDF/DOCX only, content-checked, size-limited, stored privately under random names, never served as static files.
- Candidate **audit trail** (append-only; refuses resume-derived content), **anonymisation**, **CSV/JSON export**, **retention review**, and an opt-in permanent purge (admin only, disabled unless `PRIVACY_PURGE_ENABLED=true`). See [docs/RECRUITMENT_PRIVACY.md](docs/RECRUITMENT_PRIVACY.md).
- No salary, government ID, address or date of birth is stored.
- **Human in the loop:** resume parsing and Requirements Coverage are advisory and auditable; they never reject, rank, hide or hire a candidate.

**Secrets**
- `backend/.env` is generated locally with random secrets and is git-ignored; only `.env.example` (placeholders) is tracked. Database and account passwords are only ever entered at hidden prompts.

## Known limitations

- No multi-factor authentication and no email-based password reset (an administrator resets passwords).
- No malware scanning of uploaded files; resumes live on local disk.
- No automated dependency or secret scanning pipeline yet.
- Privacy tools support good practice but are **not** a legal compliance guarantee (GDPR or other laws). Using automated comparison in hiring may be regulated in your region.
- Not hardened for internet exposure: if anyone deploys it, they need HTTPS, a production database, backups, monitoring and a security review first.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Contact the repository owner privately through their GitHub profile ([@HareemRashidRana](https://github.com/HareemRashidRana)) and include steps to reproduce. Never include real personal data in a report.

## Usage terms

The source code is publicly viewable for educational review only; it is not licensed for reuse. See the copyright notice in the [README](README.md).
