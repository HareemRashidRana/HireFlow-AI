"""Attendance: check-in/out rules, durations, lateness, time zones, history and summaries."""

from datetime import UTC, datetime

import pytest

from app.models.employee import EmploymentStatus
from app.models.user import UserRole
from tests.workforce_helpers import ATT, LV, request_body

pytestmark = pytest.mark.usefixtures("wclock")


@pytest.fixture
def emp(person):
    return person(UserRole.EMPLOYEE, "Sana")


class TestCheckInAndOut:
    def test_the_full_day(self, emp, wclock):
        wclock.set("2026-03-02T08:55:00Z")
        res = emp.client.post(f"{ATT}/check-in")
        assert res.status_code == 201
        body = res.json()
        assert body["state"] == "open" and body["work_date"] == "2026-03-02"
        assert body["is_late"] is False and body["source"] == "self" and body["corrected"] is False
        wclock.set("2026-03-02T17:30:00Z")
        out = emp.client.post(f"{ATT}/check-out").json()
        assert out["state"] == "closed" and out["worked_minutes"] == 515  # 8h35m
        assert out["left_early"] is False

    def test_today_status_follows_the_day(self, emp, wclock):
        wclock.set("2026-03-02T08:00:00Z")
        s = emp.client.get(f"{ATT}/me/today").json()
        assert s["state"] == "not_checked_in" and s["record"] is None and s["minutes_so_far"] == 0
        assert s["is_working_day"] is True and s["work_start"] == "09:00:00" and s["grace_minutes"] == 10
        emp.client.post(f"{ATT}/check-in")
        wclock.set("2026-03-02T10:30:00Z")
        s = emp.client.get(f"{ATT}/me/today").json()
        assert s["state"] == "checked_in" and s["minutes_so_far"] == 150
        emp.client.post(f"{ATT}/check-out")
        s = emp.client.get(f"{ATT}/me/today").json()
        assert s["state"] == "checked_out" and s["minutes_so_far"] == 150

    def test_a_second_check_in_while_open_is_refused(self, emp):
        assert emp.client.post(f"{ATT}/check-in").status_code == 201
        res = emp.client.post(f"{ATT}/check-in")
        assert res.status_code == 409 and "already checked in" in res.json()["detail"]

    def test_only_one_pair_per_day(self, emp, wclock):
        emp.client.post(f"{ATT}/check-in")
        wclock.advance(hours=4)
        emp.client.post(f"{ATT}/check-out")
        res = emp.client.post(f"{ATT}/check-in")
        assert res.status_code == 409 and "already completed" in res.json()["detail"]

    def test_check_out_without_a_check_in_is_refused(self, emp):
        res = emp.client.post(f"{ATT}/check-out")
        assert res.status_code == 409 and "not checked in" in res.json()["detail"]

    def test_check_out_twice_is_refused(self, emp, wclock):
        emp.client.post(f"{ATT}/check-in")
        wclock.advance(hours=1)
        assert emp.client.post(f"{ATT}/check-out").status_code == 200
        assert emp.client.post(f"{ATT}/check-out").status_code == 409

    def test_a_zero_length_day_is_refused_so_duration_is_never_negative(self, emp):
        emp.client.post(f"{ATT}/check-in")  # the clock has not moved
        res = emp.client.post(f"{ATT}/check-out")
        assert res.status_code == 422 and "after the check-in" in res.json()["detail"]
        assert emp.client.get(f"{ATT}/me/today").json()["state"] == "checked_in"

    def test_a_user_without_an_employee_record_cannot_check_in(self, person):
        nobody = person(UserRole.ADMIN, link=False)
        for call in (
            lambda: nobody.client.post(f"{ATT}/check-in"),
            lambda: nobody.client.get(f"{ATT}/me/today"),
            lambda: nobody.client.get(f"{ATT}/me/records"),
        ):
            res = call()
            assert res.status_code == 409 and "not linked" in res.json()["detail"]

    @pytest.mark.parametrize("status", [EmploymentStatus.INACTIVE, EmploymentStatus.TERMINATED])
    def test_inactive_employees_cannot_check_in(self, person, status):
        gone = person(UserRole.EMPLOYEE, status=status)
        assert gone.client.post(f"{ATT}/check-in").status_code == 409

    def test_any_role_with_a_linked_record_can_check_in(self, person):
        for role in (UserRole.RECRUITER, UserRole.HR_MANAGER, UserRole.ADMIN):
            assert person(role).client.post(f"{ATT}/check-in").status_code == 201

    def test_signed_out_is_401(self, new_client):
        assert new_client().post(f"{ATT}/check-in").status_code == 401


class TestLateAndEarly:
    @pytest.mark.parametrize(
        ("time", "late"),
        [("08:00", False), ("09:00", False), ("09:10:59", False), ("09:11", True), ("12:00", True)],
    )
    def test_grace_period(self, emp, wclock, time, late):
        wclock.set(f"2026-03-02T{time}:00Z" if len(time) == 5 else f"2026-03-02T{time}Z")
        assert emp.client.post(f"{ATT}/check-in").json()["is_late"] is late

    def test_leaving_before_the_end_of_the_day(self, emp, wclock):
        wclock.set("2026-03-02T09:00:00Z")
        emp.client.post(f"{ATT}/check-in")
        wclock.set("2026-03-02T16:59:00Z")
        assert emp.client.post(f"{ATT}/check-out").json()["left_early"] is True

    def test_leaving_exactly_on_time_is_not_early(self, emp, wclock):
        wclock.set("2026-03-02T09:00:00Z")
        emp.client.post(f"{ATT}/check-in")
        wclock.set("2026-03-02T17:00:00Z")
        assert emp.client.post(f"{ATT}/check-out").json()["left_early"] is False

    def test_weekends_and_holidays_are_never_late_or_early(self, person, wclock):
        admin = person(UserRole.ADMIN, "Boss")
        admin.client.post("/api/v1/holidays", json={"day": "2026-03-04", "name": "Founders day"})
        for day in ("2026-03-07", "2026-03-04"):  # a Saturday, and the holiday
            who = person(UserRole.EMPLOYEE)
            wclock.set(f"{day}T13:00:00Z")
            body = who.client.post(f"{ATT}/check-in").json()
            assert body["is_late"] is False
            wclock.set(f"{day}T14:00:00Z")
            assert who.client.post(f"{ATT}/check-out").json()["left_early"] is False

    def test_the_schedule_comes_from_settings_not_code(self, person, wclock):
        admin = person(UserRole.ADMIN, "Boss")
        body = {"timezone": "UTC", "work_days": [0, 1, 2, 3, 4], "work_start": "13:00", "work_end": "21:00",
                "grace_minutes": 0, "max_backdate_days": 30}  # fmt: skip
        assert admin.client.put("/api/v1/work-settings", json=body).status_code == 200
        who = person(UserRole.EMPLOYEE)
        wclock.set("2026-03-02T13:00:00Z")
        assert who.client.post(f"{ATT}/check-in").json()["is_late"] is False
        other = person(UserRole.EMPLOYEE)
        wclock.set("2026-03-02T13:01:00Z")
        assert other.client.post(f"{ATT}/check-in").json()["is_late"] is True


class TestTimeZones:
    @pytest.fixture(autouse=True)
    def karachi(self, person):
        admin = person(UserRole.ADMIN, "Boss")
        body = {"timezone": "Asia/Karachi", "work_days": [0, 1, 2, 3, 4], "work_start": "09:00",
                "work_end": "17:00", "grace_minutes": 10, "max_backdate_days": 30}  # fmt: skip
        assert admin.client.put("/api/v1/work-settings", json=body).status_code == 200

    def test_lateness_is_judged_in_the_company_zone(self, emp, wclock):
        wclock.set("2026-03-02T03:55:00Z")  # 08:55 in Karachi
        body = emp.client.post(f"{ATT}/check-in").json()
        assert body["is_late"] is False and body["timezone"] == "Asia/Karachi"

    def test_the_local_day_not_the_utc_day(self, emp, wclock):
        wclock.set("2026-03-01T19:30:00Z")  # 00:30 on Monday the 2nd in Karachi, still Sunday in UTC
        body = emp.client.post(f"{ATT}/check-in").json()
        assert body["work_date"] == "2026-03-02"
        assert body["is_late"] is False  # 00:30 local is before the 09:00 start

    def test_instants_are_returned_with_their_offset(self, emp, wclock):
        wclock.set("2026-03-02T04:30:00Z")
        body = emp.client.post(f"{ATT}/check-in").json()
        assert datetime.fromisoformat(body["check_in_at"]) == datetime(2026, 3, 2, 4, 30, tzinfo=UTC)

    def test_an_overnight_shift_is_one_record_on_the_day_it_started(self, emp, wclock):
        wclock.set("2026-03-02T17:00:00Z")  # 22:00 local
        emp.client.post(f"{ATT}/check-in")
        wclock.set("2026-03-02T22:00:00Z")  # 03:00 local the next day
        out = emp.client.post(f"{ATT}/check-out").json()
        assert out["work_date"] == "2026-03-02" and out["worked_minutes"] == 300


class TestStaleCheckIns:
    def test_an_open_check_in_from_yesterday_blocks_a_new_one_with_a_clear_message(self, emp, wclock):
        wclock.set("2026-03-02T09:00:00Z")
        emp.client.post(f"{ATT}/check-in")
        wclock.set("2026-03-03T09:00:00Z")
        res = emp.client.post(f"{ATT}/check-in")
        assert res.status_code == 409 and "2026-03-02" in res.json()["detail"]
        status = emp.client.get(f"{ATT}/me/today").json()
        assert status["stale_open_from"] == "2026-03-02"

    def test_a_check_in_older_than_sixteen_hours_can_only_be_closed_by_hr(self, emp, wclock):
        wclock.set("2026-03-02T09:00:00Z")
        emp.client.post(f"{ATT}/check-in")
        wclock.set("2026-03-03T01:01:00Z")
        res = emp.client.post(f"{ATT}/check-out")
        assert res.status_code == 409 and "Ask HR" in res.json()["detail"]

    def test_sixteen_hours_exactly_is_still_allowed(self, emp, wclock):
        wclock.set("2026-03-02T09:00:00Z")
        emp.client.post(f"{ATT}/check-in")
        wclock.set("2026-03-03T01:00:00Z")
        assert emp.client.post(f"{ATT}/check-out").json()["worked_minutes"] == 960


class TestHistory:
    def seed_days(self, who, wclock, days):
        for d in days:
            wclock.set(f"2026-03-{d:02d}T09:00:00Z")
            who.client.post(f"{ATT}/check-in")
            wclock.set(f"2026-03-{d:02d}T17:00:00Z")
            who.client.post(f"{ATT}/check-out")

    def test_my_records_are_mine_newest_first_and_paged(self, person, wclock):
        a, b = person(UserRole.EMPLOYEE, "Ayesha"), person(UserRole.EMPLOYEE, "Bilal")
        self.seed_days(a, wclock, [2, 3, 4, 5])
        self.seed_days(b, wclock, [2, 3])
        page = a.client.get(f"{ATT}/me/records", params={"page_size": 3}).json()
        assert page["total"] == 4 and len(page["items"]) == 3
        assert [r["work_date"] for r in page["items"]] == ["2026-03-05", "2026-03-04", "2026-03-03"]
        assert {r["employee"]["id"] for r in page["items"]} == {a.id}
        assert len(a.client.get(f"{ATT}/me/records", params={"page_size": 3, "page": 2}).json()["items"]) == 1

    def test_my_records_filter_by_date_and_lateness(self, emp, wclock):
        wclock.set("2026-03-02T10:00:00Z")
        emp.client.post(f"{ATT}/check-in")  # late
        wclock.set("2026-03-02T17:00:00Z")
        emp.client.post(f"{ATT}/check-out")
        wclock.set("2026-03-03T08:00:00Z")
        emp.client.post(f"{ATT}/check-in")  # on time
        late = emp.client.get(f"{ATT}/me/records", params={"late": True}).json()
        assert [r["work_date"] for r in late["items"]] == ["2026-03-02"]
        ranged = emp.client.get(f"{ATT}/me/records", params={"start": "2026-03-03", "end": "2026-03-03"}).json()
        assert ranged["total"] == 1

    def test_bad_paging_is_refused(self, emp):
        for params in ({"page": 0}, {"page_size": 0}, {"page_size": 101}):
            assert emp.client.get(f"{ATT}/me/records", params=params).status_code == 422


class TestSummaries:
    def test_my_monthly_summary_counts_only_finished_working_days(self, emp, wclock, person):
        # Wed 4 March: working days that are over are Mon 2 and Tue 3 (today is not counted yet).
        for d, (cin, cout) in {2: ("09:00", "17:00"), 3: ("10:00", "16:00")}.items():
            wclock.set(f"2026-03-{d:02d}T{cin}:00Z")
            emp.client.post(f"{ATT}/check-in")
            wclock.set(f"2026-03-{d:02d}T{cout}:00Z")
            emp.client.post(f"{ATT}/check-out")
        wclock.set("2026-03-04T12:00:00Z")
        s = emp.client.get(f"{ATT}/me/summary", params={"month": "2026-03"}).json()
        row = s["items"][0]
        assert s["working_days_so_far"] == 2
        assert (row["present_days"], row["late_days"], row["early_days"]) == (2, 1, 1)
        assert row["worked_minutes"] == 480 + 360
        assert (row["expected_days"], row["absent_days"], row["leave_days"]) == (2, 0, 0)

    def test_absence_is_computed_and_approved_leave_is_not_absence(self, person, wclock, types, session_factory):
        from tests.workforce_helpers import grant

        worker, sick = person(UserRole.EMPLOYEE, "Worker"), person(UserRole.EMPLOYEE, "Away")
        wclock.set("2026-03-02T09:00:00Z")
        worker.client.post(f"{ATT}/check-in")
        wclock.set("2026-03-02T17:00:00Z")
        worker.client.post(f"{ATT}/check-out")
        grant(session_factory, sick.employee_id, types["sick"], 5)
        hr = person(UserRole.HR_MANAGER, "Hr")
        wclock.set("2026-03-02T08:00:00Z")
        made = sick.client.post(f"{LV}/requests", json=request_body(types["sick"], "2026-03-03", "2026-03-03")).json()
        assert hr.client.post(f"{LV}/requests/{made['id']}/approve").status_code == 200
        wclock.set("2026-03-05T12:00:00Z")  # Thu: Mon, Tue, Wed are over
        s = hr.client.get(f"{ATT}/summary", params={"month": "2026-03", "page_size": 50}).json()
        rows = {r["employee"]["id"]: r for r in s["items"]}
        assert rows[worker.id]["absent_days"] == 2  # Tue and Wed, no record and no leave
        assert rows[sick.id]["leave_days"] == 1
        assert rows[sick.id]["absent_days"] == 2  # Mon and Wed: Tuesday was approved leave
        assert s["working_days_so_far"] == 3

    def test_summary_is_hr_only_and_validates_the_month(self, emp, person):
        assert emp.client.get(f"{ATT}/summary", params={"month": "2026-03"}).status_code == 403
        hr = person(UserRole.HR_MANAGER, "Hr")
        for bad in ("2026-13", "March", "2026-3", ""):
            assert hr.client.get(f"{ATT}/summary", params={"month": bad}).status_code == 422

    def test_a_future_month_has_no_elapsed_days(self, person):
        hr = person(UserRole.HR_MANAGER, "Hr")
        s = hr.client.get(f"{ATT}/summary", params={"month": "2026-09"}).json()
        assert s["working_days_so_far"] == 0 and s["totals"]["absent_days"] == 0


class TestStats:
    def test_the_days_numbers(self, person, wclock, types, session_factory):
        from tests.workforce_helpers import grant

        hr = person(UserRole.HR_MANAGER, "Hr")
        a, b, c, d = (person(UserRole.EMPLOYEE, n) for n in ("A", "B", "C", "D"))
        grant(session_factory, d.employee_id, types["annual"], 5)
        wclock.set("2026-03-02T08:00:00Z")
        made = d.client.post(f"{LV}/requests", json=request_body(types["annual"], "2026-03-02", "2026-03-02")).json()
        hr.client.post(f"{LV}/requests/{made['id']}/approve")
        wclock.set("2026-03-02T08:30:00Z")
        a.client.post(f"{ATT}/check-in")  # on time
        wclock.set("2026-03-02T09:30:00Z")
        b.client.post(f"{ATT}/check-in")  # late
        wclock.set("2026-03-02T12:00:00Z")
        a.client.post(f"{ATT}/check-out")
        s = hr.client.get(f"{ATT}/stats").json()
        assert s["date"] == "2026-03-02" and s["is_working_day"] is True
        assert (s["expected"], s["present"], s["late"], s["still_in"], s["checked_out"]) == (5, 2, 1, 1, 1)
        # D is on approved leave; HR and C simply have not checked in yet.
        assert (s["on_leave"], s["not_checked_in"]) == (1, 2)

    def test_a_weekend_expects_nobody(self, person):
        hr = person(UserRole.HR_MANAGER, "Hr")
        s = hr.client.get(f"{ATT}/stats", params={"date": "2026-03-07"}).json()
        assert s["is_working_day"] is False and s["expected"] == 0 and s["not_checked_in"] == 0

    def test_a_holiday_is_named(self, person):
        admin = person(UserRole.ADMIN, "Boss")
        admin.client.post("/api/v1/holidays", json={"day": "2026-03-04", "name": "Founders day"})
        s = admin.client.get(f"{ATT}/stats", params={"date": "2026-03-04"}).json()
        assert s["holiday_name"] == "Founders day" and s["expected"] == 0

    def test_stats_are_hr_only(self, emp, person):
        assert emp.client.get(f"{ATT}/stats").status_code == 403
        assert person(UserRole.RECRUITER).client.get(f"{ATT}/stats").status_code == 403
