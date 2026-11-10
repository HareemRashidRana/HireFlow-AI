"""The hiring pipeline: every move, who may make it, and what the history records."""

import itertools
import uuid

import pytest
from sqlalchemy import func, select

from app.models.application import Application, ApplicationEvent
from app.models.user import UserRole
from tests.test_applications import (
    APPS,
    JOBS,
    apply,
    event_types,
    make_application,
    make_candidate,
    move,
    open_job,
)

STAGES = ["applied", "screening", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn"]
# Written out by hand (not imported) so a mistake in the app's rules cannot hide itself here.
ALLOWED = {
    "applied": {"screening", "rejected", "withdrawn"},
    "screening": {"applied", "shortlisted", "rejected", "withdrawn"},
    "shortlisted": {"screening", "interview", "rejected", "withdrawn"},
    "interview": {"shortlisted", "offer", "rejected", "withdrawn"},
    "offer": {"interview", "hired", "rejected", "withdrawn"},
    "hired": set(),
    "rejected": set(),
    "withdrawn": set(),
}
FORWARD = ["screening", "shortlisted", "interview", "offer", "hired"]


def get(client, app_id: str) -> dict:
    return client.get(f"{APPS}/{app_id}").json()


def application_in(client, stage: str, admin=None, **extra) -> dict:
    """A new application walked to `stage` using only legal moves (hiring needs `admin`)."""
    app = make_application(client, next(_n), **extra)
    mover = admin or client
    if stage in FORWARD:
        for step in FORWARD[: FORWARD.index(stage) + 1]:
            assert move(mover, app["id"], step).status_code == 200
    elif stage in ("rejected", "withdrawn"):
        assert move(mover, app["id"], stage, note="reason").status_code == 200
    return get(client, app["id"])


_n = itertools.count(1000)


@pytest.fixture
def hr(client_as):
    return client_as(UserRole.HR_MANAGER)


@pytest.fixture
def rec(client_as):
    return client_as(UserRole.RECRUITER)


class TestTransitionMatrix:
    @pytest.mark.parametrize("current,target", list(itertools.product(STAGES, STAGES)))
    def test_admin_every_pair(self, client, current, target):
        app = application_in(client, current)
        res = move(client, app["id"], target, note="because")
        if target in ALLOWED[current]:
            assert res.status_code == 200, f"{current}->{target}: {res.text}"
            assert res.json()["stage"] == target
        else:
            assert res.status_code == 409, f"{current}->{target}: {res.status_code} {res.text}"
            assert get(client, app["id"])["stage"] == current

    @pytest.mark.parametrize("current,target", list(itertools.product(STAGES, STAGES)))
    def test_recruiter_every_pair(self, client, rec, current, target):
        app = application_in(client, current)
        res = move(rec, app["id"], target, note="because")
        if target == "hired":
            assert res.status_code == 403  # a hiring decision is HR's, whatever the stage
        elif target in ALLOWED[current]:
            assert res.status_code == 200, f"{current}->{target}: {res.text}"
        else:
            assert res.status_code == 409

    def test_the_server_tells_each_role_what_is_allowed(self, client, rec):
        for stage in STAGES:
            app = application_in(client, stage)
            assert set(get(client, app["id"])["allowed_stages"]) == ALLOWED[stage]
            expected = ALLOWED[stage] - {"hired"}
            assert set(get(rec, app["id"])["allowed_stages"]) == expected

    def test_the_hint_matches_what_the_server_really_accepts(self, client):
        """allowed_stages must never promise a move the server then refuses."""
        for stage in STAGES:
            for target in STAGES:
                app = application_in(client, stage)
                promised = target in get(client, app["id"])["allowed_stages"]
                assert (move(client, app["id"], target, note="x").status_code == 200) == promised


class TestSkippingAndOrder:
    @pytest.mark.parametrize("target", ["shortlisted", "interview", "offer", "hired"])
    def test_a_new_application_cannot_jump_ahead(self, client, target):
        app = make_application(client)
        res = move(client, app["id"], target)
        assert res.status_code == 409
        assert "cannot move directly" in res.json()["detail"]
        assert get(client, app["id"])["stage"] == "applied"

    def test_the_full_happy_path_one_step_at_a_time(self, client):
        app = make_application(client)
        for step in FORWARD:
            assert move(client, app["id"], step).status_code == 200
        body = get(client, app["id"])
        assert body["stage"] == "hired"
        assert event_types(body) == ["created", "stage_changed", "stage_changed", "stage_changed", "stage_changed", "hired"]

    def test_one_step_back_is_allowed_and_recorded(self, client):
        app = application_in(client, "interview")
        assert move(client, app["id"], "shortlisted", note="moved by mistake").status_code == 200
        last = get(client, app["id"])["events"][-1]
        assert (last["event_type"], last["from_value"], last["to_value"]) == ("stage_changed", "interview", "shortlisted")
        assert last["note"] == "moved by mistake"

    def test_two_steps_back_is_refused(self, client):
        app = application_in(client, "interview")
        assert move(client, app["id"], "screening").status_code == 409

    def test_moving_to_the_current_stage_is_refused_clearly(self, client):
        app = application_in(client, "screening")
        res = move(client, app["id"], "screening")
        assert res.status_code == 409 and "already screening" in res.json()["detail"]

    @pytest.mark.parametrize("bad", ["", "promoted", "HIRED", None, 5])
    def test_invalid_stage_values(self, client, bad):
        app = make_application(client)
        assert client.post(f"{APPS}/{app['id']}/stage", json={"stage": bad}).status_code == 422

    def test_stage_body_rejects_extra_fields(self, client):
        app = make_application(client)
        res = client.post(f"{APPS}/{app['id']}/stage", json={"stage": "screening", "applied_at": "2020-01-01T00:00:00Z"})
        assert res.status_code == 422

    def test_unknown_application_is_404(self, client):
        assert move(client, str(uuid.uuid4()), "screening").status_code == 404

    def test_the_submission_date_never_changes(self, client):
        app = make_application(client)
        for step in ("screening", "shortlisted"):
            move(client, app["id"], step)
        move(client, app["id"], "rejected", note="No")
        body = get(client, app["id"])
        assert body["applied_at"] == app["applied_at"]
        assert body["stage_changed_at"] > app["stage_changed_at"]

    def test_unrelated_edits_do_not_change_the_stage_or_its_timestamp(self, client):
        app = application_in(client, "shortlisted")
        client.patch(f"{APPS}/{app['id']}", json={"internal_notes": "n", "assigned_recruiter_id": str(client.user.id)})
        after = get(client, app["id"])
        assert after["stage"] == "shortlisted"
        assert after["stage_changed_at"] == app["stage_changed_at"]


class TestTerminalStages:
    @pytest.mark.parametrize("terminal", ["hired", "rejected", "withdrawn"])
    def test_terminal_applications_cannot_move_anywhere(self, client, terminal):
        app = application_in(client, terminal)
        for target in STAGES:
            res = move(client, app["id"], target, note="x")
            assert res.status_code == 409, f"{terminal}->{target}"
        assert get(client, app["id"])["stage"] == terminal

    def test_the_message_for_a_rejected_application_points_to_reopening(self, client):
        app = application_in(client, "rejected")
        assert "can reopen" in move(client, app["id"], "applied").json()["detail"]

    def test_the_message_for_a_hired_application_does_not(self, client):
        app = application_in(client, "hired")
        detail = move(client, app["id"], "applied").json()["detail"]
        assert "final" in detail and "reopen" not in detail


class TestRejectAndWithdraw:
    def test_rejecting_needs_a_reason(self, client):
        app = make_application(client)
        for note in (None, "", "   "):
            res = client.post(f"{APPS}/{app['id']}/stage", json={"stage": "rejected", "note": note})
            assert res.status_code == 422 and "reason" in res.json()["detail"]
        assert get(client, app["id"])["stage"] == "applied"

    def test_rejection_is_recorded_with_its_reason_and_actor(self, client):
        app = application_in(client, "interview")
        move(client, app["id"], "rejected", note="Missing required skills")
        event = get(client, app["id"])["events"][-1]
        assert event["event_type"] == "rejected"
        assert (event["from_value"], event["to_value"]) == ("interview", "rejected")
        assert event["note"] == "Missing required skills"
        assert event["actor"]["email"] == client.user.email

    def test_withdrawal_needs_no_reason_and_is_recorded(self, client):
        app = application_in(client, "screening")
        assert move(client, app["id"], "withdrawn").status_code == 200
        event = get(client, app["id"])["events"][-1]
        assert (event["event_type"], event["from_value"], event["to_value"]) == ("withdrawn", "screening", "withdrawn")

    def test_notes_are_trimmed_and_limited(self, client):
        app = make_application(client)
        assert client.post(f"{APPS}/{app['id']}/stage", json={"stage": "withdrawn", "note": "x" * 501}).status_code == 422
        move(client, app["id"], "withdrawn", note="  gone  ")
        assert get(client, app["id"])["events"][-1]["note"] == "gone"

    def test_recruiters_can_reject_and_withdraw(self, client, rec):
        a, b = make_application(client, 1), make_application(client, 2)
        assert move(rec, a["id"], "rejected", note="No").status_code == 200
        assert move(rec, b["id"], "withdrawn").status_code == 200


class TestHiring:
    def test_only_hr_and_admin_can_mark_hired(self, client, hr, rec):
        app = application_in(client, "offer")
        assert move(rec, app["id"], "hired").status_code == 403
        assert get(client, app["id"])["stage"] == "offer"
        assert move(hr, app["id"], "hired").status_code == 200

    def test_a_refused_hire_writes_no_history(self, client, rec):
        app = application_in(client, "offer")
        before = len(get(client, app["id"])["events"])
        move(rec, app["id"], "hired")
        assert len(get(client, app["id"])["events"]) == before

    def test_recruiters_get_the_same_refusal_whatever_the_stage(self, client, rec):
        """No hints about the rules to someone not allowed to hire."""
        for stage in ("applied", "offer", "rejected"):
            app = application_in(client, stage)
            assert move(rec, app["id"], "hired").status_code == 403

    def test_hiring_is_recorded_as_hired(self, client, hr):
        app = application_in(client, "offer")
        move(hr, app["id"], "hired", note="Offer accepted")
        event = get(client, app["id"])["events"][-1]
        assert (event["event_type"], event["from_value"], event["to_value"]) == ("hired", "offer", "hired")
        assert event["actor"]["email"] == hr.user.email

    def test_hiring_never_happens_by_itself(self, client):
        app = application_in(client, "offer")
        client.patch(f"{APPS}/{app['id']}", json={"internal_notes": "great"})
        assert get(client, app["id"])["stage"] == "offer"


class TestReopen:
    def reopen(self, c, app_id, note=None):
        return c.post(f"{APPS}/{app_id}/reopen", json={"note": note} if note else {})

    @pytest.mark.parametrize("terminal", ["rejected", "withdrawn"])
    def test_hr_can_reopen_back_to_the_stage_it_was_closed_from(self, client, hr, terminal):
        app = application_in(client, "interview")
        move(client, app["id"], terminal, note="x")
        res = self.reopen(hr, app["id"], "Candidate is available again")
        assert res.status_code == 200, res.text
        assert res.json()["stage"] == "interview"
        event = res.json()["events"][-1]
        assert (event["event_type"], event["from_value"], event["to_value"]) == ("reopened", terminal, "interview")
        assert event["note"] == "Candidate is available again"

    def test_reopening_after_several_rounds_restores_the_right_stage(self, client, hr):
        app = application_in(client, "shortlisted")
        move(client, app["id"], "rejected", note="x")
        self.reopen(hr, app["id"])
        move(client, app["id"], "interview")
        move(client, app["id"], "withdrawn")
        assert self.reopen(hr, app["id"]).json()["stage"] == "interview"

    def test_a_reopened_application_continues_normally(self, client, hr):
        app = application_in(client, "applied")
        move(client, app["id"], "rejected", note="x")
        self.reopen(hr, app["id"])
        assert move(client, app["id"], "screening").status_code == 200

    def test_recruiters_cannot_reopen(self, client, rec):
        app = application_in(client, "rejected")
        assert self.reopen(rec, app["id"]).status_code == 403
        assert get(client, app["id"])["stage"] == "rejected"

    def test_hired_never_reopens(self, client, hr):
        app = application_in(client, "hired")
        res = self.reopen(hr, app["id"])
        assert res.status_code == 409 and "final" in res.json()["detail"]

    @pytest.mark.parametrize("stage", ["applied", "screening", "offer"])
    def test_only_closed_out_applications_reopen(self, client, hr, stage):
        app = application_in(client, stage)
        assert self.reopen(hr, app["id"]).status_code == 409

    def test_nothing_reopens_on_a_closed_job(self, client, hr):
        app = application_in(client, "rejected")
        client.post(f"{JOBS}/{app['job']['id']}/status", json={"status": "closed"})
        res = self.reopen(hr, app["id"])
        assert res.status_code == 409 and "job is closed" in res.json()["detail"]
        assert get(hr, app["id"])["can_reopen"] is False

    def test_can_reopen_flag_follows_role_and_stage(self, client, hr, rec):
        app = application_in(client, "rejected")
        assert get(hr, app["id"])["can_reopen"] is True
        assert get(client, app["id"])["can_reopen"] is True
        assert get(rec, app["id"])["can_reopen"] is False

    def test_unknown_application_is_404(self, hr):
        assert self.reopen(hr, str(uuid.uuid4())).status_code == 404


class TestClosedJobs:
    def test_nothing_progresses_on_a_closed_job_but_it_can_still_end(self, client):
        app = application_in(client, "screening")
        client.post(f"{JOBS}/{app['job']['id']}/status", json={"status": "closed"})
        assert get(client, app["id"])["allowed_stages"] == ["rejected", "withdrawn"]
        for target in ("applied", "shortlisted"):
            res = move(client, app["id"], target)
            assert res.status_code == 409 and "job is closed" in res.json()["detail"]
        assert move(client, app["id"], "withdrawn").status_code == 200

    def test_hiring_on_a_closed_job_is_refused(self, client):
        app = application_in(client, "offer")
        client.post(f"{JOBS}/{app['job']['id']}/status", json={"status": "closed"})
        assert move(client, app["id"], "hired").status_code == 409

    def test_on_hold_jobs_keep_working(self, client):
        app = application_in(client, "applied")
        client.post(f"{JOBS}/{app['job']['id']}/status", json={"status": "on_hold"})
        assert move(client, app["id"], "screening").status_code == 200

    def test_reopening_the_job_restores_normal_movement(self, client):
        app = application_in(client, "screening")
        client.post(f"{JOBS}/{app['job']['id']}/status", json={"status": "closed"})
        client.post(f"{JOBS}/{app['job']['id']}/status", json={"status": "open"})
        assert move(client, app["id"], "shortlisted").status_code == 200


class TestHistoryIntegrity:
    def counts(self, session_factory, app_id: str):
        with session_factory() as db:
            stage = db.scalar(select(Application.stage).where(Application.id == uuid.UUID(app_id)))
            events = db.scalar(select(func.count()).select_from(ApplicationEvent).where(
                ApplicationEvent.application_id == uuid.UUID(app_id)))
            return stage.value, events

    def test_every_successful_change_has_exactly_one_history_row(self, client, session_factory):
        app = make_application(client)
        for n, step in enumerate(["screening", "shortlisted", "interview"], start=2):
            assert move(client, app["id"], step).status_code == 200
            assert self.counts(session_factory, app["id"]) == (step, n)

    def test_refused_changes_leave_no_trace(self, client, rec, session_factory):
        app = application_in(client, "screening")
        before = self.counts(session_factory, app["id"])
        move(client, app["id"], "offer")          # skip
        move(client, app["id"], "screening")      # same stage
        move(rec, app["id"], "hired")             # not allowed
        client.post(f"{APPS}/{app['id']}/stage", json={"stage": "rejected"})  # no reason
        assert self.counts(session_factory, app["id"]) == before

    def test_if_writing_the_history_fails_the_stage_change_is_rolled_back(self, client, session_factory, monkeypatch):
        from app.services import application as service

        app = application_in(client, "screening")
        before = self.counts(session_factory, app["id"])

        def broken(*_a, **_k):
            raise RuntimeError("disk full")

        monkeypatch.setattr(service, "_record", broken)
        with pytest.raises(RuntimeError):
            move(client, app["id"], "shortlisted")
        monkeypatch.undo()
        assert self.counts(session_factory, app["id"]) == before
        assert get(client, app["id"])["stage"] == "screening"

    def test_if_the_candidate_update_fails_nothing_is_kept(self, client, session_factory, monkeypatch):
        from app.services import application as service

        app = application_in(client, "screening")
        before = self.counts(session_factory, app["id"])

        def broken(*_a, **_k):
            raise RuntimeError("boom")

        monkeypatch.setattr(service, "touch_activity", broken)
        with pytest.raises(RuntimeError):
            move(client, app["id"], "shortlisted")
        monkeypatch.undo()
        assert self.counts(session_factory, app["id"]) == before

    def test_if_history_fails_during_creation_no_application_is_left(self, client, session_factory, monkeypatch):
        from app.services import application as service

        cand, job = make_candidate(client), open_job(client)
        monkeypatch.setattr(service, "_record", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
        with pytest.raises(RuntimeError):
            apply(client, cand, job)
        monkeypatch.undo()
        assert client.get(APPS).json()["total"] == 0
        assert apply(client, cand, job).status_code == 201  # and the pair is still free

    def test_a_concurrent_change_is_detected_not_silently_overwritten(self, client, session_factory, monkeypatch):
        """Someone else moves the application between our read and our write."""
        from app.services import application as service

        app = application_in(client, "screening")
        real = service._move

        def racing(db, application, actor, **kw):
            with session_factory() as other:  # a second user wins the race
                row = other.get(Application, application.id)
                row.stage = "shortlisted"
                other.commit()
            return real(db, application, actor, **kw)

        monkeypatch.setattr(service, "_move", racing)
        res = move(client, app["id"], "rejected", note="late")
        assert res.status_code == 409 and "just changed by someone else" in res.json()["detail"]
        monkeypatch.undo()
        body = get(client, app["id"])
        assert body["stage"] == "shortlisted"
        assert "rejected" not in event_types(body)

    def test_history_survives_a_failed_unrelated_request(self, client):
        app = application_in(client, "interview")
        before = get(client, app["id"])["events"]
        client.patch(f"{APPS}/{app['id']}", json={"assigned_recruiter_id": str(uuid.uuid4())})  # 422
        assert get(client, app["id"])["events"] == before
