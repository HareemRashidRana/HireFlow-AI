# Attendance

Employees check in and out, see their own history, and HR sees everyone's, adds missing records and corrects mistakes. Nothing is invented: a day nobody checked in has no record, and absence is calculated from the calendar.

> **Database note.** This module (with leave) is created by migration `99db234e646c`, parent `d34d0c31088c`. It creates eight tables and inserts the default working rules and five leave types; it changes no existing table. When upgrading an existing database, take a backup, apply the migration, **then** restart the backend. Until it is applied the new pages show a clear error and everything else keeps working. See [DATABASE.md](DATABASE.md).

## Who can do what

| Action | Employee, Recruiter | HR Manager, Admin |
|--------|---------------------|-------------------|
| Check in and out, read **their own** history and summary | Yes, if their login is linked to an employee record | Yes, same condition |
| Read anyone's records, summaries, day statistics | No (403) | Yes |
| Add a missing record, correct a record, read its correction history | No (403) | Yes |
| Change working rules and holidays | No (403) | Yes |
| Edit or delete their own record | **Impossible**: no such route exists | Only through a reasoned correction |

Self-service always acts on the employee linked to the signed-in login. The request cannot name someone else: the `/attendance/me/...` routes take no employee id, and a stray `employee_id` is ignored. A login with no linked employee gets a clear 409, not someone else's data.

## Rules

- **One record per employee per local day**, with one check-in and one check-out.
- **No duplicate active check-in.** A second check-in while one is open is refused, and so is a second one after checking out the same day. A partial unique index makes this true even under a race.
- **Check-out needs an open check-in**, and must be strictly after it, so a duration is never negative or zero.
- **Only active employees** can check in.
- **Time comes from the server.** The browser never supplies a time; the clock is the server's, stored as UTC.
- **Stale check-ins.** An open check-in from an earlier day blocks a new one, and a check-in older than 16 hours cannot be closed by the employee. HR closes it with a correction.
- **Overnight shifts** work up to 16 hours: the record belongs to the day of check-in, and the check-out may fall after midnight. Longer or multi-record shifts are not supported (see limitations).

### Late, early and duration

All judged in the **company time zone** from the working rules (below):

- **Late**: the check-in is after the start of the working day plus the grace period, counted through the end of its last minute. With 09:00 and 10 minutes, 09:10:59 is on time and 09:11:00 is late.
- **Left early**: the check-out is before the end of the working day.
- Neither applies on a weekend, a non-working day or a company holiday.
- **Worked time** is whole minutes between check-in and check-out, rounded down.

### Absent

Absence is **computed, never stored**. For a finished working day (not a weekend, not a holiday), an employee is absent if they have no record and no approved leave. Today is not counted until it has ended, so nobody is marked absent in the morning.

## HR corrections

HR can **add** a record for a day the employee did not check in, or **change** the times of an existing one. Both:

- require a reason;
- refuse times in the future, a check-in outside the record's day, and a check-out not after the check-in;
- recompute late, early and duration with the same rules;
- mark the record `corrected` (and `source = hr` for added ones), so it is visible everywhere;
- write an **append-only** entry holding who did it, when, why, and exactly what the record was before and after. Entries cannot be edited or deleted, in code or by the database layer.

## Working rules and holidays

One settings row, managed by HR on the **Work schedule** page: company time zone (IANA name), working days, start and end of the day, grace period (0 to 240 minutes) and how many days in the past leave may start. Holidays are a list of dates with names. Defaults: Monday to Friday, 09:00 to 17:00, UTC, 10 minutes' grace, 30 days. Removing or adding a holiday never rewrites leave that was already approved.

## Time zones

Instants are stored as UTC with the zone that applied recorded on each record. The **local day** and every judgement (late, early, working day) use the company zone, including on clock-change days: a check-in at 00:30 local belongs to that local date even when it is still "yesterday" in UTC. The browser shows times in the record's own zone.

## Endpoints

All under `/api/v1`. "Self" means the signed-in login's own employee.

| Route | Who | Purpose |
|-------|-----|---------|
| `GET /attendance/me/today` | self | Today's state, worked minutes, schedule, holiday and leave notes |
| `POST /attendance/check-in`, `POST /attendance/check-out` | self | Start and finish |
| `GET /attendance/me/records` | self | History: `start`, `end`, `late`, `page`, `page_size` |
| `GET /attendance/me/summary?month=YYYY-MM` | self | Present, late, early, absent, leave days, hours |
| `GET /attendance/stats?date=` | HR | Expected, present, late, still in, finished, on leave, not checked in |
| `GET /attendance/records` | HR | Any records: `employee_id`, `start`, `end`, `late`, `state`, `department`, paging |
| `GET /attendance/summary?month=` | HR | Per employee for a month, paged |
| `POST /attendance/records` | HR | Add a missing record (reason required) |
| `PATCH /attendance/records/{id}` | HR | Correct times (reason required) |
| `GET /attendance/records/{id}/corrections` | HR | The audit trail |
| `GET`/`PUT /work-settings` | read: anyone signed in; write: HR | Working rules |
| `GET /holidays?year=`, `POST /holidays`, `DELETE /holidays/{id}` | read: anyone signed in; write: HR | Holiday calendar |
| `GET /analytics/workforce` | HR | Dashboard figures (below) |

## Dashboard

For Admin and HR Manager, the main dashboard shows, from the real tables: present today (of expected), late arrivals, employees on approved leave, pending leave requests, the month's attendance rate and approved leave days per month for six months. The attendance rate is the share of *finished* working days attended, with approved leave taken out of the expected total; it shows "n/a" until a working day has finished. Recruitment analytics are unchanged.

## Limitations

- One check-in and check-out per day: no breaks, split shifts or multiple sessions.
- No shift management: one company-wide schedule. Overnight work is limited to 16 hours per record.
- Check-in trusts the signed-in person and the server clock. There is no location, IP, device or photo verification.
- No automatic check-out and no reminders or notifications.
- Late and early judgements use the schedule in force at the moment of recording or correction; changing the schedule later does not re-judge old records.
- Absence is not a stored status, so it cannot be excused or annotated apart from approved leave or an HR-added record.
- Employees who have attendance or leave records cannot be deleted (set them inactive or terminated).
