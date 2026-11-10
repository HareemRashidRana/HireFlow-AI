# Recruitment Analytics and HR Dashboard

The dashboard (`/dashboard`) is the landing page for Admin, HR Manager and Recruiter accounts. Every figure on it is calculated by the database from live HireFlow records. There is no sample data, no caching, and nothing on it can change a record.

Analytics are **aggregate counts only**. They never return a candidate's name, email, phone, notes, feedback or resume content, and they never rank or score people.

## What it needs

No database migration. Analytics are read-only queries over existing tables (`applications`, `application_events`, `job_postings`, `interviews`, `employees`, `candidates`). The schema is unchanged.

## Choosing what you see

| Filter | Effect |
|--------|--------|
| **Period** | Last 7 / 30 / 90 days, last 12 months, or a custom range (1 to 731 days). Default: last 30 days. |
| **Department** | Limits jobs, applications, interviews and (for the headcount) employees to that department. |
| **Job** | Limits everything except headcount to that job. |

Changing any filter immediately re-requests the data. An invalid custom range (blank dates, start after end, over 731 days) is explained on the page and sends nothing.

## Date handling

- A range is whole **local days**: the first day from 00:00 to the last day through 23:59:59, in the viewer's time zone (the browser's, sent as an IANA name such as `Asia/Karachi`; default `UTC` for direct API calls).
- The server turns those local midnights into UTC instants, so clock changes are handled: on the day clocks go forward the local day is 23 hours long, and an application at 00:00 local belongs to that day.
- The start is inclusive and the end is exclusive of the next day's midnight, so nothing is counted twice or dropped at a boundary.
- The chart groups by **day** (up to 31 days), **week** (up to 183 days; weeks start on Monday and the first bucket is partial) or **month** (longer). The bucket is chosen by the server and shown on the chart.

## Metric definitions

Each KPI card is labelled **Right now** (a snapshot that ignores the period) or **This period**.

| Metric | Definition |
|--------|------------|
| Employees | All employee records. "Active" is employment status *active*. Department filter applies. Right now. |
| Candidates | All candidate records. With a job or department filter: distinct candidates who have applied to those jobs (any time). Right now. |
| Open jobs / Closed jobs | Jobs whose status is open / closed (drafts and on-hold jobs are neither). Filters apply. Right now. |
| Upcoming interviews | Interviews that are **scheduled or confirmed** and start from now onward. Cancelled interviews and the *rescheduled original* of a moved interview are never upcoming; the replacement is. Right now. |
| Applications | Applications whose **applied date** is in the period. |
| Hires | Applications whose recorded **hire event** is in the period. |
| Completed interviews | Interviews with status *completed* that **start** in the period. |

### Recruitment funnel

The funnel shows where each application is **now** (its current stage), for applications received in the period. Every application is counted exactly once, so the eight rows (Applied, Screening, Shortlisted, Interview, Offer, Hired, Rejected, Withdrawn) add up to the Applications total.

- It is *not* a count of how far applications ever got. An application now at Offer is not also counted under Interview.
- A **reopened** application counts where it is now, not where it was rejected from.
- Hired, rejected and withdrawn are final outcomes. Hired is never reopened.
- Historical stage events appear only in the explicitly labelled trend lines (hires) and in recent activity.

### Trends

Three lines over time, from real timestamps:

- **Applications**: by applied date.
- **Interviews**: scheduled, confirmed and completed interviews, by start time. Cancelled and rescheduled-original interviews are not counted.
- **Hires**: by the date of the hire event.

The vertical axis starts at 0 and uses round whole-number steps. Lines differ by dash pattern as well as colour, and every chart has a text summary and a data table for screen readers.

### Interviews

Counts by status for interviews that start in the period, plus a breakdown by type of those scheduled, confirmed or completed (cancelled and moved ones are not "held or planned").

### Sources

Applications received in the period, grouped by each application's **recorded source** (Referral, LinkedIn, Job board, Agency, Direct, Other). The source field is required, so an "Unknown / Not specified" bucket appears only if a row ever lacks one. Nothing is inferred.

### Time to hire

The average number of days from an application's **applied date** to its **hire event**, for hires made in the period, rounded to 0.1 day.

The hire date comes only from the append-only history (the "hired" event written when HR moves an application to Hired). A hired application with no such event is **not guessed**: it is left out of the average and reported ("N hired applications have no recorded hire date"). The funnel still counts it as Hired because it is by current stage.

### Job performance

One row per job matching the filters, for applications received in the period: applications, interviews (scheduled, confirmed or completed interviews belonging to those applications, whenever they take place), hired and rejected (by current stage) and conversion. Conversion is hired divided by applications, shown as `n/a` when a job had no applications (never 0%). Sorted by applications, then title. Paged (up to 50 per page).

### Recent activity

The eight latest application events (created, moved, rejected, withdrawn, hired, reopened, assigned), each with the **job title** and stage, never a person. Each links to the application page, which has its own access rules.

## API

All routes are `GET`, under `/api/v1/analytics`, and need a signed-in Admin, HR Manager or Recruiter.

| Route | Returns |
|-------|---------|
| `/overview` | `period`, `kpis`, `funnel`, `trends`, `interviews`, `sources`, `time_to_hire`, `recent_activity` |
| `/jobs` | The job performance table (`items`, `total`, `page`, `page_size`) |
| `/filter-options` | Jobs (id, title, department, status; up to 500) and departments for the filter dropdowns |

Query parameters for `/overview` and `/jobs`: `start`, `end` (dates, inclusive), `timezone` (IANA, max 64 characters), `job_id` (UUID), `department` (max 100 characters). `/jobs` also takes `page` and `page_size` (1 to 50). Bad values return 422; an unknown `job_id` returns 404; a range over 731 days returns 422.

## Access control

| Role | Access |
|------|--------|
| Admin, HR Manager | Full analytics |
| Recruiter | The same analytics |
| Employee | None: 403 on every route, and no Dashboard link |

Recruiters can already read every application, job and the employee directory in HireFlow, so analytics reveal nothing they cannot already see; there is no per-recruiter visibility restriction to preserve. Access is decided before any filter is read, so an employee cannot learn whether a job exists. Signing in sends recruitment staff to the dashboard and employees to their profile.

## Query strategy

- Everything is SQL aggregation (`COUNT`, `SUM`, `AVG`, `GROUP BY`) in the database. No table is loaded into Python.
- The overview runs about 15 statements, and the number does **not** grow with the amount of data (verified by tests with 2 and 40 applications). The job table is 6 or fewer statements for any number of jobs. No N+1.
- Time buckets are computed in SQL with a `CASE` over the bucket boundaries, so the database groups the rows.
- Nothing is cached, so figures can never be stale or shown to someone who should not see them. Filters are bound parameters, never concatenated into SQL.
- Existing indexes cover most filters (`applications.applied_at`, `applications.job_id`, job department and status, interview start time and status). The hire-event lookup filters `application_events` by event type, which has no dedicated index, so it reads that table. That is fine at HireFlow's current size; if the history grows into the millions, an index on `(event_type, created_at)` would be the first thing to add. It was left out because it needs a migration, which this release deliberately avoids.
- Verified on PostgreSQL 16 as well as SQLite.

## Known limitations

- **Hire dates** exist only for hires made through HireFlow's history. Records created or imported another way show up as "no recorded hire date".
- **Stage-to-stage conversion** and time spent in each stage are not shown: the funnel is current state, not a cohort journey.
- **Department** is free text on jobs and employees (there is no departments table), so "Sales" and "sales " are different departments until that module exists.
- **Interview counts per job** follow the application's received date, not the interview's date.
- **Today's figures** are live but the page does not refresh itself; change a filter or reload to update.
- The headcount ignores the date range (it is a snapshot).
- Maximum range is 731 days; the job filter list shows the first 500 jobs by title.
