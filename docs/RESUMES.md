# Resume management and parsing (R3)

> **Not legal advice.** Resumes are personal data. This module gives you tools (private storage,
> access control, an audit trail, deletion that also removes files) but it does not by itself make an
> organisation compliant with GDPR or any other law. Retention periods, the legal basis for holding a
> resume and the decision to delete are organisational and legal decisions.

Resumes are uploaded for a **candidate** (optionally tied to one of their applications), stored
privately, read automatically into suggested structured data, and **only ever copied into anything
else after a person reviews them**. Nothing here scores, ranks or rejects anyone.

## 1. What it does

| Area | Behaviour |
|------|-----------|
| Upload | PDF or DOCX only, up to **5 MB** (`RESUME_MAX_BYTES`), at most **20 versions per candidate** (`RESUME_MAX_PER_CANDIDATE`). One file per request. |
| Versions | Every upload is a new version. The **newest upload becomes the active resume**; any version can be made active again. Exactly one version per candidate is active (enforced by a database index, not just code). |
| Duplicates | The same file (SHA-256) cannot be uploaded twice for the same candidate: `409`. |
| Reading | Text is extracted from the stored file (PDF via `pypdf`, DOCX via `python-docx`) and parsed with deterministic rules. |
| Review | A human checks and corrects the parsed values and explicitly confirms them. This is stored **separately** from the machine reading. |
| Download | Through an authenticated endpoint only. The browser always gets a neutral name (`resume-v2.pdf`), never the uploaded name. |
| Delete | Removes the database row **and** the stored file (admin and HR manager only). |
| Privacy | Anonymizing, hard-deleting or purging a candidate removes their resume files too. |

Routes (all under `/api/v1`, all require sign-in):

| Method and path | Purpose | Roles |
|---|---|---|
| `GET /candidates/{id}/resumes` | list versions (metadata only) | admin, HR, recruiter |
| `POST /candidates/{id}/resumes` | upload (`multipart/form-data`, field `file`, optional `application_id`) | admin, HR, recruiter |
| `GET /resumes/{id}` | one resume's metadata | admin, HR, recruiter |
| `GET /resumes/{id}/parsed` | machine reading and the reviewed values | admin, HR, recruiter |
| `GET /resumes/{id}/download` | the file | admin, HR, recruiter |
| `POST /resumes/{id}/parse` | read the file again (retry) | admin, HR, recruiter |
| `PUT /resumes/{id}/review` | save reviewed values (needs `confirm: true`) | admin, HR, recruiter |
| `POST /resumes/{id}/activate` | make this version the active one | admin, HR, recruiter |
| `PATCH /resumes/{id}` | link to / unlink from one of the candidate's applications | admin, HR, recruiter |
| `DELETE /resumes/{id}` | delete the file and the row | **admin, HR** |

Employees have no access to any of it. The UI hides what a role cannot do, but the server re-checks
every request. There is no UI for the application link yet (the API supports it).

## 2. Where files live (and where they do not)

* Files are written under `RESUME_STORAGE_DIR` (default `backend/storage/resumes`, git-ignored) as
  `<aa>/<32 random hex characters>` with **no extension and no relation to the uploaded name**.
  The folder is never served by the web server; the only way to a file is `GET /resumes/{id}/download`.
* The database holds metadata only: the display name (sanitised, never used as a path), size,
  checksum, status, version, who uploaded and when. **The extracted text is not stored**; only its
  length. The parsed and reviewed values are stored as JSON in `parsed_data` / `reviewed_data`.
* Writes are atomic: the upload streams (in bounded chunks) to a temp file, is validated, then moved
  into place. A crash mid-upload leaves at most a temp file, never a half-written resume.
* Files are deleted **after** the database change commits. If the delete itself fails the file is
  left as an *orphan* (never the reverse: a row pointing at a missing file after a "successful"
  delete). Clean orphans up with:

```bash
cd backend
python scripts/cleanup_resume_files.py            # report only
python scripts/cleanup_resume_files.py --delete   # remove unreferenced and stale temp files
```

Back up `RESUME_STORAGE_DIR` together with the database; one without the other is not a backup.

## 3. How an upload is checked

The browser's claims are never trusted.

1. **Size**: a request declaring more than the limit gets `413` before the body is read (an ASGI
   middleware), and the body is also counted while streaming, so a client that lies is cut off.
2. **Extension** must be `pdf` or `docx`; the **declared MIME type** must be one a browser may send
   for those (or empty / `application/octet-stream`).
3. **Signature**: `%PDF-` for PDF; for DOCX a ZIP that contains `[Content_Types].xml` and
   `word/document.xml`. The detected kind must **match the extension** (a PDF renamed `.docx`, or an
   `.exe` renamed `.pdf`, is refused with `415`).
4. **DOCX safety**: macro projects (`vbaProject.bin`) are refused; ZIP entry count, total expanded
   size and compression ratio are capped (zip-bomb defence).
5. **PDF safety**: password-protected and damaged files are reported, not crashed on; page count and
   extracted text are capped (`RESUME_MAX_PDF_PAGES` = 40, `RESUME_MAX_TEXT_CHARS` = 200 000).
6. The display filename is normalised (no directories, no control characters, bounded length, the
   extension is kept).

## 4. Reading the text and parsing

Parsing is **deterministic**: the same text always gives the same result. It uses regular
expressions and section headings, with no machine-learning model and no network calls. It extracts:
name, email, phone, skills, education, work experience (title, company, dates), and an *estimated*
total experience computed from the dates it found (never stored; shown as an estimate).

* Every value carries a **confidence** (high / medium / low). The review screen shows it so a person
  knows what to check first. It describes the machine's reading, not truth.
* It **never invents a value.** A field it cannot find stays empty, with a warning
  (`no_phone`, `no_skills_section`, `multiple_emails`, `text_truncated`, ...).
* Each line is read only up to 600 characters and the patterns are bounded, so a hostile file cannot
  make the parser burn CPU.
* A **scanned/image-only PDF** has no text to read. It is reported as "No readable text"
  (`ocr_unavailable`). **There is no OCR.** Such a resume can still be downloaded by a person.
* Status values: `pending`, `processing`, `parsed`, `no_text`, `failed`, `removed`. Reading happens
  during the upload request. "Read again" retries a failed or empty reading; two simultaneous retries
  are guarded by a database claim (a stale claim expires after 5 minutes).

### Human review (nothing is automatic)

`PUT /resumes/{id}/review` stores what a person confirmed, with who and when. It requires
`confirm: true`, and the UI makes the reviewer tick *"I have checked these details against the
resume"* (the tick is cleared whenever a value changes). **Saving a review does not change the
candidate's profile.** Parsed data is never copied to the candidate automatically; a separate,
deliberate step would be needed for that and does not exist yet.

## 5. Privacy, retention and audit

* **Audit** (the append-only candidate audit trail, shown to HR/admin on the candidate page): `resume_uploaded`,
  `resume_downloaded`, `resume_viewed`, `resume_parsed`, `resume_parse_retried`, `resume_reviewed`,
  `resume_activated`, `resume_updated`, `resume_deleted`. Entries hold ids, version numbers, sizes,
  statuses and error codes only; the audit writer refuses keys such as `text`, `filename`,
  `parsed_data`, `email`.
* **Anonymize**: all of the candidate's resume files are deleted and their rows reduced to bare
  tombstones (`status=removed`, no key, no checksum, no parsed data, name replaced). The preview
  and the confirmation dialog show how many files will go.
* **Hard delete** (entered by mistake) and **purge** (retention expired): resume rows cascade with
  the candidate and the files are removed after the commit.
* **Export** (JSON) lists resume *metadata*. The files themselves are not included.
* A resume file is personal data in its own right: its lifetime follows the candidate's retention
  period.

## 6. Configuration

In `backend/.env.example` (placeholders only):

```
RESUME_STORAGE_DIR=storage/resumes
RESUME_MAX_BYTES=5242880
RESUME_MAX_PER_CANDIDATE=20
```

Page, text and archive limits are constants in `app/core/config.py` and `resume_validation.py`.
New dependencies: `python-multipart`, `pypdf`, `python-docx` (pinned in `requirements.txt`).

## 7. Known limits (be aware)

* **No OCR** and no virus/malware scanning. The file checks above reduce risk; they are not an
  antivirus. If you need scanning, add it before the file is committed (see `resume_storage.commit`).
* The parser is heuristic and tuned to typical English-language resumes. Unusual layouts, tables,
  multi-column PDFs, non-English headings and creative formats will produce gaps or mistakes. That is
  why every value has a confidence and why review is a human step.
* Storage is the **local filesystem** of the API server. It is not shared between several API
  servers; for that, put the folder on shared storage or replace `resume_storage` with an object
  store. Encryption at rest is the responsibility of the disk/volume.
* Reading happens inside the upload request, so very slow files delay the response. The upload
  progress bar in the UI is indeterminate (browsers expose no byte progress for `fetch`); it shows
  activity and offers Cancel.
* Concurrency is handled with database constraints and retries; this has been tested with injected
  races and on PostgreSQL, not under sustained parallel load.
* The database migration `1845342c233e` can be downgraded only while no resume audit events exist
  (it refuses otherwise, rather than silently discarding audit history). Files in storage are not
  touched by migrations.

## 8. Tests

`backend/tests/test_resume_parser.py`, `test_resume_extraction.py`, `test_resumes.py`,
`test_resumes_permissions.py`, `test_resumes_privacy.py` (real generated PDFs/DOCX, isolated database
and temporary storage per test, role matrix, anonymize/purge/delete, races) and, on the frontend,
`ResumeUpload`, `ResumesCard`, `ResumeReviewDialog`, `lib/resumes`, `api/resumes` and the multipart
client tests. Real files are never used in tests.
