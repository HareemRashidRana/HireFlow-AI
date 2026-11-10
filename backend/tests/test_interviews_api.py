"""Interviews through the HTTP API: creation, validation, conflicts, lifecycle, rescheduling,
interviewers, listing and statistics."""

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.models.application import Application, ApplicationEvent
from app.models.interview import Interview, InterviewEvent
from app.models.user import UserRole
from tests.interview_helpers import INTERVIEWS, new_application, payload, schedule, scheduled, slot
from tests.test_applications import apply, make_candidate, open_job


@pytest.fixture
def world(client, make_user):
    app = new_application(client, 1)
    a, b = make_user(UserRole.RECRUITER), make_user(UserRole.HR_MANAGER)
    return client, app, a, b


def age(session_factory, interview_id: str, hours: int = 24 * 5) -> None:
    """Move an interview into the past (the API refuses to schedule there)."""
    with session_factory() as db:
        row = db.get(Interview, uuid.UUID(interview_id))
        row.starts_at -= timedelta(hours=hours)
        row.ends_at -= timedelta(hours=hours)
        db.commit()


class TestCreate:
    def test_a_valid_interview_is_stored_with_everything_asked_for(self, world):
        client, app, a, b = world
        res = schedule(client, app, [a, b], title="Platform interview", interview_type="panel", mode="in_person",
                       location="Head office, room 4", meeting_url=None, round_number=2)
        assert res.status_code == 201, res.text
        i = res.json()
        assert (i["title"], i["interview_type"], i["mode"], i["status"], i["round_number"]) == ("Platform interview", "panel", "in_person", "scheduled", 2)
        assert i["location"] == "Head office, room 4" and i["timezone"] == "Asia/Karachi"
        assert {x["email"] for x in i["interviewers"]} == {a.email, b.email}
        assert i["duration_minutes"] == 60 and i["utc_offset"] == "+05:00"
        assert i["starts_local"].endswith("T10:00") and i["ends_local"].endswith("T11:00")
        assert i["created_by"]["email"] == client.user.email and i["rescheduled_from_id"] is None

    def test_the_response_carries_no_candidate_contact_details(self, world):
        client, app, a, _ = world
        body = scheduled(client, app, [a])
        text = str(body)
        for private in (app["candidate"]["email"], "sana.iqbal1@example.com", "+92 300", "Lahore"):
            assert private not in text
        assert body["application"]["candidate"].keys() == {"id", "first_name", "last_name"}

    def test_the_round_defaults_to_the_next_one(self, world):
        client, app, a, b = world
        rounds = [scheduled(client, app, [u], day=3 + n)["round_number"] for n, u in enumerate((a, b, a))]
        assert rounds == [1, 2, 3]

    def test_a_local_time_is_read_in_the_chosen_zone_and_an_offset_is_converted(self, world):
        client, app, a, b = world
        local = scheduled(client, app, [a], day=4, hour=10)  # 10:00 in Karachi = 05:00 UTC
        assert local["starts_at"].endswith("05:00:00Z") or "T05:00:00" in local["starts_at"]
        s = slot(5, 10, tz="UTC")
        offset = scheduled(client, app, [b], day=5, starts_at=s["starts_at"] + ":00+05:00", ends_at=s["ends_at"] + ":00+05:00", timezone="Europe/London")
        assert "T05:00:00" in offset["starts_at"] and offset["timezone"] == "Europe/London"

    def test_a_time_inside_a_daylight_saving_gap_is_refused_with_a_clear_message(self, world):
        client, app, a, _ = world
        res = client.post(INTERVIEWS, json=payload(app, [a], starts_at="2035-03-25T01:30", ends_at="2035-03-25T02:30", timezone="Europe/London"))
        assert res.status_code == 422 and "does not exist" in res.json()["detail"]

    def test_an_ambiguous_time_is_refused_not_guessed(self, world):
        client, app, a, _ = world
        res = client.post(INTERVIEWS, json=payload(app, [a], starts_at="2035-10-28T01:30", ends_at="2035-10-28T02:30", timezone="Europe/London"))
        assert res.status_code == 422 and "happens twice" in res.json()["detail"]

    @pytest.mark.parametrize(
        "over",
        [
            {"title": ""}, {"title": "   "}, {"title": "x" * 151}, {"interview_type": "chat"}, {"mode": "telepathy"},
            {"timezone": "Mars/Base"}, {"timezone": ""}, {"interviewer_ids": []}, {"interviewer_ids": ["not-a-uuid"]},
            {"starts_at": "not a date"}, {"round_number": 0}, {"round_number": 21}, {"location": "x" * 256},
            {"mode": "in_person", "location": None}, {"meeting_url": "http://insecure.example.com/x"},
            {"meeting_url": "https://meet.example.com/j/1?pwd=secret"}, {"meeting_url": "https://u:p@meet.example.com/x"},
            {"status": "completed"}, {"created_by_id": str(uuid.uuid4())}, {"id": str(uuid.uuid4())},
        ],
    )
    def test_invalid_input_is_refused_and_nothing_is_stored(self, world, session_factory, over):
        client, app, a, _ = world
        res = client.post(INTERVIEWS, json=payload(app, [a], **over))
        assert res.status_code == 422, over
        with session_factory() as db:
            assert db.scalar(select(func.count()).select_from(Interview)) == 0

    @pytest.mark.parametrize("minutes,message", [(0, "after the start"), (-60, "after the start"), (2, "at least 5"), (13 * 60, "at most 12")])
    def test_the_time_range_is_checked(self, world, minutes, message):
        client, app, a, _ = world
        s = slot(3, 10, minutes=60)
        from datetime import datetime

        end = (datetime.fromisoformat(s["starts_at"]) + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M")
        res = client.post(INTERVIEWS, json=payload(app, [a], ends_at=end))
        assert res.status_code == 422 and message in res.json()["detail"]

    def test_the_past_is_refused(self, world):
        client, app, a, _ = world
        res = client.post(INTERVIEWS, json=payload(app, [a], day=-2))
        assert res.status_code == 422 and "past" in res.json()["detail"]

    def test_the_interviewers_must_be_active_staff(self, world, make_user, client_as):
        client, app, a, _ = world
        employee = make_user(UserRole.EMPLOYEE, employee_id=None)
        inactive = make_user(UserRole.RECRUITER, is_active=False)
        for bad in (employee, inactive, uuid.uuid4()):
            res = schedule(client, app, [a, bad])
            assert res.status_code == 422 and "active HireFlow staff" in res.json()["detail"], bad

    def test_an_interviewer_cannot_be_listed_twice(self, world):
        client, app, a, _ = world
        res = client.post(INTERVIEWS, json=payload(app, [a, a]))
        assert res.status_code == 422

    def test_unknown_applications_are_a_404(self, world):
        client, app, a, _ = world
        res = client.post(INTERVIEWS, json=payload({"id": str(uuid.uuid4())}, [a]))
        assert res.status_code == 404

    def test_closed_applications_cannot_get_new_interviews(self, world):
        client, app, a, _ = world
        client.post(f"/api/v1/applications/{app['id']}/stage", json={"stage": "rejected", "note": "no fit"})
        res = schedule(client, app, [a])
        assert res.status_code == 409 and "closed" in res.json()["detail"]

    def test_an_anonymized_candidate_cannot_get_new_interviews(self, world):
        client, app, a, _ = world
        client.post(f"/api/v1/candidates/{app['candidate']['id']}/anonymize", json={"confirm": True})
        assert schedule(client, app, [a]).status_code == 409

    def test_scheduling_never_changes_the_application(self, world, session_factory):
        client, app, a, _ = world
        before = client.get(f"/api/v1/applications/{app['id']}").json()
        scheduled(client, app, [a])
        after = client.get(f"/api/v1/applications/{app['id']}").json()
        assert after["stage"] == before["stage"] == "applied" and after["events"] == before["events"]
        with session_factory() as db:
            assert db.scalar(select(func.count()).select_from(ApplicationEvent)) == len(before["events"])
            assert db.scalar(select(Application.stage)).value == before["stage"]

    def test_a_save_failure_is_a_clean_409(self, world, session_factory, monkeypatch):
        from sqlalchemy.exc import IntegrityError

        from app.core.exceptions import ConflictError
        from app.models.user import User
        from app.schemas.interview import InterviewCreate
        from app.services import interview as service

        client, app, a, _ = world
        with session_factory() as db:
            actor = db.scalar(select(User).where(User.id == client.user.id))
            data = InterviewCreate(**payload(app, [a]))

            def boom():
                raise IntegrityError("insert", {}, Exception("clash"))

            monkeypatch.setattr(db, "commit", boom)
            with pytest.raises(ConflictError):
                service.create_interview(db, actor, data)
            monkeypatch.undo()


class TestConflicts:
    def test_the_same_interviewer_cannot_be_in_two_overlapping_interviews(self, world):
        client, app, a, b = world
        scheduled(client, app, [a], title="First chat", hour=10)
        other = new_application(client, 2)
        res = schedule(client, other, [a, b], hour=10, minutes=30)
        assert res.status_code == 409
        detail = res.json()["detail"]
        assert detail.startswith("Scheduling conflict:") and a.email in detail and "First chat" in detail and "10:00-11:00" in detail
        assert b.email not in detail  # only the person who clashes is named

    def test_every_kind_of_overlap_is_caught(self, world):
        client, app, a, _ = world
        scheduled(client, app, [a], hour=10, minutes=60)  # 10:00-11:00
        other = new_application(client, 2)
        for hour, minutes in ((9, 90), (10, 30), (10, 60), (9, 180), (10, 15)):
            assert schedule(client, other, [a], hour=hour, minutes=minutes).status_code == 409, (hour, minutes)

    def test_back_to_back_interviews_do_not_conflict(self, world):
        client, app, a, _ = world
        scheduled(client, app, [a], hour=10, minutes=60)
        other = new_application(client, 2)
        assert schedule(client, other, [a], hour=11).status_code == 201  # starts exactly when the first ends
        third = new_application(client, 3)
        assert schedule(client, third, [a], hour=9).status_code == 201  # ends exactly when the first starts

    def test_a_different_interviewer_or_day_is_fine(self, world):
        client, app, a, b = world
        scheduled(client, app, [a], hour=10)
        other = new_application(client, 2)
        assert schedule(client, other, [b], hour=10).status_code == 201
        third = new_application(client, 3)
        assert schedule(client, third, [a], hour=10, day=4).status_code == 201

    def test_the_candidate_cannot_be_in_two_interviews_at_once(self, world):
        client, app, a, b = world
        scheduled(client, app, [a], hour=10)
        res = schedule(client, app, [b], hour=10, minutes=30)
        assert res.status_code == 409 and "the candidate already has" in res.json()["detail"]

    def test_overlap_is_decided_on_the_real_instant_across_time_zones(self, world):
        client, app, a, _ = world
        scheduled(client, app, [a], hour=10, minutes=60)  # 10:00 Karachi = 05:00 UTC
        other = new_application(client, 2)
        s = slot(3, 5, tz="UTC")  # 05:00 UTC: the same instant, written in another zone
        res = client.post(INTERVIEWS, json=payload(other, [a], **s))
        assert res.status_code == 409
        s2 = slot(3, 6, tz="UTC")  # 06:00 UTC: right after
        assert client.post(INTERVIEWS, json=payload(other, [a], **s2)).status_code == 201

    def test_cancelled_interviews_no_longer_block(self, world):
        client, app, a, _ = world
        first = scheduled(client, app, [a], hour=10)
        other = new_application(client, 2)
        assert schedule(client, other, [a], hour=10).status_code == 409
        client.post(f"{INTERVIEWS}/{first['id']}/cancel", json={"reason": "Candidate withdrew"})
        assert schedule(client, other, [a], hour=10).status_code == 201

    def test_a_rescheduled_original_no_longer_blocks_but_its_replacement_does(self, world):
        client, app, a, _ = world
        first = scheduled(client, app, [a], hour=10)
        s = slot(3, 14)
        moved = client.post(f"{INTERVIEWS}/{first['id']}/reschedule", json=s).json()
        other = new_application(client, 2)
        assert schedule(client, other, [a], hour=10).status_code == 201  # the old slot is free
        assert schedule(client, new_application(client, 3), [a], hour=14).status_code == 409  # the new one is not
        assert moved["status"] == "scheduled"

    def test_adding_a_busy_interviewer_is_a_conflict(self, world):
        client, app, a, b = world
        scheduled(client, app, [b], hour=10)
        other = new_application(client, 2)
        target = scheduled(client, other, [a], hour=10)
        res = client.post(f"{INTERVIEWS}/{target['id']}/interviewers", json={"user_id": str(b.id)})
        assert res.status_code == 409 and b.email in res.json()["detail"]

    def test_rescheduling_into_a_busy_slot_is_refused_and_changes_nothing(self, world):
        client, app, a, _ = world
        scheduled(client, app, [a], hour=14, title="Busy slot")
        other = new_application(client, 2)
        target = scheduled(client, other, [a], hour=10)
        res = client.post(f"{INTERVIEWS}/{target['id']}/reschedule", json=slot(3, 14))
        assert res.status_code == 409 and "Busy slot" in res.json()["detail"]
        assert client.get(f"{INTERVIEWS}/{target['id']}").json()["status"] == "scheduled"

    def test_a_small_shift_of_the_same_interview_does_not_conflict_with_itself(self, world):
        client, app, a, _ = world
        target = scheduled(client, app, [a], hour=10)
        res = client.post(f"{INTERVIEWS}/{target['id']}/reschedule", json=slot(3, 10, minutes=90))
        assert res.status_code == 201

    def test_two_conflicts_are_both_reported(self, world):
        client, app, a, b = world
        scheduled(client, app, [a], hour=10, title="One")
        scheduled(client, new_application(client, 2), [b], hour=10, title="Two")
        res = schedule(client, new_application(client, 3), [a, b], hour=10)
        assert res.status_code == 409 and "One" in res.json()["detail"] and "Two" in res.json()["detail"]


class TestLifecycle:
    def test_confirm_then_complete(self, world, session_factory):
        client, app, a, _ = world
        i = scheduled(client, app, [a])
        confirmed = client.post(f"{INTERVIEWS}/{i['id']}/confirm")
        assert confirmed.status_code == 200 and confirmed.json()["status"] == "confirmed"
        assert client.post(f"{INTERVIEWS}/{i['id']}/complete").status_code == 409  # not started yet
        age(session_factory, i["id"])
        done = client.post(f"{INTERVIEWS}/{i['id']}/complete")
        assert done.status_code == 200 and done.json()["status"] == "completed" and done.json()["completed_at"]

    def test_confirming_twice_is_refused(self, world):
        client, app, a, _ = world
        i = scheduled(client, app, [a])
        client.post(f"{INTERVIEWS}/{i['id']}/confirm")
        assert client.post(f"{INTERVIEWS}/{i['id']}/confirm").status_code == 409

    def test_cancelling_needs_a_reason_and_keeps_everything(self, world):
        client, app, a, _ = world
        i = scheduled(client, app, [a])
        for bad in ({}, {"reason": ""}, {"reason": "   "}, {"reason": "x" * 501}, {"reason": "ok", "status": "x"}):
            assert client.post(f"{INTERVIEWS}/{i['id']}/cancel", json=bad).status_code == 422
        res = client.post(f"{INTERVIEWS}/{i['id']}/cancel", json={"reason": "  Panel unavailable  "})
        c = res.json()
        assert res.status_code == 200 and c["status"] == "cancelled" and c["cancellation_reason"] == "Panel unavailable" and c["cancelled_at"]
        assert c["starts_at"] == i["starts_at"] and {x["id"] for x in c["interviewers"]} == {x["id"] for x in i["interviewers"]}
        assert client.get(f"{INTERVIEWS}/{i['id']}").status_code == 200  # still readable

    @pytest.mark.parametrize("end", ["cancel", "complete", "reschedule"])
    def test_finished_interviews_cannot_be_changed_again(self, world, session_factory, end):
        client, app, a, b = world
        i = scheduled(client, app, [a])
        if end == "cancel":
            client.post(f"{INTERVIEWS}/{i['id']}/cancel", json={"reason": "x"})
        elif end == "complete":
            age(session_factory, i["id"])
            client.post(f"{INTERVIEWS}/{i['id']}/complete")
        else:
            client.post(f"{INTERVIEWS}/{i['id']}/reschedule", json=slot(5, 10))
        attempts = [
            client.post(f"{INTERVIEWS}/{i['id']}/confirm"), client.post(f"{INTERVIEWS}/{i['id']}/complete"),
            client.post(f"{INTERVIEWS}/{i['id']}/cancel", json={"reason": "again"}),
            client.post(f"{INTERVIEWS}/{i['id']}/reschedule", json=slot(6, 10)),
            client.patch(f"{INTERVIEWS}/{i['id']}", json={"title": "Edited"}),
            client.post(f"{INTERVIEWS}/{i['id']}/interviewers", json={"user_id": str(b.id)}),
            client.delete(f"{INTERVIEWS}/{i['id']}/interviewers/{a.id}"),
        ]
        assert [r.status_code for r in attempts] == [409] * 7
        final = client.get(f"{INTERVIEWS}/{i['id']}").json()
        assert final["title"] == i["title"] and final["status"] == {"cancel": "cancelled", "complete": "completed", "reschedule": "rescheduled"}[end]

    def test_a_completed_interview_can_never_go_back_to_scheduled(self, world, session_factory):
        client, app, a, _ = world
        i = scheduled(client, app, [a])
        age(session_factory, i["id"])
        client.post(f"{INTERVIEWS}/{i['id']}/complete")
        for body in ({"status": "scheduled"}, {"status": "confirmed"}):
            assert client.patch(f"{INTERVIEWS}/{i['id']}", json=body).status_code == 422
        assert client.get(f"{INTERVIEWS}/{i['id']}").json()["status"] == "completed"

    def test_updating_details_and_clearing_a_link(self, world):
        client, app, a, _ = world
        i = scheduled(client, app, [a])
        res = client.patch(f"{INTERVIEWS}/{i['id']}", json={"title": "Renamed", "interview_type": "final", "meeting_url": None})
        body = res.json()
        assert res.status_code == 200 and body["title"] == "Renamed" and body["interview_type"] == "final" and body["meeting_url"] is None
        assert body["updated_by"]["email"] == client.user.email

    @pytest.mark.parametrize("body", [{"starts_at": "2030-01-01T10:00"}, {"timezone": "UTC"}, {"status": "cancelled"}, {"application_id": str(uuid.uuid4())},
                                      {"title": ""}, {"mode": "in_person"}, {"meeting_url": "https://x.example.com/?token=abc"}])
    def test_times_and_status_cannot_be_edited_directly(self, world, body):
        client, app, a, _ = world
        i = scheduled(client, app, [a])
        assert client.patch(f"{INTERVIEWS}/{i['id']}", json=body).status_code == 422
        assert client.get(f"{INTERVIEWS}/{i['id']}").json()["starts_at"] == i["starts_at"]

    def test_interviews_cannot_be_deleted(self, world):
        client, app, a, _ = world
        i = scheduled(client, app, [a])
        assert client.delete(f"{INTERVIEWS}/{i['id']}").status_code == 405
        assert client.get(f"{INTERVIEWS}/{i['id']}").status_code == 200

    def test_completing_never_moves_the_application(self, world, session_factory):
        client, app, a, _ = world
        i = scheduled(client, app, [a])
        age(session_factory, i["id"])
        client.post(f"{INTERVIEWS}/{i['id']}/complete")
        assert client.get(f"/api/v1/applications/{app['id']}").json()["stage"] == "applied"


class TestReschedule:
    def test_the_original_is_preserved_and_a_linked_new_interview_is_created(self, world):
        client, app, a, b = world
        old = scheduled(client, app, [a, b], title="Tech round", round_number=2)
        res = client.post(f"{INTERVIEWS}/{old['id']}/reschedule", json={**slot(5, 15), "reason": "Candidate asked"})
        assert res.status_code == 201
        new = res.json()
        assert new["id"] != old["id"] and new["status"] == "scheduled" and new["rescheduled_from_id"] == old["id"]
        assert (new["title"], new["round_number"], new["interview_type"]) == ("Tech round", 2, "technical")
        assert {x["email"] for x in new["interviewers"]} == {a.email, b.email}
        assert new["starts_local"].endswith("T15:00")
        original = client.get(f"{INTERVIEWS}/{old['id']}").json()
        assert original["status"] == "rescheduled" and original["rescheduled_to_id"] == new["id"]
        assert original["starts_at"] == old["starts_at"] and original["ends_at"] == old["ends_at"]  # history intact

    def test_the_history_records_both_sides(self, world):
        client, app, a, _ = world
        old = scheduled(client, app, [a])
        new = client.post(f"{INTERVIEWS}/{old['id']}/reschedule", json=slot(5, 15)).json()
        h_old = client.get(f"{INTERVIEWS}/{old['id']}/history").json()
        h_new = client.get(f"{INTERVIEWS}/{new['id']}/history").json()
        assert [e["event_type"] for e in h_old] == ["created", "rescheduled"]
        assert h_old[1]["details"]["new_interview"] == new["id"] and "from_starts_at" in h_old[1]["details"]
        assert [e["event_type"] for e in h_new] == ["created"] and h_new[0]["details"]["rescheduled_from"] == old["id"]
        assert h_old[1]["actor"]["email"] == client.user.email

    def test_an_interview_can_only_be_rescheduled_once_but_its_replacement_can_move_on(self, world):
        client, app, a, _ = world
        old = scheduled(client, app, [a])
        new = client.post(f"{INTERVIEWS}/{old['id']}/reschedule", json=slot(5, 15)).json()
        assert client.post(f"{INTERVIEWS}/{old['id']}/reschedule", json=slot(6, 15)).status_code == 409
        again = client.post(f"{INTERVIEWS}/{new['id']}/reschedule", json=slot(6, 15))
        assert again.status_code == 201 and again.json()["rescheduled_from_id"] == new["id"]

    def test_the_time_zone_and_the_interviewers_can_change(self, world):
        client, app, a, b = world
        old = scheduled(client, app, [a])
        s = slot(5, 9, tz="America/New_York")
        res = client.post(f"{INTERVIEWS}/{old['id']}/reschedule", json={**s, "interviewer_ids": [str(b.id)]})
        new = res.json()
        assert res.status_code == 201 and new["timezone"] == "America/New_York" and [x["email"] for x in new["interviewers"]] == [b.email]
        assert new["starts_local"].endswith("T09:00")

    @pytest.mark.parametrize("over", [{"starts_at": "x"}, {"timezone": "Nope/Nope"}, {"reason": "x" * 301}, {"interviewer_ids": []}, {"status": "scheduled"}])
    def test_invalid_reschedules_are_refused(self, world, over):
        client, app, a, _ = world
        old = scheduled(client, app, [a])
        assert client.post(f"{INTERVIEWS}/{old['id']}/reschedule", json={**slot(5, 10), **over}).status_code == 422
        assert client.get(f"{INTERVIEWS}/{old['id']}").json()["status"] == "scheduled"

    def test_moving_to_the_same_time_or_the_past_is_refused(self, world):
        client, app, a, _ = world
        old = scheduled(client, app, [a])
        assert client.post(f"{INTERVIEWS}/{old['id']}/reschedule", json=slot(3, 10)).status_code == 422
        assert client.post(f"{INTERVIEWS}/{old['id']}/reschedule", json=slot(-3, 10)).status_code == 422

    def test_it_never_changes_the_application(self, world):
        client, app, a, _ = world
        old = scheduled(client, app, [a])
        client.post(f"{INTERVIEWS}/{old['id']}/reschedule", json=slot(5, 15))
        client.post(f"{INTERVIEWS}/{old['id']}/cancel", json={"reason": "x"})
        assert client.get(f"/api/v1/applications/{app['id']}").json()["stage"] == "applied"


class TestInterviewers:
    def test_add_and_remove(self, world, make_user):
        client, app, a, b = world
        i = scheduled(client, app, [a])
        added = client.post(f"{INTERVIEWS}/{i['id']}/interviewers", json={"user_id": str(b.id)})
        assert added.status_code == 201 and {x["email"] for x in added.json()["interviewers"]} == {a.email, b.email}
        removed = client.delete(f"{INTERVIEWS}/{i['id']}/interviewers/{a.id}")
        assert removed.status_code == 200 and [x["email"] for x in removed.json()["interviewers"]] == [b.email]

    def test_the_same_person_cannot_be_added_twice(self, world):
        client, app, a, _ = world
        i = scheduled(client, app, [a])
        res = client.post(f"{INTERVIEWS}/{i['id']}/interviewers", json={"user_id": str(a.id)})
        assert res.status_code == 409 and "already an interviewer" in res.json()["detail"]

    def test_the_last_interviewer_cannot_be_removed(self, world):
        client, app, a, _ = world
        i = scheduled(client, app, [a])
        assert client.delete(f"{INTERVIEWS}/{i['id']}/interviewers/{a.id}").status_code == 422

    def test_removing_someone_who_is_not_on_it_is_a_404(self, world):
        client, app, a, b = world
        i = scheduled(client, app, [a, b])
        assert client.delete(f"{INTERVIEWS}/{i['id']}/interviewers/{uuid.uuid4()}").status_code == 404

    def test_only_active_staff_can_be_added(self, world, make_user):
        client, app, a, _ = world
        i = scheduled(client, app, [a])
        for bad in (make_user(UserRole.EMPLOYEE, employee_id=None).id, make_user(UserRole.RECRUITER, is_active=False).id, uuid.uuid4()):
            assert client.post(f"{INTERVIEWS}/{i['id']}/interviewers", json={"user_id": str(bad)}).status_code == 422

    def test_at_most_ten(self, world, make_user):
        client, app, a, _ = world
        i = scheduled(client, app, [a])
        for _ in range(9):
            assert client.post(f"{INTERVIEWS}/{i['id']}/interviewers", json={"user_id": str(make_user(UserRole.RECRUITER).id)}).status_code == 201
        assert client.post(f"{INTERVIEWS}/{i['id']}/interviewers", json={"user_id": str(make_user(UserRole.RECRUITER).id)}).status_code == 422

    def test_changes_are_in_the_history(self, world):
        client, app, a, b = world
        i = scheduled(client, app, [a])
        client.post(f"{INTERVIEWS}/{i['id']}/interviewers", json={"user_id": str(b.id)})
        client.delete(f"{INTERVIEWS}/{i['id']}/interviewers/{a.id}")
        assert [e["event_type"] for e in client.get(f"{INTERVIEWS}/{i['id']}/history").json()] == ["created", "interviewer_added", "interviewer_removed"]

    def test_the_assignable_list_is_active_staff_only(self, world, make_user):
        client, app, a, _ = world
        make_user(UserRole.EMPLOYEE, employee_id=None)
        make_user(UserRole.RECRUITER, is_active=False)
        people = client.get(f"{INTERVIEWS}/interviewers").json()
        assert {p["role"] for p in people} <= {"admin", "hr_manager", "recruiter"} and a.email in {p["email"] for p in people}
        assert all(set(p) == {"id", "email", "role"} for p in people)  # no hashes, no flags


class TestListing:
    @pytest.fixture
    def many(self, client, make_user):
        a, b = make_user(UserRole.RECRUITER), make_user(UserRole.HR_MANAGER)
        apps = [new_application(client, n) for n in range(1, 5)]
        made = [
            scheduled(client, apps[0], [a], day=3, hour=9, title="Alpha screen", interview_type="phone_screen"),
            scheduled(client, apps[1], [a, b], day=4, hour=9, title="Bravo technical", interview_type="technical"),
            scheduled(client, apps[2], [b], day=5, hour=9, title="Charlie final", interview_type="final"),
            scheduled(client, apps[3], [b], day=6, hour=9, title="Delta panel", interview_type="panel"),
        ]
        client.post(f"{INTERVIEWS}/{made[3]['id']}/cancel", json={"reason": "x"})
        return client, apps, made, a, b

    def titles(self, res):
        assert res.status_code == 200, res.text
        return [i["title"] for i in res.json()["items"]]

    def test_default_order_is_by_start_time(self, many):
        client, *_ = many
        assert self.titles(client.get(INTERVIEWS)) == ["Alpha screen", "Bravo technical", "Charlie final", "Delta panel"]
        assert self.titles(client.get(INTERVIEWS, params={"order": "desc"})) == ["Delta panel", "Charlie final", "Bravo technical", "Alpha screen"]

    def test_filters(self, many):
        client, apps, made, a, b = many
        assert self.titles(client.get(INTERVIEWS, params={"status": "cancelled"})) == ["Delta panel"]
        assert self.titles(client.get(INTERVIEWS, params={"interview_type": "final"})) == ["Charlie final"]
        assert self.titles(client.get(INTERVIEWS, params={"application_id": apps[1]["id"]})) == ["Bravo technical"]
        assert self.titles(client.get(INTERVIEWS, params={"job_id": apps[2]["job"]["id"]})) == ["Charlie final"]
        assert self.titles(client.get(INTERVIEWS, params={"interviewer_id": str(a.id)})) == ["Alpha screen", "Bravo technical"]
        assert self.titles(client.get(INTERVIEWS, params={"interviewer_id": str(b.id), "status": "scheduled"})) == ["Bravo technical", "Charlie final"]
        assert self.titles(client.get(INTERVIEWS, params={"interviewer_id": "me"})) == []  # the admin is on none

    def test_the_date_range_is_half_open(self, many):
        client, apps, made, *_ = many
        lo, hi = made[1]["starts_at"], made[2]["starts_at"]
        assert self.titles(client.get(INTERVIEWS, params={"starts_from": lo, "starts_to": hi})) == ["Bravo technical"]
        assert self.titles(client.get(INTERVIEWS, params={"starts_from": lo})) == ["Bravo technical", "Charlie final", "Delta panel"]
        assert self.titles(client.get(INTERVIEWS, params={"starts_to": lo})) == ["Alpha screen"]

    def test_search_matches_the_interview_the_candidate_and_the_job(self, many):
        client, apps, made, *_ = many
        assert self.titles(client.get(INTERVIEWS, params={"q": "charlie"})) == ["Charlie final"]
        assert self.titles(client.get(INTERVIEWS, params={"q": apps[0]["candidate"]["last_name"]})) == ["Alpha screen"]
        assert self.titles(client.get(INTERVIEWS, params={"q": apps[3]["job"]["title"]})) == ["Delta panel"]
        assert self.titles(client.get(INTERVIEWS, params={"q": "no such thing"})) == []
        assert self.titles(client.get(INTERVIEWS, params={"q": "100%"})) == []  # wildcards are not special

    def test_paging(self, many):
        client, *_ = many
        first = client.get(INTERVIEWS, params={"page_size": 3}).json()
        second = client.get(INTERVIEWS, params={"page_size": 3, "page": 2}).json()
        assert (first["total"], len(first["items"]), len(second["items"])) == (4, 3, 1)
        assert {i["id"] for i in first["items"]}.isdisjoint({i["id"] for i in second["items"]})
        for bad in ({"page": 0}, {"page_size": 0}, {"page_size": 101}):
            assert client.get(INTERVIEWS, params=bad).status_code == 422

    def test_there_is_no_way_to_sort_or_filter_by_a_score(self, many):
        client, *_ = many
        base = self.titles(client.get(INTERVIEWS))
        for params in ({"sort": "score"}, {"order_by": "rating"}, {"min_rating": 4}, {"sort_by": "overall_rating"}):
            assert self.titles(client.get(INTERVIEWS, params=params)) == base
        assert client.get(INTERVIEWS, params={"order": "rating"}).status_code == 422

    def test_bad_filter_values_are_422_or_404_never_500(self, many):
        client, *_ = many
        for params in ({"status": "nope"}, {"interview_type": "nope"}, {"starts_from": "yesterday"}, {"application_id": "x"}):
            assert client.get(INTERVIEWS, params=params).status_code == 422
        assert client.get(INTERVIEWS, params={"interviewer_id": "not-a-user"}).status_code == 404

    def test_the_interviews_of_one_application(self, many):
        client, apps, *_ = many
        res = client.get(f"/api/v1/applications/{apps[0]['id']}/interviews")
        assert res.status_code == 200 and [i["title"] for i in res.json()["items"]] == ["Alpha screen"]
        assert client.get(f"/api/v1/applications/{uuid.uuid4()}/interviews").status_code == 404

    def test_my_interviews_means_the_signed_in_interviewer(self, many, client_as, make_user):
        client, apps, made, a, b = many
        me = client_as(UserRole.RECRUITER)
        mine = scheduled(client, new_application(client, 7), [me.user], day=8, hour=9, title="Echo mine")
        assert self.titles(me.get(INTERVIEWS, params={"interviewer_id": "me"})) == ["Echo mine"]
        assert mine["interviewers"][0]["email"] == me.user.email


class TestStats:
    def test_counts_are_real(self, world, session_factory, make_user):
        client, app, a, b = world
        empty = client.get(f"{INTERVIEWS}/stats").json()
        assert empty["total"] == 0 and empty["upcoming"] == 0 and empty["upcoming_by_day"] == []
        i1 = scheduled(client, app, [a], day=2, hour=9)
        i2 = scheduled(client, new_application(client, 2), [b], day=3, hour=9)
        i3 = scheduled(client, new_application(client, 3), [a], day=20, hour=9)
        i4 = scheduled(client, new_application(client, 4), [a], day=5, hour=9)
        client.post(f"{INTERVIEWS}/{i4['id']}/cancel", json={"reason": "x"})
        client.post(f"{INTERVIEWS}/{i2['id']}/confirm")
        client.post(f"{INTERVIEWS}/{i1['id']}/reschedule", json=slot(6, 9))
        stats = client.get(f"{INTERVIEWS}/stats").json()
        assert stats["by_status"] == {"scheduled": 2, "confirmed": 1, "completed": 0, "cancelled": 1, "rescheduled": 1}
        # open future interviews: the moved one (day 6), the confirmed one (day 3) and i3 (day 20)
        assert stats["total"] == 5 and stats["upcoming"] == 3 and stats["next_7_days"] == 2
        assert sum(d["count"] for d in stats["upcoming_by_day"]) == 2  # i3 is beyond 14 days
        assert stats["feedback_pending"] == 0 and stats["feedback_submitted"] == 0
        assert i3["id"]

    def test_feedback_pending_counts_interviewers_who_have_not_submitted(self, world, session_factory, client_as):
        client, app, a, b = world
        i = scheduled(client, app, [a, b])
        age(session_factory, i["id"])
        assert client.get(f"{INTERVIEWS}/stats").json()["feedback_pending"] == 2
        assert client.post(f"{INTERVIEWS}/{i['id']}/complete").status_code == 200
        assert client.get(f"{INTERVIEWS}/stats").json()["feedback_pending"] == 2


class TestTimezones:
    def test_the_same_instant_is_shown_in_each_interviews_own_zone(self, world):
        client, app, a, b = world
        s = slot(3, 10, tz="UTC")
        in_london = scheduled(client, app, [a], **{"starts_at": s["starts_at"], "ends_at": s["ends_at"], "timezone": "Europe/London"})
        assert in_london["starts_local"].endswith("T10:00") and in_london["timezone"] == "Europe/London"
        karachi = scheduled(client, new_application(client, 2), [b], day=3, hour=15)  # 15:00 Karachi
        assert karachi["starts_local"].endswith("T15:00") and karachi["utc_offset"] == "+05:00"
        assert in_london["starts_at"] == karachi["starts_at"]  # one instant, written in two zones

    def test_dst_does_not_move_a_stored_interview(self, world):
        """09:00 in London on both sides of a clock change is a different instant, never the same one."""
        client, app, a, b = world
        winter = client.post(INTERVIEWS, json=payload(app, [a], starts_at="2035-03-20T09:00", ends_at="2035-03-20T10:00", timezone="Europe/London")).json()
        summer = client.post(INTERVIEWS, json=payload(new_application(client, 2), [b], starts_at="2035-04-20T09:00", ends_at="2035-04-20T10:00", timezone="Europe/London")).json()
        assert winter["utc_offset"] == "+00:00" and summer["utc_offset"] == "+01:00"
        assert winter["starts_at"].startswith("2035-03-20T09:00") and summer["starts_at"].startswith("2035-04-20T08:00")
        assert winter["starts_local"].endswith("T09:00") and summer["starts_local"].endswith("T09:00")

    def test_timestamps_are_always_timezone_aware_utc(self, world):
        client, app, a, _ = world
        i = scheduled(client, app, [a])
        for field in ("starts_at", "ends_at", "created_at", "updated_at"):
            assert i[field].endswith("Z") or i[field].endswith("+00:00"), field


def test_the_history_is_append_only_in_the_data_layer(world, session_factory):
    from app.models.interview import HistoryIsAppendOnly

    client, app, a, _ = world
    scheduled(client, app, [a])
    with session_factory() as db:
        event = db.scalar(select(InterviewEvent))
        event.details = {"tampered": True}
        with pytest.raises(HistoryIsAppendOnly):
            db.flush()
        db.rollback()
        db.delete(db.scalar(select(InterviewEvent)))
        with pytest.raises(HistoryIsAppendOnly):
            db.flush()
        db.rollback()


def test_new_application_helpers_are_the_ones_the_other_suites_use(client):
    cand, job = make_candidate(client, 9), open_job(client, 9)
    assert apply(client, cand, job).status_code == 201
