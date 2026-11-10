"""Direct-to-database builders for the analytics tests, so timestamps are exact and deterministic."""

import uuid
from datetime import UTC, date, datetime, timedelta

from app.models.application import (
    Application,
    ApplicationEvent,
    ApplicationEventType,
    ApplicationStage,
)
from app.models.candidate import Candidate, CandidateSource, ConsentBasis
from app.models.employee import Employee, EmploymentStatus, EmploymentType
from app.models.interview import (
    Interview,
    InterviewMode,
    InterviewStatus,
    InterviewType,
)
from app.models.job import JobPosting, JobStatus

ANALYTICS = "/api/v1/analytics"
UTC_RANGE = {"start": "2026-03-01", "end": "2026-03-31"}  # a fixed, past month
NAME = "Zelda"
EMAIL_DOMAIN = "secret-analytics.example"


def at(day: int, hour: int = 12, month: int = 3, minute: int = 0) -> datetime:
    return datetime(2026, month, day, hour, minute, tzinfo=UTC)


class Seed:
    """Creates rows with chosen timestamps. Every candidate gets a distinctive name and email so
    the tests can prove none of it ever appears in an analytics response."""

    def __init__(self, session_factory):
        self.sf = session_factory
        self.n = 0

    def employee(self, department="Engineering", status=EmploymentStatus.ACTIVE) -> None:
        self.n += 1
        with self.sf() as db:
            db.add(
                Employee(
                    employee_id=f"E-{self.n:04d}",
                    first_name="Emp",
                    last_name=f"No{self.n}",
                    work_email=f"emp{self.n}@{EMAIL_DOMAIN}",
                    job_title="Staff",
                    department=department,
                    employment_type=EmploymentType.FULL_TIME,
                    employment_status=status,
                    date_of_joining=date(2024, 1, 1),
                )
            )
            db.commit()

    def job(self, title="Backend Engineer", department="Engineering", status=JobStatus.OPEN) -> uuid.UUID:
        with self.sf() as db:
            job = JobPosting(
                title=title,
                department=department,
                location="Lahore",
                employment_type=EmploymentType.FULL_TIME,
                status=status,
            )
            db.add(job)
            db.commit()
            return job.id

    def application(
        self,
        job_id: uuid.UUID,
        applied_at: datetime,
        stage: ApplicationStage = ApplicationStage.APPLIED,
        source: CandidateSource = CandidateSource.LINKEDIN,
        events: list[tuple[ApplicationEventType, str | None, str | None, datetime]] | None = None,
    ) -> uuid.UUID:
        """`events` are (type, from_value, to_value, when). None writes no history at all."""
        self.n += 1
        with self.sf() as db:
            cand = Candidate(
                first_name=NAME,
                last_name=f"Applicant{self.n}",
                email=f"cand{self.n}@{EMAIL_DOMAIN}",
                source=source,
                consent_basis=ConsentBasis.LEGITIMATE_INTEREST,
                consent_date=date(2026, 1, 1),
                last_activity_at=applied_at,
                retain_until=date(2030, 1, 1),
            )
            db.add(cand)
            db.flush()
            app = Application(
                candidate_id=cand.id,
                job_id=job_id,
                stage=stage,
                source=source,
                applied_at=applied_at,
                stage_changed_at=applied_at,
                internal_notes="private note from the recruiter",
            )
            db.add(app)
            db.flush()
            for kind, old, new, when in events or []:
                db.add(
                    ApplicationEvent(
                        application_id=app.id,
                        event_type=kind,
                        from_value=old,
                        to_value=new,
                        created_at=when,
                    )
                )
            db.commit()
            return app.id

    def hired(self, job_id, applied_at: datetime, hired_at: datetime | None, **kw) -> uuid.UUID:
        events = [(ApplicationEventType.CREATED, None, "applied", applied_at)]
        if hired_at is not None:
            events.append((ApplicationEventType.HIRED, "offer", "hired", hired_at))
        return self.application(job_id, applied_at, ApplicationStage.HIRED, events=events, **kw)

    def interview(
        self,
        application_id: uuid.UUID,
        starts_at: datetime,
        status: InterviewStatus = InterviewStatus.SCHEDULED,
        kind: InterviewType = InterviewType.TECHNICAL,
    ) -> uuid.UUID:
        cancelled = status == InterviewStatus.CANCELLED
        with self.sf() as db:
            row = Interview(
                application_id=application_id,
                title="Interview",
                interview_type=kind,
                mode=InterviewMode.ONLINE,
                status=status,
                starts_at=starts_at,
                ends_at=starts_at + timedelta(hours=1),
                timezone="UTC",
                cancellation_reason="no longer needed" if cancelled else None,
                cancelled_at=starts_at if cancelled else None,
            )
            db.add(row)
            db.commit()
            return row.id


def overview(client, **params):
    res = client.get(f"{ANALYTICS}/overview", params={**UTC_RANGE, **params})
    assert res.status_code == 200, res.text
    return res.json()


def funnel(body: dict) -> dict[str, int]:
    return {f["stage"]: f["count"] for f in body["funnel"]}
