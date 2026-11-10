"""Interview feedback: human-written, private where it must be, and never silently changed."""

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models.interview import Interview
from app.models.user import UserRole
from tests.interview_helpers import INTERVIEWS, board, feedback_body


@pytest.fixture
def b(client_as, session_factory):
    ctx = board(client_as)
    with session_factory() as db:  # the interview has started: feedback may be submitted
        row = db.get(Interview, uuid.UUID(ctx.id))
        row.starts_at -= timedelta(days=5)
        row.ends_at -= timedelta(days=5)
        db.commit()
    return ctx


def put(c, ctx, **over):
    return c.put(f"{ctx.url}/feedback", json=feedback_body(**over))


def submit(c, ctx, **over):
    return c.post(f"{ctx.url}/feedback/submit", json=feedback_body(**over))


def overview(c, ctx):
    return c.get(f"{ctx.url}/feedback").json()


class TestDrafts:
    def test_an_interviewer_can_save_and_change_a_draft(self, b):
        r = put(b.rec, b, overall_rating=2)
        assert r.status_code == 200 and r.json()["status"] == "draft" and r.json()["overall_rating"] == 2
        r2 = put(b.rec, b, overall_rating=4, overall_feedback="Changed my mind")
        assert r2.json()["id"] == r.json()["id"] and r2.json()["overall_rating"] == 4 and r2.json()["submitted_at"] is None

    def test_a_draft_may_be_incomplete(self, b):
        r = b.rec.put(f"{b.url}/feedback", json={"strengths": "Only this so far"})
        assert r.status_code == 200 and r.json()["overall_rating"] is None

    def test_a_draft_is_visible_to_nobody_else_not_even_admin_or_hr(self, b):
        put(b.rec, b)
        assert overview(b.hr, b)["items"] == [] and overview(b.admin, b)["items"] == []
        mine = overview(b.rec, b)["items"]
        assert len(mine) == 1 and mine[0]["is_mine"] and mine[0]["private_notes"] == "PRIVATE-NOTE-ONLY-FOR-AUTHOR"

    def test_only_an_assigned_interviewer_can_write(self, b, client_as):
        outsider = client_as(UserRole.RECRUITER)
        for who in (outsider, b.admin):  # an admin who is not on the interview cannot write either
            assert put(who, b).status_code == 403
            assert submit(who, b).status_code == 403
            assert who.patch(f"{b.url}/feedback", json={**feedback_body(), "edit_reason": "x"}).status_code == 403

    def test_a_draft_after_submission_is_refused(self, b):
        submit(b.rec, b)
        r = put(b.rec, b)
        assert r.status_code == 409 and "edit" in r.json()["detail"]


class TestSubmit:
    def test_a_complete_submission(self, b):
        r = submit(b.rec, b)
        body = r.json()
        assert r.status_code == 201 and body["status"] == "submitted" and body["version"] == 1 and body["submitted_at"]
        assert body["interviewer"]["email"] == b.rec.user.email

    def test_a_draft_becomes_the_submission(self, b):
        draft = put(b.rec, b, overall_rating=2).json()
        r = submit(b.rec, b, overall_rating=5).json()
        assert r["id"] == draft["id"] and r["overall_rating"] == 5 and r["status"] == "submitted"

    @pytest.mark.parametrize(
        "over",
        [{"overall_rating": None}, {"overall_feedback": None}, {"overall_feedback": "   "}, {"overall_rating": 0}, {"overall_rating": 6},
         {"technical_rating": 0}, {"communication_rating": 6}, {"problem_solving_rating": -1}, {"overall_rating": "high"},
         {"overall_feedback": "x" * 4001}, {"strengths": "x" * 4001}, {"private_notes": "x" * 4001},
         {"status": "submitted"}, {"interviewer_id": str(uuid.uuid4())}, {"version": 9}, {"submitted_at": "2030-01-01T00:00:00Z"}],
    )
    def test_invalid_submissions_are_refused_and_store_nothing(self, b, over):
        assert submit(b.rec, b, **over).status_code == 422
        assert overview(b.rec, b)["items"] == []

    def test_optional_ratings_may_be_left_out(self, b):
        r = b.rec.post(f"{b.url}/feedback/submit", json={"overall_rating": 3, "overall_feedback": "Fine."})
        assert r.status_code == 201 and r.json()["technical_rating"] is None

    def test_it_cannot_be_submitted_twice(self, b):
        submit(b.rec, b)
        assert submit(b.rec, b).status_code == 409

    def test_each_interviewer_has_their_own_feedback(self, b):
        a, c = submit(b.rec, b).json(), submit(b.hr, b, overall_rating=2).json()
        assert a["id"] != c["id"] and a["overall_rating"] == 4 and c["overall_rating"] == 2

    def test_it_cannot_be_submitted_before_the_interview_starts(self, client_as):
        ctx = board(client_as)  # still in the future
        r = submit(ctx.rec, ctx)
        assert r.status_code == 409 and "started" in r.json()["detail"]
        assert put(ctx.rec, ctx).status_code == 200  # a draft is fine

    @pytest.mark.parametrize("end", ["cancel", "reschedule"])
    def test_a_cancelled_or_rescheduled_interview_takes_no_feedback(self, b, end):
        if end == "cancel":
            b.admin.post(f"{b.url}/cancel", json={"reason": "x"})
        else:
            from tests.interview_helpers import slot

            b.admin.post(f"{b.url}/reschedule", json=slot(9, 10))
        assert put(b.rec, b).status_code == 409 and submit(b.rec, b).status_code == 409

    def test_a_completed_interview_accepts_feedback(self, b):
        assert b.admin.post(f"{b.url}/complete").status_code == 200
        assert submit(b.rec, b).status_code == 201


class TestVisibility:
    def test_hr_and_admin_see_every_submitted_feedback_but_never_private_notes(self, b):
        submit(b.rec, b)
        submit(b.hr, b, overall_rating=2, private_notes="HR-PRIVATE")
        for viewer in (b.admin, b.hr):
            seen = overview(viewer, b)
            assert seen["can_view_all"] and len(seen["items"]) == 2
            others = [i for i in seen["items"] if not i["is_mine"]]
            assert all(i["private_notes"] is None for i in others)
        assert "PRIVATE-NOTE-ONLY-FOR-AUTHOR" not in str(overview(b.admin, b)) and "PRIVATE-NOTE-ONLY-FOR-AUTHOR" not in str(overview(b.hr, b))

    def test_a_recruiter_sees_only_their_own(self, b, client_as):
        submit(b.hr, b)
        seen = overview(b.rec, b)
        assert seen["can_view_all"] is False and seen["items"] == []  # the HR manager's submission is not theirs
        submit(b.rec, b)
        assert [i["is_mine"] for i in overview(b.rec, b)["items"]] == [True]

    def test_a_non_interviewer_recruiter_sees_nothing_of_the_content(self, b, client_as):
        submit(b.rec, b)
        outsider = client_as(UserRole.RECRUITER)
        seen = overview(outsider, b)
        assert seen["items"] == [] and seen["submitted_count"] == 1
        assert "Solid conversation" not in str(seen)

    def test_pending_interviewers_are_named(self, b):
        assert {p["email"] for p in overview(b.admin, b)["pending_interviewers"]} == {b.rec.user.email, b.hr.user.email}
        submit(b.rec, b)
        seen = overview(b.admin, b)
        assert [p["email"] for p in seen["pending_interviewers"]] == [b.hr.user.email] and seen["submitted_count"] == 1

    def test_the_overview_has_no_averages_or_rankings(self, b):
        submit(b.rec, b)
        seen = overview(b.admin, b)
        assert not {"average", "mean", "score", "rank", "total"} & set(seen)
        assert not any(k in seen["items"][0] for k in ("average", "rank", "score", "percentile"))

    def test_private_notes_are_never_in_a_revision(self, b):
        submit(b.rec, b)
        b.rec.patch(f"{b.url}/feedback", json={**feedback_body(overall_feedback="Edited"), "edit_reason": "typo"})
        fid = overview(b.rec, b)["items"][0]["id"]
        revisions = b.rec.get(f"{b.url}/feedback/{fid}/revisions").json()
        assert "PRIVATE-NOTE-ONLY-FOR-AUTHOR" not in str(revisions) and revisions[0]["snapshot"]["overall_feedback"] == "Solid conversation; clear thinker."


class TestControlledEdits:
    def test_an_edit_needs_a_reason_and_keeps_the_previous_version(self, b):
        submit(b.rec, b)
        r = b.rec.patch(f"{b.url}/feedback", json={**feedback_body(overall_rating=2, overall_feedback="On reflection, weaker."), "edit_reason": "Reconsidered after the debrief"})
        assert r.status_code == 200 and r.json()["version"] == 2 and r.json()["overall_rating"] == 2
        fid = r.json()["id"]
        revs = b.rec.get(f"{b.url}/feedback/{fid}/revisions").json()
        assert len(revs) == 1 and revs[0]["version"] == 1 and revs[0]["snapshot"]["overall_rating"] == 4
        assert revs[0]["edit_reason"] == "Reconsidered after the debrief" and revs[0]["edited_by"]["email"] == b.rec.user.email

    def test_every_edit_adds_a_revision(self, b):
        submit(b.rec, b)
        for n in range(3):
            b.rec.patch(f"{b.url}/feedback", json={**feedback_body(overall_feedback=f"Take {n}"), "edit_reason": f"round {n}"})
        fid = overview(b.rec, b)["items"][0]["id"]
        revs = b.rec.get(f"{b.url}/feedback/{fid}/revisions").json()
        assert [r["version"] for r in revs] == [1, 2, 3] and revs[2]["snapshot"]["overall_feedback"] == "Take 1"

    @pytest.mark.parametrize("over", [{"edit_reason": ""}, {"edit_reason": "   "}, {"edit_reason": "x" * 301}, {"edit_reason": None}, {"overall_rating": None, "edit_reason": "x"}])
    def test_an_edit_without_a_reason_or_without_the_required_parts_is_refused(self, b, over):
        submit(b.rec, b)
        body = {**feedback_body(), "edit_reason": "ok", **over}
        assert b.rec.patch(f"{b.url}/feedback", json=body).status_code == 422
        assert overview(b.rec, b)["items"][0]["version"] == 1

    def test_there_is_nothing_to_edit_before_submitting(self, b):
        put(b.rec, b)
        r = b.rec.patch(f"{b.url}/feedback", json={**feedback_body(), "edit_reason": "x"})
        assert r.status_code == 409 and "Submit it first" in r.json()["detail"]

    def test_nobody_can_edit_someone_elses_feedback(self, b):
        submit(b.hr, b)
        # the recruiter has no feedback of their own to edit; the endpoint only ever touches your own
        r = b.rec.patch(f"{b.url}/feedback", json={**feedback_body(overall_feedback="Hijack"), "edit_reason": "x"})
        assert r.status_code == 409
        assert "Hijack" not in str(overview(b.admin, b))

    def test_the_number_of_edits_is_limited(self, b):
        submit(b.rec, b)
        codes = [b.rec.patch(f"{b.url}/feedback", json={**feedback_body(overall_feedback=f"v{n}"), "edit_reason": "again"}).status_code for n in range(12)]
        assert codes[:10] == [200] * 10 and codes[10:] == [409, 409]

    def test_revisions_are_visible_to_the_author_and_hr_not_to_other_recruiters(self, b, client_as):
        submit(b.rec, b)
        b.rec.patch(f"{b.url}/feedback", json={**feedback_body(overall_feedback="B"), "edit_reason": "x"})
        fid = overview(b.rec, b)["items"][0]["id"]
        url = f"{b.url}/feedback/{fid}/revisions"
        assert b.rec.get(url).status_code == 200 and b.hr.get(url).status_code == 200 and b.admin.get(url).status_code == 200
        assert client_as(UserRole.RECRUITER).get(url).status_code == 404
        assert b.rec.get(f"{b.url}/feedback/{uuid.uuid4()}/revisions").status_code == 404

    def test_a_draft_has_no_revisions_for_hr(self, b):
        draft = put(b.rec, b).json()
        assert b.hr.get(f"{b.url}/feedback/{draft['id']}/revisions").status_code == 404  # a draft is not theirs to see

    def test_revisions_cannot_be_changed_in_the_data_layer(self, b, session_factory):
        from app.models.interview import HistoryIsAppendOnly, InterviewFeedbackRevision

        submit(b.rec, b)
        b.rec.patch(f"{b.url}/feedback", json={**feedback_body(overall_feedback="B"), "edit_reason": "x"})
        with session_factory() as db:
            row = db.scalar(select(InterviewFeedbackRevision))
            row.snapshot = {"tampered": True}
            with pytest.raises(HistoryIsAppendOnly):
                db.flush()


class TestInterplay:
    def test_an_interviewer_with_feedback_cannot_be_removed(self, b):
        put(b.rec, b)
        r = b.admin.delete(f"{b.url}/interviewers/{b.rec.user.id}")
        assert r.status_code == 409 and "already has feedback" in r.json()["detail"]

    def test_the_interview_shows_who_has_feedback_but_not_what_it_says(self, b):
        submit(b.rec, b)
        put(b.hr, b)
        i = b.admin.get(b.url).json()
        status = {x["email"]: x["feedback_status"] for x in i["interviewers"]}
        assert status == {b.rec.user.email: "submitted", b.hr.user.email: "draft"}
        assert "Solid conversation" not in str(i)
        assert b.rec.get(b.url).json()["my_feedback_status"] == "submitted" and b.admin.get(b.url).json()["my_feedback_status"] is None

    def test_allowed_actions_reflect_the_viewer(self, b, client_as):
        mine = b.rec.get(b.url).json()["allowed_actions"]
        assert "submit_feedback" in mine and "save_feedback_draft" in mine and "cancel" in mine
        assert "submit_feedback" not in b.admin.get(b.url).json()["allowed_actions"]

    def test_feedback_never_moves_the_application(self, b):
        submit(b.rec, b)
        b.rec.patch(f"{b.url}/feedback", json={**feedback_body(), "edit_reason": "x"})
        assert b.admin.get(f"/api/v1/applications/{b.app['id']}").json()["stage"] == "applied"

    def test_the_rating_scale_is_described(self, b):
        scale = b.rec.get(f"{INTERVIEWS}/rating-scale").json()
        assert [s["value"] for s in scale["scale"]] == [1, 2, 3, 4, 5] and all(s["description"] for s in scale["scale"])
        assert {a["key"] for a in scale["areas"]} >= {"overall_rating", "technical_rating"}

    def test_stats_follow_feedback(self, b):
        before = b.admin.get(f"{INTERVIEWS}/stats").json()
        assert before["feedback_pending"] == 2 and before["feedback_submitted"] == 0
        submit(b.rec, b)
        after = b.admin.get(f"{INTERVIEWS}/stats").json()
        assert after["feedback_pending"] == 1 and after["feedback_submitted"] == 1

    def test_unknown_interviews_are_a_404(self, b):
        assert b.rec.get(f"{INTERVIEWS}/{uuid.uuid4()}/feedback").status_code == 404
        assert b.rec.put(f"{INTERVIEWS}/{uuid.uuid4()}/feedback", json={}).status_code == 404
