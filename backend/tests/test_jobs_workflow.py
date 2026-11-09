"""Job status workflow: draft / open / on_hold / closed."""

import itertools
import uuid

import pytest

from tests.test_jobs import JOBS, create

STATUSES = ["draft", "open", "on_hold", "closed"]

# From each status, the statuses that are allowed next.
ALLOWED = {
    "draft": {"open", "closed"},
    "open": {"on_hold", "closed"},
    "on_hold": {"open", "closed"},
    "closed": {"open"},
}


def set_status(client, job_id: str, status: str):
    return client.post(f"{JOBS}/{job_id}/status", json={"status": status})


def job_in_status(client, status: str, **overrides) -> dict:
    """Create a job and walk it to `status` using only legal moves."""
    job = create(client, **overrides)
    path = {"draft": [], "open": ["open"], "on_hold": ["open", "on_hold"], "closed": ["open", "closed"]}
    for step in path[status]:
        assert set_status(client, job["id"], step).status_code == 200
    return client.get(f"{JOBS}/{job['id']}").json()


@pytest.mark.parametrize("current,target", list(itertools.product(STATUSES, STATUSES)))
def test_transition_matrix(client, current, target):
    job = job_in_status(client, current)
    assert job["status"] == current
    res = set_status(client, job["id"], target)
    if target in ALLOWED[current]:
        assert res.status_code == 200, res.text
        assert res.json()["status"] == target
        assert client.get(f"{JOBS}/{job['id']}").json()["status"] == target  # persisted
    else:
        assert res.status_code == 409, res.text
        assert client.get(f"{JOBS}/{job['id']}").json()["status"] == current  # unchanged


def test_same_status_gives_a_clear_message(client):
    job = job_in_status(client, "open")
    res = set_status(client, job["id"], "open")
    assert res.status_code == 409
    assert res.json()["detail"] == "The job is already open"


def test_illegal_move_names_both_statuses(client):
    job = job_in_status(client, "closed")
    res = set_status(client, job["id"], "on_hold")
    assert res.json()["detail"] == "A closed job cannot be moved to on hold"


@pytest.mark.parametrize("bad", ["archived", "", "OPEN", None, 3])
def test_invalid_status_value(client, bad):
    job = create(client)
    assert client.post(f"{JOBS}/{job['id']}/status", json={"status": bad}).status_code == 422


def test_status_body_rejects_extra_fields(client):
    job = create(client)
    res = client.post(f"{JOBS}/{job['id']}/status", json={"status": "open", "title": "Hacked"})
    assert res.status_code == 422


def test_unknown_job_is_404(client):
    assert set_status(client, str(uuid.uuid4()), "open").status_code == 404


# ---------- publishing rules ----------


class TestPublishing:
    def test_cannot_open_without_a_description(self, client):
        job = create(client, description="")
        res = set_status(client, job["id"], "open")
        assert res.status_code == 422
        assert res.json()["detail"] == "Add a description before opening this job"
        assert client.get(f"{JOBS}/{job['id']}").json()["status"] == "draft"

    def test_whitespace_only_description_does_not_count(self, client):
        job = create(client, description="    ")
        assert set_status(client, job["id"], "open").status_code == 422

    def test_adding_a_description_then_opening_works(self, client):
        job = create(client, description="")
        client.patch(f"{JOBS}/{job['id']}", json={"description": "Now there is a description."})
        assert set_status(client, job["id"], "open").status_code == 200

    def test_a_draft_may_close_without_a_description(self, client):
        job = create(client, description="")
        assert set_status(client, job["id"], "closed").status_code == 200

    def test_cannot_clear_the_description_of_a_published_job(self, client):
        job = job_in_status(client, "open")
        res = client.patch(f"{JOBS}/{job['id']}", json={"description": ""})
        assert res.status_code == 422
        assert res.json()["detail"] == "A published job needs a description"

    def test_a_draft_description_can_be_cleared(self, client):
        job = create(client)
        assert client.patch(f"{JOBS}/{job['id']}", json={"description": ""}).status_code == 200


# ---------- timestamps ----------


class TestTimestamps:
    def test_opened_at_is_set_on_first_publish(self, client):
        job = create(client)
        assert job["opened_at"] is None
        opened = set_status(client, job["id"], "open").json()
        assert opened["opened_at"] is not None and opened["closed_at"] is None

    def test_closing_sets_closed_at(self, client):
        job = job_in_status(client, "open")
        closed = set_status(client, job["id"], "closed").json()
        assert closed["closed_at"] is not None
        assert closed["opened_at"] == job["opened_at"]

    def test_reopening_keeps_the_original_opened_at_and_clears_closed_at(self, client):
        job = job_in_status(client, "closed")
        original_opened = job["opened_at"]
        reopened = set_status(client, job["id"], "open").json()
        assert reopened["opened_at"] == original_opened
        assert reopened["closed_at"] is None

    def test_on_hold_does_not_touch_timestamps(self, client):
        job = job_in_status(client, "open")
        held = set_status(client, job["id"], "on_hold").json()
        assert held["opened_at"] == job["opened_at"] and held["closed_at"] is None
        back = set_status(client, job["id"], "open").json()
        assert back["opened_at"] == job["opened_at"]

    def test_closing_a_draft_never_sets_opened_at(self, client):
        job = create(client)
        closed = set_status(client, job["id"], "closed").json()
        assert closed["opened_at"] is None and closed["closed_at"] is not None


# ---------- closed jobs are read-only ----------


class TestClosedJobsAreReadOnly:
    def test_cannot_edit_a_closed_job(self, client):
        job = job_in_status(client, "closed")
        res = client.patch(f"{JOBS}/{job['id']}", json={"title": "New Title Here"})
        assert res.status_code == 409
        assert res.json()["detail"] == "Closed jobs cannot be edited. Reopen the job first."
        assert client.get(f"{JOBS}/{job['id']}").json()["title"] == job["title"]

    def test_reopened_job_is_editable_again(self, client):
        job = job_in_status(client, "closed")
        set_status(client, job["id"], "open")
        assert client.patch(f"{JOBS}/{job['id']}", json={"title": "New Title Here"}).status_code == 200

    @pytest.mark.parametrize("status", ["draft", "open", "on_hold"])
    def test_other_statuses_are_editable(self, client, status):
        job = job_in_status(client, status)
        assert client.patch(f"{JOBS}/{job['id']}", json={"openings": 9}).status_code == 200

    def test_status_cannot_be_changed_through_patch(self, client):
        job = create(client)
        assert client.patch(f"{JOBS}/{job['id']}", json={"status": "open"}).status_code == 422
        assert client.get(f"{JOBS}/{job['id']}").json()["status"] == "draft"
