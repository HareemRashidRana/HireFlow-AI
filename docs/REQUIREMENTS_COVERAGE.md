# Requirements Coverage (R4)

> **Advisory only. Not legal advice.** Requirements Coverage compares the skills a job lists with the
> skills in a human-reviewed resume. It is **not** a measure of candidate quality, ability,
> suitability or potential, and it is **not** a hiring recommendation. A person must interpret it and
> make every decision. Using any automated comparison in hiring may be regulated where you operate
> (for example under data-protection rules on automated decisions, or rules for AI in recruitment).
> This tool keeps humans in control, but it does not by itself make an organisation compliant:
> have the people legally responsible for hiring review how you use it.

## 1. What it is, and what it is not

| It is | It is not |
|---|---|
| A transparent count: how many of the job's required and preferred skills are *listed* in the reviewed resume | A score of a person |
| Deterministic: the same inputs always give the same figure | A model, a prediction or a ranking |
| Recorded, versioned and auditable | A reason to move, hide, reject, shortlist or hire anyone |

The product name is always **Requirements Coverage**. The figure is out of 100 and is shown only on
the application page, always with the advisory statement and a "How is this calculated?" link.

**It never:** changes an application's stage or history; rejects, shortlists or hires anyone;
recommends a decision; ranks or orders candidates; hides or filters candidates by figure. There is no
sort or filter parameter on any endpoint, and tests enforce this in the code (see section 9).

## 2. The method (`coverage-1.0`)

* **Required skills** carry **80%** of the weight, **preferred skills** (the job's "nice to have")
  **20%**. Within a group every skill counts equally.
* A skill counts as **listed** when the reviewed resume lists the same skill, or a known alternative
  name for it. Otherwise it is **not listed** (never "lacks").
* If one group cannot be assessed (the job lists none, or the resume lists no skills) the other
  carries the full weight. If neither can be assessed there is **no figure**, with an explanation.
  A resume with no listed skills is *never* treated as "zero".
* A skill in both of the job's lists counts once, as required.
* **Experience is not scored.** Total dated experience is shown as context only, with a note that it
  is not a relevance assessment. Overlapping positions count once; positions without usable dates
  and gaps between positions are neither penalised nor inferred.
* Not used at all: name, contact details, location, education, institutions, certifications, job
  titles, company names, career gaps, writing style, photographs, or anything not confirmed by a
  person during resume review. (Education is deferred until jobs have structured education
  requirements.)

### Matching and the alias table (`aliases-1`)

Matching is exact after normalisation (case, spacing, list bullets, trailing sentence punctuation,
invisible characters). Meaningful symbols are **kept**: `C`, `C++` and `C#` are three different
skills; `.NET` keeps its leading dot; `Java` never matches `JavaScript`; there is no substring,
prefix or fuzzy matching. A small, hand-curated, versioned alias table maps different spellings of
the *same* technology (`JS`→`JavaScript`, `Postgres`→`PostgreSQL`, `k8s`→`Kubernetes`,
`C sharp`→`C#`, `golang`→`Go`, ...). Aliases that would merge different things are forbidden and
asserted by tests. Every alias match is shown as "a known alternative name".

**Known limitation:** names with a version number (for example "Python 3.11" or "Java 17") are
different strings from "Python" and "Java" and show as *not listed*. A person can correct the
reviewed resume, or record an adjustment (section 4), or the alias table can grow in a later
version. Changing the table means a new `aliases-N` version.

## 3. Resume review is a precondition

Only **human-reviewed** resume data is ever used. `parsed_data` (what the parser read) is never read
by the screening code; the only door is a strict adapter that refuses anything that is not the exact
reviewed-resume shape (parser output is rejected). To assess an application:

1. the candidate must have an **active** resume (`GET /api/v1/applications/{id}/screening` reports
   `no_active_resume` otherwise),
2. a person must have **reviewed and confirmed** it (`resume_not_reviewed` otherwise), and
3. the candidate must not be anonymized (`candidate_anonymized`).

The page explains which one applies and links to the resumes.

## 4. Human judgement and adjustments

A person's view is stored **beside** the result, never over it, as an append-only *review*:

* **Judgement:** *agree*, *disagree* or *unsure* about the comparison.
* **Optional note** (max 1,000 characters). Staff only. Removed if the candidate is anonymized or the
  resume is deleted. Do not put sensitive personal details in it.
* **Optional adjustment:** mark requirements that are *not listed* but that you can see are covered,
  with a reason (`evidenced_elsewhere`, `equivalent_skill`, `resume_incomplete`, `other`). This
  produces a **separate adjusted figure** shown next to the original, which never changes. Only
  requirements that were actually not listed can be adjusted.

Reviews cannot be edited or deleted (no such operation exists, and the data layer refuses it).

## 5. Versions, repeats and stale assessments

* Each assessment is **immutable** (the ORM refuses updates and deletes; there is no API for them)
  and keeps the exact result, the job's skill lists as used, the methodology and alias-table
  versions, and which resume version and review it came from.
* **Idempotent:** requesting again with identical inputs (same job skills, same reviewed resume
  review, same methodology) returns the existing assessment (`200`) instead of creating a duplicate
  (`201` is only for a new one). Simultaneous identical requests create exactly one.
* **Stale detection:** an assessment is shown as **outdated** when the job's required or preferred
  skills changed, a different resume is active, the resume was reviewed again, or the methodology or
  alias table version changed. The reasons are listed. **It is never re-scored silently**: the old
  result is shown as it was, and a person must choose *Assess again*, which adds assessment #2, #3...
  (earlier ones are kept; up to 50 per application).
* Restoring the old requirements makes the old assessment current again.

## 6. Privacy and retention

* **Audit** (the candidate audit trail): `screening_created`, `screening_viewed` (opening a
  detail), `screening_reviewed`, `screening_scrubbed`. Metadata holds ids, version strings, the
  numeric figure and counts only. It never contains skill names, evidence, notes, resume text, names,
  contact details or snapshots; the audit writer refuses those keys and any nested values.
* **Anonymization** and **resume deletion** remove resume-derived content from the affected
  assessments: per-skill evidence, the experience context, the input fingerprint (a hash of resume
  skills), and every reviewer note and adjustment. **Kept:** the numeric figure, weights, versions,
  dates, counts of listed skills, the job's skill lists and the judgement. A `screening_scrubbed` event
  records counts only. The anonymization preview shows how many assessments are affected.
* **Replacing** a resume does not scrub; older assessments simply become outdated.
* **Retention/purge:** purge only removes candidates with no applications, so it never touches
  assessments. Applications are never deleted. A candidate with applications cannot be hard-deleted.
* **Export:** the JSON export lists, per application, assessment *metadata* (number, date, versions,
  status, figure, weight, resume version, scrubbed flag, counts of judgements). It never includes
  evidence, snapshots, skill lists, adjustments or notes. CSV exports contain no assessment data;
  their formula-injection protection is unchanged.

## 7. Who can do what

| | Admin | HR manager | Recruiter | Employee |
|---|---|---|---|---|
| Assess, view, review, job status overview | yes | yes | yes | **no** |
| Edit or delete an assessment or review | nobody (no such operation) | | | |

Recruiters can see every application today (assignment only limits who may *assign*), so screening
follows the same rule; a test pins this so a change is deliberate. Hiring managers have no access in
this version. Unknown or foreign ids return `404`; an employee gets `403` before any lookup.

## 8. API

All under `/api/v1`, authenticated. `{id}` values are UUIDs (malformed → `422`).

| Method and path | Purpose |
|---|---|
| `POST /applications/{id}/screening` | create an assessment (`201`), or return the identical existing one (`200`). `409` if not ready (no active resume / not reviewed / anonymized) |
| `GET /applications/{id}/screening` | readiness (and why not), the job's current skill lists, and the assessment history newest first (summaries) |
| `GET /screening/{assessment_id}` | one assessment in full, with live freshness; logs `screening_viewed` |
| `POST /screening/{assessment_id}/reviews` | add a judgement (`judgement`, optional `adjustments` + `adjustment_reason`, optional `note`); returns the assessment with its reviews |
| `GET /jobs/{job_id}/screening?page&page_size` | each applicant's **status** (`not_assessed`, `current`, `outdated`, `scrubbed`, `cannot_assess`), ordered by application date, **no figure**, no sort/filter parameters |
| `GET /screening/methodology` | the method, weights, limitations and what is not used |

## 9. Guarantees that tests enforce

The pure engine (`app/services/screening/`) imports no database, web, workflow, clock or randomness
code. The service layer cannot call stage functions, never mentions `parsed_data`, never orders or
filters by the figure; the OpenAPI document has no sort/order/score/filter parameter and no
ranking or recommendation field; the frontend only shows the figure inside the coverage components
(never on the pipeline, candidate lists, applications list, jobs list or privacy pages). Mutation
checks deliberately break each of these and require the suite to fail.

## 10. Known limitations

* **A skills comparison, not an evaluation.** It cannot tell how well, how recently or in what
  context a skill was used, and a resume that omits a skill does not show the person lacks it.
* Quality depends on how the job's requirements were written and how carefully the resume was
  reviewed. Skills lists can be padded; review reduces this but cannot remove it.
* Version-suffixed and unusual skill names do not match (section 2). The alias table is small on
  purpose.
* No fairness monitoring: the system deliberately stores no protected attributes, so it cannot
  measure disparate impact. Treat any use as requiring human oversight and your own governance.
* Anchoring risk: any number can influence a reader. That is why the figure is confined to the
  application page, is never used for ordering, and is always shown with its limits.
* Immutability of assessments is enforced in application code (and by the API having no such
  operation); a database-level trigger is a possible hardening for a later release.
* Only individual assessments exist; batch screening is deferred.
* **Deployment order:** apply the database migration *before* starting the new application code, or
  anonymization and resume deletion (which now touch the new tables) will fail.
