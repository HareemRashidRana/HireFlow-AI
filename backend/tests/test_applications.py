"""Applications: create, read, list/search/filter/paginate, update, summary, board, constraints."""

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.application import (
    Application,
    ApplicationEvent,
    ApplicationStage,
    HistoryIsAppendOnly,
)
from app.models.candidate import Candidate
from app.models.job import JobPosting
from tests.test_candidates import CANDIDATES, candidate_payload
from tests.test_jobs import JOBS, job_payload

APPS = "/api/v1/applications"


def open_job(client, n: int = 1, **overrides) -> dict:
    job = client.post(JOBS, json=job_payload(n, **overrides))
    assert job.status_code == 201, job.text
    res = client.post(f"{JOBS}/{job.json()['id']}/status", json={"status": "open"})
    assert res.status_code == 200, res.text
    return res.json()


def make_candidate(client, n: int = 1, **overrides) -> dict:
    res = client.post(CANDIDATES, json=candidate_payload(n, **overrides))
    assert res.status_code == 201, res.text
    return res.json()


def apply(client, candidate: dict, job: dict, **extra):
    return client.post(APPS, json={"candidate_id": candidate["id"], "job_id": job["id"], **extra})


def make_application(client, n: int = 1, **extra) -> dict:
    """A brand-new candidate applying to a brand-new open job."""
    res = apply(client, make_candidate(client, n), open_job(client, n), **extra)
    assert res.status_code == 201, res.text
    return res.json()


def move(client, application_id: str, stage: str, note: str | None = None):
    body = {"stage": stage}
    if note:
        body["note"] = note
    return client.post(f"{APPS}/{application_id}/stage", json=body)


def event_types(application: dict) -> list[str]:
    return [e["event_type"] for e in application["events"]]


# ---- creating --------------------------------------------------------------------------------


class TestCreate:
    def test_a_candidate_can_apply_to_an_open_job(self, client):
        cand, job = make_candidate(client), open_job(client)
        res = apply(client, cand, job)
        assert res.status_code == 201, res.text
        body = res.json()
        assert body["stage"] == "applied"
        assert body["candidate"]["id"] == cand["id"]
        assert body["job"]["id"] == job["id"]
        assert body["assigned_recruiter"] is None
        assert body["applied_at"] == body["stage_changed_at"]

    def test_source_defaults_to_the_candidates_own_source(self, client):
        cand = make_candidate(client, source="referral")
        assert apply(client, cand, open_job(client)).json()["source"] == "referral"

    def test_source_can_be_set_explicitly(self, client):
        cand = make_candidate(client, source="referral")
        res = apply(client, cand, open_job(client), source="agency")
        assert res.json()["source"] == "agency"

    def test_creation_writes_a_history_entry_with_the_actor(self, client):
        app = make_application(client)
        assert event_types(app) == ["created"]
        event = app["events"][0]
        assert event["to_value"] == "applied" and event["from_value"] is None
        assert event["actor"]["email"] == client.user.email

    def test_the_same_candidate_can_apply_to_different_jobs(self, client):
        cand = make_candidate(client)
        assert apply(client, cand, open_job(client, 1)).status_code == 201
        assert apply(client, cand, open_job(client, 2)).status_code == 201

    def test_different_candidates_can_apply_to_the_same_job(self, client):
        job = open_job(client)
        assert apply(client, make_candidate(client, 1), job).status_code == 201
        assert apply(client, make_candidate(client, 2), job).status_code == 201

    def test_duplicate_application_is_refused_with_409(self, client):
        cand, job = make_candidate(client), open_job(client)
        assert apply(client, cand, job).status_code == 201
        res = apply(client, cand, job)
        assert res.status_code == 409
        assert "already has an application" in res.json()["detail"]
        assert client.get(APPS).json()["total"] == 1

    @pytest.mark.parametrize("terminal", ["rejected", "withdrawn"])
    def test_a_closed_out_application_still_blocks_a_duplicate(self, client, terminal):
        app = make_application(client)
        assert move(client, app["id"], terminal, note="because").status_code == 200
        res = apply(client, app["candidate"], {"id": app["job"]["id"]})
        assert res.status_code == 409

    def test_unknown_candidate_is_refused(self, client):
        res = client.post(APPS, json={"candidate_id": str(uuid.uuid4()), "job_id": open_job(client)["id"]})
        assert res.status_code == 422
        assert res.json()["detail"] == "Candidate not found"

    def test_unknown_job_is_refused(self, client):
        res = client.post(APPS, json={"candidate_id": make_candidate(client)["id"], "job_id": str(uuid.uuid4())})
        assert res.status_code == 422
        assert res.json()["detail"] == "Job not found"

    @pytest.mark.parametrize("path", [[], ["open", "on_hold"], ["open", "closed"]])
    def test_only_open_jobs_accept_applications(self, client, path):
        job = client.post(JOBS, json=job_payload(1)).json()
        for step in path:
            client.post(f"{JOBS}/{job['id']}/status", json={"status": step})
        res = apply(client, make_candidate(client), job)
        assert res.status_code == 409
        assert "open jobs" in res.json()["detail"]
        assert client.get(APPS).json()["total"] == 0

    def test_anonymized_candidates_cannot_apply(self, client, session_factory):
        cand, job = make_candidate(client), open_job(client)
        with session_factory() as db:
            row = db.get(Candidate, uuid.UUID(cand["id"]))
            row.anonymized_at = datetime.now(UTC)
            db.commit()
        assert apply(client, cand, job).status_code == 422

    @pytest.mark.parametrize(
        "body",
        [
            {},
            {"candidate_id": "not-a-uuid", "job_id": "also-not"},
            {"candidate_id": str(uuid.uuid4())},
            {"candidate_id": str(uuid.uuid4()), "job_id": str(uuid.uuid4()), "stage": "hired"},
            {"candidate_id": str(uuid.uuid4()), "job_id": str(uuid.uuid4()), "applied_at": "2020-01-01T00:00:00Z"},
            {"candidate_id": str(uuid.uuid4()), "job_id": str(uuid.uuid4()), "source": "nonsense"},
            {"candidate_id": str(uuid.uuid4()), "job_id": str(uuid.uuid4()), "internal_notes": "x" * 2001},
        ],
    )
    def test_invalid_bodies_are_rejected(self, client, body):
        assert client.post(APPS, json=body).status_code == 422

    def test_clients_cannot_choose_the_stage_or_submission_date(self, client):
        cand, job = make_candidate(client), open_job(client)
        res = client.post(
            APPS,
            json={"candidate_id": cand["id"], "job_id": job["id"], "stage": "offer",
                  "applied_at": "2001-01-01T00:00:00Z"},
        )
        assert res.status_code == 422  # extra fields are refused, not ignored
        assert client.get(APPS).json()["total"] == 0

    def test_validation_errors_do_not_echo_input(self, client):
        res = client.post(APPS, json={"candidate_id": "secret-looking-value", "job_id": "x"})
        assert "secret-looking-value" not in res.text


# ---- reading ---------------------------------------------------------------------------------


class TestRead:
    def test_detail_includes_candidate_job_and_history(self, client):
        app = make_application(client)
        body = client.get(f"{APPS}/{app['id']}").json()
        assert body["candidate"]["email"].endswith("@example.com")
        assert body["candidate"]["phone"] and body["candidate"]["retain_until"]
        assert body["job"]["title"] and body["job"]["employment_type"] == "full_time"
        assert body["events"][0]["event_type"] == "created"

    def test_unknown_application_is_404(self, client):
        assert client.get(f"{APPS}/{uuid.uuid4()}").status_code == 404

    def test_malformed_id_is_422(self, client):
        assert client.get(f"{APPS}/not-a-uuid").status_code == 422

    def test_history_is_chronological(self, client):
        app = make_application(client)
        for stage in ("screening", "shortlisted", "interview"):
            assert move(client, app["id"], stage).status_code == 200
        body = client.get(f"{APPS}/{app['id']}").json()
        stamps = [e["created_at"] for e in body["events"]]
        assert stamps == sorted(stamps)
        assert [e["to_value"] for e in body["events"]] == ["applied", "screening", "shortlisted", "interview"]

    def test_responses_never_include_user_secrets(self, client):
        app = make_application(client)
        client.patch(f"{APPS}/{app['id']}", json={"assigned_recruiter_id": str(client.user.id)})
        text = client.get(f"{APPS}/{app['id']}").text + client.get(APPS).text
        for forbidden in ("password", "hash", "token"):
            assert forbidden not in text.lower()

    def test_detail_tells_the_user_what_they_may_do_next(self, client):
        app = make_application(client)
        assert set(app["allowed_stages"]) == {"screening", "rejected", "withdrawn"}
        assert app["can_reopen"] is False


# ---- listing ---------------------------------------------------------------------------------


@pytest.fixture
def seeded(client):
    """Three jobs and four applications with different stages, jobs and sources."""
    java, python, design = (
        open_job(client, 1, title="Java Developer"),
        open_job(client, 2, title="Python Engineer"),
        open_job(client, 3, title="Product Designer"),
    )
    ayesha = make_candidate(client, 1, first_name="Ayesha", last_name="Khan", email="ayesha@example.com", source="referral")
    bilal = make_candidate(client, 2, first_name="Bilal", last_name="Ahmed", email="bilal@example.com", source="linkedin")
    sara = make_candidate(client, 3, first_name="Sara", last_name="Malik", email="sara@corp.example.com", source="agency")
    apps = {
        "ayesha_java": apply(client, ayesha, java).json(),
        "ayesha_python": apply(client, ayesha, python).json(),
        "bilal_python": apply(client, bilal, python).json(),
        "sara_design": apply(client, sara, design).json(),
    }
    move(client, apps["bilal_python"]["id"], "screening")
    move(client, apps["sara_design"]["id"], "rejected", note="Not a fit")
    return {"jobs": (java, python, design), "candidates": (ayesha, bilal, sara), "apps": apps}


def ids(res) -> set[str]:
    return {a["id"] for a in res.json()["items"]}


class TestList:
    def test_lists_everything_newest_first(self, client, seeded):
        body = client.get(APPS).json()
        assert body["total"] == 4
        assert [i["id"] for i in body["items"]][0] == seeded["apps"]["sara_design"]["id"]

    def test_list_items_carry_candidate_job_and_stage(self, client, seeded):
        item = next(i for i in client.get(APPS).json()["items"] if i["id"] == seeded["apps"]["bilal_python"]["id"])
        assert item["candidate"]["last_name"] == "Ahmed"
        assert item["job"]["title"] == "Python Engineer"
        assert item["stage"] == "screening"
        assert "events" not in item and "internal_notes" not in item

    @pytest.mark.parametrize(
        "term,expected",
        [
            ("ayesha", {"ayesha_java", "ayesha_python"}),
            ("KHAN", {"ayesha_java", "ayesha_python"}),
            ("ayesha khan", {"ayesha_java", "ayesha_python"}),
            ("bilal@example", {"bilal_python"}),
            ("corp.example", {"sara_design"}),
            ("python", {"ayesha_python", "bilal_python"}),
            ("designer", {"sara_design"}),
            ("nobody-matches-this", set()),
        ],
    )
    def test_search_covers_candidate_name_email_and_job_title(self, client, seeded, term, expected):
        got = ids(client.get(APPS, params={"q": term}))
        assert got == {seeded["apps"][k]["id"] for k in expected}

    @pytest.mark.parametrize("wildcard", ["%", "_", "\\"])
    def test_wildcards_in_search_match_literally(self, client, seeded, wildcard):
        assert client.get(APPS, params={"q": wildcard}).json()["total"] == 0

    def test_filter_by_job(self, client, seeded):
        job = seeded["jobs"][1]
        got = ids(client.get(APPS, params={"job_id": job["id"]}))
        assert got == {seeded["apps"]["ayesha_python"]["id"], seeded["apps"]["bilal_python"]["id"]}

    def test_filter_by_candidate(self, client, seeded):
        got = ids(client.get(APPS, params={"candidate_id": seeded["candidates"][0]["id"]}))
        assert got == {seeded["apps"]["ayesha_java"]["id"], seeded["apps"]["ayesha_python"]["id"]}

    def test_filter_by_stage(self, client, seeded):
        assert ids(client.get(APPS, params={"stage": "screening"})) == {seeded["apps"]["bilal_python"]["id"]}
        assert ids(client.get(APPS, params={"stage": "rejected"})) == {seeded["apps"]["sara_design"]["id"]}
        assert client.get(APPS, params={"stage": "hired"}).json()["total"] == 0

    def test_filter_by_source(self, client, seeded):
        got = ids(client.get(APPS, params={"source": "agency"}))
        assert got == {seeded["apps"]["sara_design"]["id"]}

    def test_filter_by_recruiter(self, client, seeded):
        target = seeded["apps"]["ayesha_java"]["id"]
        client.patch(f"{APPS}/{target}", json={"assigned_recruiter_id": str(client.user.id)})
        assert ids(client.get(APPS, params={"recruiter_id": str(client.user.id)})) == {target}
        assert client.get(APPS, params={"recruiter_id": str(uuid.uuid4())}).json()["total"] == 0

    def test_filter_by_date_range(self, client, seeded, session_factory):
        old = seeded["apps"]["ayesha_java"]["id"]
        with session_factory() as db:
            row = db.get(Application, uuid.UUID(old))
            row.applied_at = datetime(2024, 1, 15, 12, 0, tzinfo=UTC)
            db.commit()
        assert ids(client.get(APPS, params={"applied_to": "2024-01-31"})) == {old}
        assert ids(client.get(APPS, params={"applied_from": "2024-01-15", "applied_to": "2024-01-15"})) == {old}
        assert old not in ids(client.get(APPS, params={"applied_from": "2024-01-16"}))
        assert client.get(APPS, params={"applied_from": "2023-01-01", "applied_to": "2023-12-31"}).json()["total"] == 0

    def test_filters_combine(self, client, seeded):
        res = client.get(APPS, params={"job_id": seeded["jobs"][1]["id"], "stage": "applied"})
        assert ids(res) == {seeded["apps"]["ayesha_python"]["id"]}

    def test_stage_counts_follow_the_filters_but_not_the_stage(self, client, seeded):
        everything = client.get(APPS).json()["stage_counts"]
        assert everything["applied"] == 2 and everything["screening"] == 1 and everything["rejected"] == 1
        assert sum(everything.values()) == 4
        for_python = client.get(APPS, params={"job_id": seeded["jobs"][1]["id"], "stage": "screening"}).json()
        assert for_python["total"] == 1
        assert for_python["stage_counts"]["applied"] == 1  # unaffected by the stage filter
        assert sum(for_python["stage_counts"].values()) == 2

    def test_pagination(self, client, seeded):
        first = client.get(APPS, params={"page": 1, "page_size": 3}).json()
        second = client.get(APPS, params={"page": 2, "page_size": 3}).json()
        assert first["total"] == second["total"] == 4
        assert len(first["items"]) == 3 and len(second["items"]) == 1
        assert not ({i["id"] for i in first["items"]} & {i["id"] for i in second["items"]})
        assert client.get(APPS, params={"page": 9, "page_size": 3}).json()["items"] == []

    @pytest.mark.parametrize("params", [{"page": 0}, {"page_size": 0}, {"page_size": 101}, {"stage": "bogus"},
                                        {"applied_from": "yesterday"}, {"job_id": "x"}, {"q": "x" * 101}])
    def test_bad_query_parameters_are_422(self, client, params):
        assert client.get(APPS, params=params).status_code == 422


# ---- updating (assignment and notes) ---------------------------------------------------------


class TestUpdate:
    def test_admin_can_assign_and_unassign(self, client, client_as):
        from app.models.user import UserRole

        rec = client_as(UserRole.RECRUITER)
        app = make_application(client)
        res = client.patch(f"{APPS}/{app['id']}", json={"assigned_recruiter_id": str(rec.user.id)})
        assert res.status_code == 200
        assert res.json()["assigned_recruiter"]["id"] == str(rec.user.id)
        res = client.patch(f"{APPS}/{app['id']}", json={"assigned_recruiter_id": None})
        assert res.json()["assigned_recruiter"] is None
        kinds = event_types(client.get(f"{APPS}/{app['id']}").json())
        assert kinds == ["created", "assigned", "assigned"]

    def test_assignment_history_names_before_and_after(self, client, client_as):
        from app.models.user import UserRole

        rec = client_as(UserRole.RECRUITER)
        app = make_application(client)
        client.patch(f"{APPS}/{app['id']}", json={"assigned_recruiter_id": str(rec.user.id)})
        client.patch(f"{APPS}/{app['id']}", json={"assigned_recruiter_id": str(client.user.id)})
        events = client.get(f"{APPS}/{app['id']}").json()["events"]
        assert (events[1]["from_value"], events[1]["to_value"]) == (None, rec.user.email)
        assert (events[2]["from_value"], events[2]["to_value"]) == (rec.user.email, client.user.email)

    def test_assigning_the_same_person_again_records_nothing(self, client):
        app = make_application(client)
        body = {"assigned_recruiter_id": str(client.user.id)}
        client.patch(f"{APPS}/{app['id']}", json=body)
        client.patch(f"{APPS}/{app['id']}", json=body)
        assert event_types(client.get(f"{APPS}/{app['id']}").json()) == ["created", "assigned"]

    @pytest.mark.parametrize("kind", ["unknown", "inactive", "employee"])
    def test_only_active_recruiting_staff_can_be_assigned(self, client, make_user, kind):
        from app.models.user import UserRole

        app = make_application(client)
        if kind == "unknown":
            target = uuid.uuid4()
        elif kind == "inactive":
            target = make_user(UserRole.RECRUITER, is_active=False).id
        else:
            target = make_user(UserRole.EMPLOYEE).id
        res = client.patch(f"{APPS}/{app['id']}", json={"assigned_recruiter_id": str(target)})
        assert res.status_code == 422
        assert client.get(f"{APPS}/{app['id']}").json()["assigned_recruiter"] is None

    def test_notes_are_saved_trimmed_and_recorded_without_their_text(self, client):
        app = make_application(client)
        res = client.patch(f"{APPS}/{app['id']}", json={"internal_notes": "  Strong on SQL.  "})
        assert res.json()["internal_notes"] == "Strong on SQL."
        body = client.get(f"{APPS}/{app['id']}").json()
        assert event_types(body) == ["created", "notes_updated"]
        assert "SQL" not in str(body["events"])  # history says THAT it changed, not WHAT

    def test_notes_can_be_cleared(self, client):
        app = make_application(client, internal_notes="temporary")
        res = client.patch(f"{APPS}/{app['id']}", json={"internal_notes": "   "})
        assert res.json()["internal_notes"] is None

    def test_an_empty_patch_changes_nothing(self, client):
        app = make_application(client)
        before = client.get(f"{APPS}/{app['id']}").json()
        assert client.patch(f"{APPS}/{app['id']}", json={}).status_code == 200
        assert client.get(f"{APPS}/{app['id']}").json() == before

    @pytest.mark.parametrize("field,value", [("stage", "offer"), ("job_id", str(uuid.uuid4())),
                                             ("candidate_id", str(uuid.uuid4())), ("applied_at", "2001-01-01T00:00:00Z")])
    def test_a_patch_cannot_change_stage_job_candidate_or_submission_date(self, client, field, value):
        app = make_application(client)
        assert client.patch(f"{APPS}/{app['id']}", json={field: value}).status_code == 422
        after = client.get(f"{APPS}/{app['id']}").json()
        assert after["stage"] == "applied" and after["applied_at"] == app["applied_at"]

    def test_unknown_application_is_404(self, client):
        assert client.patch(f"{APPS}/{uuid.uuid4()}", json={"internal_notes": "x"}).status_code == 404


# ---- summary, recruiters, board --------------------------------------------------------------


class TestSummaryAndBoard:
    def test_summary_comes_from_real_data(self, client, seeded):
        body = client.get(f"{APPS}/summary").json()
        assert body["total"] == 4
        assert body["by_stage"]["applied"] == 2 and body["by_stage"]["screening"] == 1
        assert body["by_stage"]["rejected"] == 1 and body["hired"] == 0
        assert body["open_jobs_with_applications"] == 3
        assert len(body["recent"]) == 4
        assert {"candidate_name", "job_title", "stage", "applied_at"} <= set(body["recent"][0])

    def test_summary_when_empty(self, client):
        body = client.get(f"{APPS}/summary").json()
        assert body["total"] == 0 and body["recent"] == [] and body["open_jobs_with_applications"] == 0

    def test_summary_counts_open_jobs_only(self, client, seeded):
        job = seeded["jobs"][2]
        client.post(f"{JOBS}/{job['id']}/status", json={"status": "closed"})
        assert client.get(f"{APPS}/summary").json()["open_jobs_with_applications"] == 2

    def test_summary_recent_is_limited_to_five(self, client):
        for n in range(1, 8):
            make_application(client, n)
        body = client.get(f"{APPS}/summary").json()
        assert body["total"] == 7 and len(body["recent"]) == 5

    def test_recruiter_list_has_only_active_staff(self, client, make_user, client_as):
        from app.models.user import UserRole

        rec = client_as(UserRole.RECRUITER)
        make_user(UserRole.RECRUITER, is_active=False, email="gone@example.com")
        make_user(UserRole.EMPLOYEE, email="plain@example.com")
        emails = {r["email"] for r in client.get(f"{APPS}/recruiters").json()}
        assert rec.user.email in emails and client.user.email in emails
        assert "gone@example.com" not in emails and "plain@example.com" not in emails
        assert all(set(r) == {"id", "email", "role"} for r in client.get(f"{APPS}/recruiters").json())

    def test_board_groups_every_stage_with_counts(self, client, seeded):
        board = client.get(f"{APPS}/board").json()
        assert set(board["columns"]) == {s.value for s in ApplicationStage}
        assert board["columns"]["applied"]["total"] == 2
        assert len(board["columns"]["applied"]["items"]) == 2
        assert board["columns"]["offer"] == {
            "total": 0, "items": [], "page": 1, "page_size": 25, "has_more": False
        }
        assert board["columns"]["rejected"]["items"][0]["id"] == seeded["apps"]["sara_design"]["id"]

    def test_board_filters(self, client, seeded):
        board = client.get(f"{APPS}/board", params={"job_id": seeded["jobs"][1]["id"]}).json()
        assert board["columns"]["applied"]["total"] == 1 and board["columns"]["screening"]["total"] == 1
        assert board["columns"]["rejected"]["total"] == 0
        by_text = client.get(f"{APPS}/board", params={"q": "sara"}).json()
        assert by_text["columns"]["rejected"]["total"] == 1 and by_text["columns"]["applied"]["total"] == 0

    def test_board_caps_each_column_but_reports_the_true_total(self, client, monkeypatch):
        job = open_job(client)
        for n in range(1, 5):
            assert apply(client, make_candidate(client, n), job).status_code == 201
        column = client.get(f"{APPS}/board", params={"page_size": 2}).json()["columns"]["applied"]
        assert column["total"] == 4 and len(column["items"]) == 2 and column["has_more"] is True


# ---- database-level protections --------------------------------------------------------------


class TestDatabase:
    def _insert(self, db, cand_id, job_id, stage="applied"):
        now = datetime.now(UTC)
        db.add(Application(candidate_id=cand_id, job_id=job_id, stage=stage, source="direct",
                           applied_at=now, stage_changed_at=now))
        db.flush()

    def test_the_database_itself_refuses_a_duplicate_pair(self, client, session_factory):
        app = make_application(client)
        with session_factory() as db, pytest.raises(IntegrityError):
            self._insert(db, uuid.UUID(app["candidate"]["id"]), uuid.UUID(app["job"]["id"]))

    @pytest.mark.parametrize("stage,ok", [("offer", True), ("promoted", False), ("", False)])
    def test_the_database_itself_checks_the_stage_value(self, client, session_factory, stage, ok):
        """Raw SQL, so neither the API nor the ORM's enum validation is involved."""
        from sqlalchemy import text

        app = make_application(client)
        other = open_job(client, 2)
        params = {
            "id": uuid.uuid4().hex,
            "c": uuid.UUID(app["candidate"]["id"]).hex,
            "j": uuid.UUID(other["id"]).hex,
            "stage": stage,
        }
        sql = text(
            "insert into applications (id, candidate_id, job_id, stage, source, applied_at, stage_changed_at) "
            "values (:id, :c, :j, :stage, 'direct', '2025-01-01 00:00:00', '2025-01-01 00:00:00')"
        )
        with session_factory() as db:
            if ok:
                db.execute(sql, params)
            else:
                with pytest.raises(IntegrityError):
                    db.execute(sql, params)

    def test_the_database_refuses_to_delete_a_candidate_with_applications(self, client, session_factory):
        app = make_application(client)
        with session_factory() as db, pytest.raises(IntegrityError):
            db.delete(db.get(Candidate, uuid.UUID(app["candidate"]["id"])))
            db.flush()

    def test_the_database_refuses_to_delete_a_job_with_applications(self, client, session_factory):
        app = make_application(client)
        with session_factory() as db, pytest.raises(IntegrityError):
            db.delete(db.get(JobPosting, uuid.UUID(app["job"]["id"])))
            db.flush()

    def test_the_database_refuses_to_delete_an_application_that_has_history(self, client, session_factory):
        from sqlalchemy import text

        app = make_application(client)
        with session_factory() as db, pytest.raises(HistoryIsAppendOnly):  # via the ORM
            db.delete(db.get(Application, uuid.UUID(app["id"])))
            db.flush()
        with session_factory() as db, pytest.raises(IntegrityError):  # raw SQL: the FK itself
            db.execute(text("delete from applications where id = :i"), {"i": uuid.UUID(app["id"]).hex})

    def test_history_rows_cannot_be_edited_or_deleted(self, client, session_factory):
        app = make_application(client)
        with session_factory() as db:
            row = db.scalar(select(ApplicationEvent).where(ApplicationEvent.application_id == uuid.UUID(app["id"])))
            row.note = "rewritten"
            with pytest.raises(HistoryIsAppendOnly):
                db.flush()
            db.rollback()
            row = db.scalar(select(ApplicationEvent))
            db.delete(row)
            with pytest.raises(HistoryIsAppendOnly):
                db.flush()

    def test_history_rows_need_a_valid_event_type(self, client, session_factory):
        from sqlalchemy import text

        app = make_application(client)
        sql = text(
            "insert into application_events (id, application_id, event_type) values (:id, :a, :t)"
        )
        with session_factory() as db:
            with pytest.raises(IntegrityError):
                db.execute(sql, {"id": uuid.uuid4().hex, "a": uuid.UUID(app["id"]).hex, "t": "deleted"})
            db.rollback()
            db.execute(sql, {"id": uuid.uuid4().hex, "a": uuid.UUID(app["id"]).hex, "t": "created"})

    def test_deleting_the_acting_user_keeps_the_history(self, client, client_as, session_factory):
        from app.models.user import User, UserRole

        rec = client_as(UserRole.RECRUITER)
        app = make_application(rec)
        with session_factory() as db:
            db.delete(db.get(User, rec.user.id))
            db.commit()
        body = client.get(f"{APPS}/{app['id']}").json()
        assert body["events"][0]["actor"] is None and body["events"][0]["event_type"] == "created"


# ---- deleting people / jobs with history -----------------------------------------------------


class TestProtectedDeletion:
    def test_a_candidate_with_applications_cannot_be_deleted(self, client):
        app = make_application(client)
        res = client.delete(f"{CANDIDATES}/{app['candidate']['id']}")
        assert res.status_code == 409
        assert "application history" in res.json()["detail"]
        assert client.get(f"{CANDIDATES}/{app['candidate']['id']}").status_code == 200
        assert client.get(f"{APPS}/{app['id']}").status_code == 200

    def test_a_candidate_without_applications_can_still_be_deleted(self, client):
        cand = make_candidate(client)
        assert client.delete(f"{CANDIDATES}/{cand['id']}").status_code == 204

    def test_a_job_with_applications_cannot_be_deleted(self, client, session_factory):
        app = make_application(client)
        # Force the job back to draft to prove the application guard on its own.
        with session_factory() as db:
            db.get(JobPosting, uuid.UUID(app["job"]["id"])).status = "draft"
            db.commit()
        res = client.delete(f"{JOBS}/{app['job']['id']}")
        assert res.status_code == 409
        assert "has applications" in res.json()["detail"]
        assert client.get(f"{JOBS}/{app['job']['id']}").status_code == 200

    def test_rejecting_or_closing_never_removes_history(self, client):
        app = make_application(client)
        move(client, app["id"], "rejected", note="No")
        client.post(f"{JOBS}/{app['job']['id']}/status", json={"status": "closed"})
        body = client.get(f"{APPS}/{app['id']}").json()
        assert body["stage"] == "rejected" and len(body["events"]) == 2

    def test_there_is_no_delete_endpoint_for_applications(self, client):
        app = make_application(client)
        assert client.delete(f"{APPS}/{app['id']}").status_code == 405


# ---- candidate retention ---------------------------------------------------------------------


class TestRetention:
    def _age(self, session_factory, candidate_id: str):
        """Make the candidate look long inactive. Returns (last_activity_at, retain_until)."""
        with session_factory() as db:
            row = db.get(Candidate, uuid.UUID(candidate_id))
            row.last_activity_at = datetime.now(UTC) - timedelta(days=300)
            row.retain_until = (datetime.now(UTC) - timedelta(days=1)).date()
            db.commit()
            return row.last_activity_at, row.retain_until

    def _state(self, client, candidate_id):
        c = client.get(f"{CANDIDATES}/{candidate_id}").json()
        return datetime.fromisoformat(c["last_activity_at"]), date.fromisoformat(c["retain_until"])

    def test_applying_restarts_the_retention_clock(self, client, session_factory):
        cand, job = make_candidate(client), open_job(client)
        old = self._age(session_factory, cand["id"])
        assert apply(client, cand, job).status_code == 201
        activity, retain = self._state(client, cand["id"])
        assert activity > old[0] and retain > old[1]
        assert retain > datetime.now(UTC).date() + timedelta(days=300)  # a fresh 12 months

    def test_a_failed_application_does_not(self, client, session_factory):
        cand = make_candidate(client)
        draft = client.post(JOBS, json=job_payload(1)).json()  # not open: not eligible
        old = self._age(session_factory, cand["id"])
        assert apply(client, cand, draft).status_code == 409
        assert apply(client, {"id": str(uuid.uuid4())}, draft).status_code == 422
        assert self._state(client, cand["id"]) == old

    def test_stage_changes_extend_retention(self, client, session_factory):
        app = make_application(client)
        old = self._age(session_factory, app["candidate"]["id"])
        assert move(client, app["id"], "screening").status_code == 200
        activity, retain = self._state(client, app["candidate"]["id"])
        assert activity > old[0] and retain > old[1]

    def test_a_refused_stage_change_does_not(self, client, session_factory):
        app = make_application(client)
        old = self._age(session_factory, app["candidate"]["id"])
        assert move(client, app["id"], "offer").status_code == 409  # skipping stages
        assert self._state(client, app["candidate"]["id"]) == old

    def test_assignment_and_notes_do_not_extend_retention(self, client, session_factory):
        app = make_application(client)
        old = self._age(session_factory, app["candidate"]["id"])
        client.patch(f"{APPS}/{app['id']}", json={"assigned_recruiter_id": str(client.user.id)})
        client.patch(f"{APPS}/{app['id']}", json={"internal_notes": "routine note"})
        assert self._state(client, app["candidate"]["id"]) == old

    def test_routine_candidate_edits_still_do_not(self, client, session_factory):
        app = make_application(client)
        old = self._age(session_factory, app["candidate"]["id"])
        client.patch(f"{CANDIDATES}/{app['candidate']['id']}", json={"location": "Karachi"})
        assert self._state(client, app["candidate"]["id"]) == old
