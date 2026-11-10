# Leave management

Employees request leave, HR decides, and balances are kept in an append-only ledger so every day taken or given back can be traced to a person and a reason.

> **Deployment note.** Needs migration `99db234e646c` (see [ATTENDANCE.md](ATTENDANCE.md)). It seeds five leave types (annual 14 days, sick 10, casual 8, unpaid, other) and the default working rules, but **no balances**: HR grants them from the Balances page.

## Who can do what

| Action | Employee, Recruiter | HR Manager, Admin |
|--------|---------------------|-------------------|
| Request leave, withdraw their own pending request, cancel their own approved leave that has not started | Yes (linked employee needed) | Yes, same |
| Read their own requests, history, balances | Yes | Yes |
| Read **anyone else's** request or balances | No: 404 for a request id, 403 for lists | Yes |
| Approve or reject a request | No (403) | Yes, but **never their own** |
| Cancel someone else's approved leave | No (404) | Yes, with a reason |
| Grant yearly entitlements, adjust a balance, manage leave types | No (403) | Yes |
| See who is on leave (calendar) | Only their own, plus company holidays | Everyone's approved leave |

A request id that belongs to someone else looks like "not found" to a non-HR user, so ids cannot be probed. Nobody can decide their own request, whatever their role; another HR manager or administrator has to. The screen mirrors this by never offering the buttons, but the server enforces it.

## Lifecycle

```
          submit                approve                    cancel (before it starts)
 (none) ─────────▶ pending ─────────────▶ approved ─────────────────────────────▶ cancelled
                   │   │                                          (days returned)
        withdraw   │   └── reject (reason required) ──▶ rejected
        (owner)    ▼
               withdrawn
```

Every step is recorded in an append-only history with who, when and why (`GET /leave/requests/{id}/history`).

## Rules

- **Dates.** The end may not be before the start. A request may not span two calendar years (submit one per year). It may start at most N days in the past (a working rule, default 30) so sick leave can be recorded after the fact. Whole days only.
- **Working days.** Counted from the working rules: weekends and non-working days are skipped, and so are company holidays. A holiday that falls on a weekend is counted once, as a weekend. A range with no working days is refused. The count is **frozen when the request is submitted**: adding or removing a holiday or changing the work week later never changes requests already made or approved.
- **Overlap.** An employee may not have two pending or approved requests that share a date. Rejected, withdrawn and cancelled requests never block. Different employees may take the same days.
- **Balance.** For a leave type that tracks a balance, the days requested must fit in `entitlement − used − pending`. Pending requests reserve days, so two requests cannot both claim the last days. Approval re-checks the real ledger balance.
- **Unpaid and other types.** Unpaid leave never has a balance and can never touch a paid balance; "other" tracks none by default. A type that is not paid cannot be set to track a balance.
- **Approval** writes exactly **one deduction** to the ledger, once. Approving something already decided is refused.
- **Cancellation.** Only approved leave that has **not started** can be cancelled, by its owner or HR (HR must give a reason). It writes exactly **one reversal** giving the days back. Leave that has already begun cannot be cancelled; HR corrects the balance with an adjustment instead.
- **Adjustments.** HR can add or remove days for a type and year, always with a reason, and never below zero.
- **Entitlements.** "Grant" gives every active employee each tracked type's yearly days for a year, once; running it again changes nothing. There is no proration or automatic carry-over.

## The ledger and balances

A balance is never stored. It is the sum of the ledger for an employee, leave type and year:

| Entry | Sign | Written when |
|-------|------|--------------|
| `allocation` | + | HR grants the year (once per employee, type and year) |
| `deduction` | − | A request is approved (once per request) |
| `reversal` | + | Approved leave is cancelled (once per request) |
| `adjustment` | ± | HR corrects a balance, with a reason |

`used` on screen is deductions net of reversals; `pending` is the days of requests not yet decided; `available = entitlement − used − pending`. The ledger is append-only (code and tests refuse edits and deletes), and the database enforces the shape of each entry and the "exactly once" rules with unique partial indexes, so a duplicate deduction or reversal is impossible even if the application code were wrong.

## Concurrency

Everything that changes one employee's leave takes a row lock on that employee first (`SELECT … FOR UPDATE`), then re-reads the request. Two people approving the same request, an approval racing a withdrawal, repeated cancellations, overlapping submissions and requests that together exceed the balance were all tested with real concurrent threads on PostgreSQL: exactly one wins each time, the ledger always matches the request status, and no balance is deducted twice. SQLite ignores row locks, so the automated suite proves the lock order structurally and relies on the database's unique indexes; the PostgreSQL race run is part of the deployment rehearsal.

## Endpoints

All under `/api/v1/leave` unless stated.

| Route | Who | Purpose |
|-------|-----|---------|
| `GET /types`, `POST /types`, `PATCH /types/{id}` | read: signed in (HR sees inactive too); write: HR | Leave types |
| `GET /balances/me?year=` | self | Own balances (defaults to the current year) |
| `GET /balances?employee_id=&year=` | HR | Anyone's balances |
| `POST /balances/allocate`, `POST /balances/adjust` | HR | Grant a year, adjust with a reason |
| `GET /preview?start_date=&end_date=` | signed in | Working days, weekends and holidays skipped |
| `POST /requests` | self | Submit |
| `GET /requests/me` | self | Own requests, `status`, paging |
| `GET /requests` | HR | All requests: `employee_id`, `status`, `type_id`, `start`, `end`, paging |
| `GET /requests/{id}`, `GET /requests/{id}/history` | owner or HR | One request and its history |
| `POST /requests/{id}/approve`, `/reject` | HR (not own) | Decide (reject needs a reason) |
| `POST /requests/{id}/withdraw` | owner | Withdraw a pending request |
| `POST /requests/{id}/cancel` | owner or HR | Cancel approved leave that has not started |
| `GET /calendar?month=YYYY-MM` | signed in | Holidays; own leave; everyone's leave for HR |
| `GET /stats` | HR | Pending, on leave today, approved days this month, starting in 14 days |

## Time zones

Leave dates are plain calendar days, and "today" (for back-dating and "has it started") is the date in the company time zone. Working days are counted by calendar, so a clock change can never add or remove a leave day.

## Limitations

- Whole days only: no half days or hours.
- A single approval step by HR or an administrator: no manager approval chain, delegation or notifications. Requests are not emailed.
- A request cannot span two calendar years.
- Yearly entitlements are a fixed number of days per type: no accrual, proration, carry-over or expiry rules (HR can use adjustments).
- Holidays are company-wide; there are no per-location or per-employee calendars.
- Recorded attendance on a day of approved leave is allowed and is not flagged.
- "Approved days this month" on the dashboard counts a request in the month it starts.
