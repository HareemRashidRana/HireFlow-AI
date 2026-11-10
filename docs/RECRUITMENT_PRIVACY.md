# Recruitment pipeline and candidate privacy (R2c, R2d)

> **Not legal advice.** These features give you the *tools* to review, export, anonymize and delete
> candidate data and to see who touched it. They do not by themselves make an organisation compliant
> with GDPR or any other law. The retention period, the legal basis recorded for each candidate and
> the decision to delete are organisational and legal decisions that need review by the people
> responsible for them.

## 1. Pipeline board (R2c)

Route: `/recruitment/pipeline` (list view: `/recruitment/applications`).

* **Eight columns**, one per stage: Applied, Screening, Shortlisted, Interview, Offer (in progress),
  Hired (successful) and Rejected, Withdrawn (ended). Each column header shows the **true total**.
* **Nothing is hidden.** A column loads 25 cards; "Load N more" fetches the next page
  (`GET /api/v1/applications/board/{stage}?page=`). The card count always reads "Showing X of Y".
  Extra pages are dropped whenever the board reloads, so a card never appears twice.
* **Cards** show the candidate's name and current title, the job, source, application date and the
  assigned recruiter, with links to the application, the candidate profile and the job.
* **Moving an application** is a button and a dialog, not drag and drop. Reasons: drag and drop is not
  keyboard accessible, the server only permits one step at a time (so most drops would be refused),
  and the dialog is where a rejection reason and the hiring warning belong. The dialog only offers
  the stages the server returned in `allowed_stages`; the server re-checks every move; a 409 (someone
  else changed it) refreshes the board.
* **Filters** (job, recruiter, source, applied-from/to) use the same names on the board and the list,
  are kept in the URL, and are carried when switching between the two views. The **search box is
  never put in the URL** (it usually holds a person's name or email). The Clear button shows how many
  filters are active.
* **Back links** return to where you came from (board, filtered list, candidate) with filters intact.
  Only in-app `/recruitment/...` paths are honoured.
* Recruiters are shown by login email: users have no display name, and adding one was not needed.

## 2. Candidate privacy (R2d)

Route: `/recruitment/privacy` (administrators and HR managers). Also on each candidate's profile.

### Audit trail

Table `candidate_audit_events` (append-only; the ORM refuses edits and deletes, and no API exists to
change it). Recorded, in the **same transaction** as the action (if the audit row cannot be written,
the action fails):

| Event | When |
|---|---|
| `candidate_viewed` | a single profile is opened (not list views, not every query) |
| `candidate_created` / `candidate_updated` | add / edit (field **names** only, never values) |
| `consent_changed` | consent basis or its date changed (old and new basis, which are enum values) |
| `candidate_exported` | once per exported candidate (format and single/bulk) |
| `candidate_anonymized` | counts of applications and notes cleared |
| `candidate_deleted` | a mistaken entry removed by hand |
| `candidate_purged` | removed by a retention purge (reason, retention date, was anonymized) |

Each row has: id, event type, candidate id (a plain column, **no foreign key**, so the trail outlives
the candidate), actor (kept as null if the user is later deleted), metadata, request id
(`X-Request-ID` if it looks safe, otherwise generated) and time. Metadata may contain only ids, field
names, counts and enum-like text: keys such as email, name, phone, `q`, token, password or note are
refused by the code. Search terms are never logged. Application views are **not** audited (scope
decision: the sensitive data is the candidate profile; routine pipeline work would flood the log).

Read it at `GET /api/v1/privacy/audit` (filters: `candidate_id`, `event_type`; paginated).

### Anonymization

`GET /candidates/{id}/anonymization-preview`, then `POST /candidates/{id}/anonymize` with
`{"confirm": true}` (admin, HR). It is idempotent and safe under concurrency.

| Changed | Fields |
|---|---|
| Replaced | first name -> "Anonymized", last name -> "Candidate", email -> `anonymized-<id>@anonymized.invalid` |
| Cleared | phone, location, current title, current company, basis explanation (replaced by fixed text if the basis is "other", which the database requires) |
| Kept | id, source, consent basis and date, last activity, retention date, created date, `anonymized_at` |
| Applications | **kept**: stages, dates, actors, event types. Free-text staff notes (`internal_notes`, history `note`) are cleared |

The originals are not stored anywhere else and cannot be restored. After anonymization the record
cannot be edited, and the person cannot be applied to a job. This is the one deliberate exception to
"application history is append-only", and it is limited to the free-text note columns.
Employee records are never touched.

### Export

`POST /candidates/{id}/export` and `POST /candidates/export` with `{"format": "csv"|"json"}` (bulk also
`source`, `retention`). POST so filters never appear in a URL. Admin and HR only.

* Includes contact and role details, source, legal basis and dates, retention dates, and each
  application's job, stage and dates. **Excludes** staff notes, rejection reasons, account or security
  data.
* CSV cells starting with `=`, `+`, `-`, `@`, tab or line breaks get a leading `'` (formula
  injection defence). UTF-8 with BOM so spreadsheets read names correctly.
* Filenames are `candidates-YYYY-MM-DD.csv|json` (no names or ids). `Cache-Control: no-store`.
* Bulk export is capped at `EXPORT_MAX_ROWS` (default 500); a larger request is **refused**, never
  truncated. Anonymized people are left out of bulk exports. There is no public or background
  download, and exported content is never logged.

### Retention review

`GET /privacy/retention?status=all|expiring|expired|anonymized` plus a summary. Dates come from the
existing rule: `retain_until = last meaningful activity + CANDIDATE_RETENTION_MONTHS` (default 12).
Meaningful activity is unchanged: adding a candidate, re-recording consent, creating an application,
changing its stage. Opening a profile, viewing this page, exporting, or editing contact details
does **not** extend retention.

### Purge (permanent deletion)

`POST /privacy/purge` with `{"dry_run": true|false, "confirm": "PURGE", "limit": 1..100}`.

* **Eligible** = past its retention date **and** has no applications. Candidates with hiring history
  are never deleted; anonymize them instead. Anonymized candidates with applications are kept.
* `dry_run` is the default and changes nothing (admin and HR).
* A real run needs **all** of: the admin role, `PRIVACY_PURGE_ENABLED=true` on the server (default
  **false**), the exact word `PURGE`. Otherwise 403 / 409 / 422.
* Bounded batches (default 50, max 100, oldest expiry first). The DELETE re-checks eligibility
  itself, so a candidate who gains an application between preview and delete is not touched.
  Repeating a run is harmless.
* Each deletion writes a `candidate_purged` audit row without personal data. Audit rows are never
  purged. **Nothing runs automatically**: there is no scheduler.

## 3. Permission matrix

| Action | Admin | HR manager | Recruiter | Employee |
|---|---|---|---|---|
| View / create / edit candidates, view board and applications | yes | yes | yes | no |
| Delete a mistaken candidate (no applications) | yes | yes | no | no |
| Retention review, audit trail | yes | yes | no | no |
| Export (single, bulk) | yes | yes | no | no |
| Anonymization preview and anonymize | yes | yes | no | no |
| Purge **preview** (dry run) | yes | yes | no | no |
| Purge **for real** | yes (if enabled) | no | no | no |

Everything is enforced by the API. The UI hides controls only as a convenience.

## 4. Endpoints added or changed

* `GET /applications/board` (now also `applied_from`, `applied_to`, `page_size`; each column has `page`,
  `page_size`, `has_more`), **new** `GET /applications/board/{stage}`
* Candidate cards in application lists now include `current_title`
* **new** `GET /privacy/retention`, `GET /privacy/audit`, `POST /privacy/purge`
* **new** `GET /candidates/{id}/anonymization-preview`, `POST /candidates/{id}/anonymize`,
  `POST /candidates/{id}/export`, `POST /candidates/export`
* Changed: `GET /candidates/{id}` is audited (and accepts `X-Request-ID`); create / edit / delete
  write audit rows.

## 5. Settings (placeholders only, see `backend/.env.example`)

```
CANDIDATE_RETENTION_MONTHS=12
PRIVACY_PURGE_ENABLED=false
EXPORT_MAX_ROWS=500
```

## 6. Migration

`2b9e429a0526` (parent `5773edf6f24d`) only **adds** `candidate_audit_events`. Apply with
`alembic upgrade head` from `backend/`, after taking a backup. Downgrade drops that table and the
audit history in it.

## 7. Known limitations

* The audit log is protected by the application (the ORM and the absence of any edit endpoint). A
  database administrator with direct SQL access could still alter it; a database trigger or
  write-once storage would be needed for stronger guarantees.
* PostgreSQL `TRIM` removes spaces only, so the database-level "explanation required" check for the
  basis "other" does not stop a note made only of tabs; the API does.
* Anonymization clears free text it knows about (candidate fields and the two note columns). It cannot
  find personal data a person typed into other free-text fields, nor remove copies in backups or in
  files already exported.
* Viewing a profile is audited per open; there is no de-duplication or rate limit.
* The board's extra pages reset when the board reloads (a filter change or a move).
* No automatic retention actions, no email notification of expiring candidates, no resume files yet.
