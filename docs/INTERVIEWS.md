# Interview Management

Interviews are scheduling plus human-written feedback. They never rank, score or filter candidates, never use AI, and never change an application's stage. Moving a candidate between stages stays a separate, deliberate action on the pipeline.

> **Deployment note.** This module needs migration `d34d0c31088c` (parent `e06ccfa51fe7`). Apply the migration **before** running the new backend code: the anonymization and export paths read the new tables. Back up the database first.

## Who can use it

Admin, HR Manager and Recruiter can use interviews. Employees cannot (they get 403 from the API and no menu entry or card in the UI).

| Action | Who |
|--------|-----|
| Schedule, update, confirm, complete, cancel, reschedule, change interviewers | Admin, HR Manager, Recruiter (on interviews that are still open) |
| See interviews, the calendar, stats, history | Admin, HR Manager, Recruiter |
| Write, save a draft of, submit and edit feedback | Only the interviewer it belongs to |
| Read other interviewers' **submitted** feedback | Admin and HR Manager |
| Read anyone's draft or private notes | Nobody except the author |

A recruiter who is not on an interview sees it, but only their own feedback. Unknown, hidden or cross-candidate identifiers return 404 rather than revealing that something exists.

## Scheduling workflow

1. Open an application and use **Schedule interview** (or **Interviews → Schedule interview** and pick the application).
2. Give a title, type, mode, date, start and end time, time zone, location or meeting link, and one or more interviewers.
3. The server checks for conflicts and creates the interview as **Scheduled**. The application's stage is untouched.

Rules enforced by the server (and mirrored as friendly checks in the form):

- The start must be in the future; the end after the start; a duration of 5 minutes to 12 hours.
- Interviewers must be active staff (Admin, HR Manager, Recruiter).
- An in-person interview needs a location. A meeting link must be `https`, at most 500 characters, with no username/password, fragment, whitespace, or secret-looking query value (`pwd`, `password`, `token`, `key`, `secret`, `otp`, `jwt`, `sig`, …). Links are stored as plain text and are never put in audit events.
- Closed applications (hired, rejected, withdrawn) and anonymized candidates take no new interviews (409).

## Lifecycle

```
scheduled ──confirm──▶ confirmed ──complete──▶ completed
    │                      │
    ├──cancel / reschedule─┤
    ▼                      ▼
cancelled              rescheduled  (a new linked interview takes its place)
```

- Allowed moves are listed in one table (`TRANSITIONS`); any other move is refused with a clear message.
- **Confirm** is only from Scheduled. **Complete** is only once the start time has passed.
- **Cancel** needs a reason, and keeps the interview as a record. A completed interview cannot be cancelled.
- **Reschedule** never edits history: the original becomes `rescheduled` and a **new** interview is created, linked both ways. It is checked for conflicts like any new interview.
- Interviews can never be deleted (`DELETE /interviews/{id}` is 405). Cancel or reschedule instead.
- Every change is written to the interview's own append-only history (who, when, what kind of change).

## Time zones

- Times are stored as UTC instants together with an IANA zone name (for example `Asia/Karachi`).
- The client sends a **local** date and time plus the zone. The server resolves it to UTC, so browsers in other zones cannot disagree.
- A local time that does not exist (clocks go forward) or is ambiguous (clocks go back) is refused with an explanation instead of being guessed.
- Responses include `starts_local`, `ends_local` and `utc_offset`, so every screen shows the clock time in the interview's own zone, with its offset.

## Conflict rules

- An interviewer cannot be on two interviews whose times overlap. The same applies to the candidate's own application.
- Only **scheduled, confirmed and completed** interviews occupy time. Cancelled and rescheduled ones do not.
- Back-to-back interviews (10:00–11:00 then 11:00–12:00) do not conflict.
- The error names the person and the interview they are already booked for.
- Conflicts are race-safe: creation, reschedule and adding an interviewer lock the application row and then the interviewer rows (in id order) before checking, so two simultaneous requests cannot both succeed. This was verified with real concurrent requests on PostgreSQL. SQLite ignores row locks, so the concurrency test is a PostgreSQL rehearsal, plus a structural test of the lock order.

## Feedback

- Feedback is written by the interviewer, by hand. There is no generation, suggestion, summary, ranking or averaging anywhere.
- Fields: an overall rating and overall feedback (required to submit), optional technical, communication and problem-solving ratings, strengths, concerns, and **private notes**.
- Ratings use a described 1–5 scale (`GET /interviews/rating-scale`): 1 Well below expectations … 5 Well above expectations. The UI always shows the words with the number.
- A **draft** may be incomplete and is visible only to its author. A draft can be saved before the interview; **submitting** is allowed once it has started.
- Editing submitted feedback requires a reason, increments a version, and keeps every earlier version (append-only), up to 10 edits. Earlier versions never include private notes.
- Private notes are returned only to their author, in every endpoint.
- Admin and HR Manager see who has submitted and who has not, with no scores combined.

## API

All routes are under `/api/v1` and need a signed-in Admin, HR Manager or Recruiter.

| Method and route | Purpose |
|------------------|---------|
| `GET /interviews` | List. Filters: `q`, `status`, `interview_type`, `application_id`, `job_id`, `interviewer_id` (a user id or `me`), `starts_from`, `starts_to`, `order` (`asc`/`desc`, by start time only), `page`, `page_size` (max 100). |
| `POST /interviews` | Schedule |
| `GET /applications/{id}/interviews` | Interviews of one application |
| `GET /interviews/{id}` | Detail, with `allowed_actions` for the caller |
| `PATCH /interviews/{id}` | Edit title, type, mode, location, link |
| `POST /interviews/{id}/confirm` · `/complete` · `/cancel` · `/reschedule` | Lifecycle (cancel needs `reason`; reschedule returns the new interview) |
| `POST /interviews/{id}/interviewers` · `DELETE /interviews/{id}/interviewers/{user_id}` | Change interviewers (never the last one) |
| `GET /interviews/{id}/history` | Append-only history |
| `GET /interviews/stats` | Real counts from the database: upcoming, by status, feedback pending/submitted, next 14 days |
| `GET /interviews/interviewers` | Staff who can be assigned |
| `GET /interviews/rating-scale` | The rating scale |
| `GET` / `PUT` / `PATCH /interviews/{id}/feedback`, `POST …/feedback/submit`, `GET …/feedback/{fid}/revisions` | Feedback |

There is no sort-by-rating parameter and no endpoint that returns an average.

## Privacy and audit

- Audit events record only ids, counts and a kind (for example `interview_scheduled`, `interview_feedback_submitted`). The audit writer rejects keys such as `meeting_url`, `feedback`, `private_notes`, `comments`, and any free text. Candidate names and emails are never in them.
- **Anonymizing a candidate** removes the interview's title text, location, meeting link and cancellation reasons, and the written feedback and private notes (and the text in earlier versions). Times, statuses, ratings and who attended are kept, and the UI says so. The privacy preview shows how many interviews and feedback records will be affected.
- **Export** of a candidate lists their interviews as metadata only (type, round, status, time), never feedback text or private notes.
- Downgrading the migration refuses to run if any interviews or interview audit events exist, so data cannot be dropped by accident.

## Limitations

- No calendar integration (Google, Outlook, ICS) and no emails or reminders are sent; times are tracked inside HireFlow only.
- Interviewers must be staff users with a HireFlow account. External panellists are not supported.
- Conflict detection covers HireFlow interviews only, not interviewers' other calendars, working hours or holidays.
- Conflict safety relies on PostgreSQL row locks. Use PostgreSQL in any shared deployment.
- No availability search or auto-scheduling; people choose the time.
- The calendar shows one week at a time.
