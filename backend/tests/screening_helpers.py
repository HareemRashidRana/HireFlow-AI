"""Shared scenario builders for the Requirements Coverage tests."""

import uuid
from dataclasses import dataclass

from tests.resume_files import CV_LINES, make_pdf
from tests.test_applications import APPS, apply, make_candidate, open_job
from tests.test_candidates import CANDIDATES
from tests.test_resumes import RESUMES, upload

SCREENING = "/api/v1/screening"


@dataclass
class Scenario:
    job: dict
    candidate: dict
    application: dict
    resume_id: str | None

    @property
    def app_url(self) -> str:
        return f"{APPS}/{self.application['id']}/screening"


def review_body(skills=("Python", "SQL"), experience=None, **extra) -> dict:
    body = {
        "name": "Test Person", "email": "test.person@example.com", "phone": None,
        "skills": list(skills), "education": [],
        "experience": experience if experience is not None else [
            {"title": "Engineer", "company": "Acme", "start": "2020-01", "end": None, "current": True}
        ],
        "confirm": True,
    }
    body.update(extra)
    return body


def build(
    client, n: int = 1, *, required=("Python", "SQL"), preferred=("React",), skills=("Python", "SQL"),
    resume: str = "reviewed", min_years=None,
) -> Scenario:
    """A job, a candidate who applied, and (optionally) a resume that is unreviewed or reviewed."""
    overrides = {"required_skills": list(required), "nice_to_have_skills": list(preferred)}
    if min_years is not None:
        overrides["min_experience_years"] = min_years
    job = open_job(client, n, **overrides)
    candidate = make_candidate(client, n)
    application = apply(client, candidate, job)
    assert application.status_code == 201, application.text
    resume_id = None
    if resume in ("unreviewed", "reviewed"):
        res = upload(client, candidate["id"], data=make_pdf([*CV_LINES, f"unique {uuid.uuid4()}"]))
        assert res.status_code == 201, res.text
        resume_id = res.json()["id"]
        if resume == "reviewed":
            r = client.put(f"{RESUMES}/{resume_id}/review", json=review_body(skills))
            assert r.status_code == 200, r.text
    return Scenario(job, candidate, application.json(), resume_id)


def assess(client, scenario: Scenario):
    return client.post(scenario.app_url)


def get_application(client, scenario: Scenario) -> dict:
    return client.get(f"{APPS}/{scenario.application['id']}").json()


def candidate_url(candidate: dict) -> str:
    return f"{CANDIDATES}/{candidate['id']}"
