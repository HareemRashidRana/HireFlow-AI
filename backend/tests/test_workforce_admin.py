"""HR corrections and their audit trail, configuration, IDOR/RBAC, the dashboard feed and the
migration's consistency with the models."""

import re
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models.user import UserRole
from app.models.workforce import AttendanceCorrection, HistoryIsAppendOnly
from app.services import leave as leave_service
from tests.workforce_helpers import ATT, LV, grant, submit

pytestmark = pytest.mark.usefixtures("wclock")
SETTINGS = "/api/v1/work-settings"
HOLIDAYS = "/api/v1/holidays"


@pytest.fixture
def hr(person):
    return person(UserRole.HR_MANAGER, "Hana")


@pytest.fixture
def emp(person):
    return person(UserRole.EMPLOYEE, "Sana")


def day(who, hour_in, hour_out, wclock, d="2026-03-02"):
    wclock.set(f"{d}T{hour_in}:00Z")
    rec = who.client.post(f"{ATT}/check-in").json()
    wclock.set(f"{d}T{hour_out}:00Z")
    who.client.post(f"{ATT}/check-out")
    return rec["id"]


class TestHrCorrections:
    def test_hr_adds_a_missing_day_with_a_reason_and_it_is_audited(self, hr, emp, wclock):
        wclock.set("2026-03-04T12:00:00Z")
        body = {"employee_id": emp.id, "work_date": "2026-03-03", "check_in_at": "2026-03-03T09:30:00+00:00",
                "check_out_at": "2026-03-03T17:00:00+00:00", "reason": "Forgot to check in; confirmed by manager"}  # fmt: skip
        res = hr.client.post(f"{ATT}/records", json=body)
        assert res.status_code == 201
        rec = res.json()
        assert rec["source"] == "hr" and rec["corrected"] is True and rec["is_late"] is True
        assert rec["worked_minutes"] == 450
        log = hr.client.get(f"{ATT}/records/{rec['id']}/corrections").json()
        assert len(log) == 1 and log[0]["kind"] == "created" and log[0]["before"] is None
        assert log[0]["actor"]["email"] == hr.user.email and "manager" in log[0]["reason"]
        assert log[0]["after"]["worked_minutes"] == 450

    def test_a_correction_records_exactly_what_changed_and_why(self, hr, emp, wclock):
        rid = day(emp, "10:00", "15:00", wclock)  # late and early
        wclock.set("2026-03-03T09:00:00Z")
        res = hr.client.patch(f"{ATT}/records/{rid}", json={"check_in_at": "2026-03-02T08:45:00+00:00",
                                                           "check_out_at": "2026-03-02T17:15:00+00:00",
                                                           "reason": "Kiosk was down"})  # fmt: skip
        rec = res.json()
        assert rec["is_late"] is False and rec["left_early"] is False and rec["corrected"] is True
        assert rec["worked_minutes"] == 510 and rec["source"] == "self"  # the origin is kept
        entry = hr.client.get(f"{ATT}/records/{rid}/corrections").json()[0]
        assert entry["kind"] == "updated" and entry["reason"] == "Kiosk was down"
        assert entry["before"]["worked_minutes"] == 300 and entry["before"]["is_late"] is True
        assert entry["after"]["worked_minutes"] == 510 and entry["actor"]["email"] == hr.user.email

    def test_each_correction_adds_an_entry_in_order(self, hr, emp, wclock):
        rid = day(emp, "09:00", "16:00", wclock)
        wclock.set("2026-03-03T09:00:00Z")
        hr.client.patch(f"{ATT}/records/{rid}", json={"check_out_at": "2026-03-02T16:30:00+00:00", "reason": "one"})
        wclock.advance(minutes=1)
        hr.client.patch(f"{ATT}/records/{rid}", json={"check_out_at": "2026-03-02T17:00:00+00:00", "reason": "two"})
        log = hr.client.get(f"{ATT}/records/{rid}/corrections").json()
        assert [e["reason"] for e in log] == ["one", "two"]
        assert log[1]["before"]["worked_minutes"] == 450

    def test_hr_can_close_an_open_check_in_that_is_too_old_for_self_service(self, hr, emp, wclock):
        wclock.set("2026-03-02T09:00:00Z")
        rid = emp.client.post(f"{ATT}/check-in").json()["id"]
        wclock.set("2026-03-04T09:00:00Z")
        assert emp.client.post(f"{ATT}/check-out").status_code == 409
        fixed = hr.client.patch(f"{ATT}/records/{rid}", json={"check_out_at": "2026-03-02T17:00:00+00:00",
                                                              "reason": "Employee forgot to check out"})  # fmt: skip
        assert fixed.status_code == 200 and fixed.json()["state"] == "closed"
        wclock.set("2026-03-04T09:05:00Z")
        assert emp.client.post(f"{ATT}/check-in").status_code == 201

    @pytest.mark.parametrize(
        ("patch", "needle"),
        [
            ({"check_out_at": "2026-03-02T08:00:00+00:00"}, "after the check-in"),  # before check-in
            ({"check_in_at": "2026-03-03T09:00:00+00:00"}, "stay on the record"),  # moves to another day
            ({"check_out_at": "2026-03-09T09:00:00+00:00"}, "future"),
        ],
    )
    def test_impossible_corrections_are_refused(self, hr, emp, wclock, patch, needle):
        rid = day(emp, "09:00", "16:00", wclock)
        wclock.set("2026-03-03T09:00:00Z")
        res = hr.client.patch(f"{ATT}/records/{rid}", json={**patch, "reason": "test"})
        assert res.status_code == 422 and needle in res.json()["detail"]
        assert hr.client.get(f"{ATT}/records/{rid}/corrections").json() == []  # nothing was logged

    def test_a_reason_is_required_and_a_naive_time_is_refused(self, hr, emp, wclock):
        rid = day(emp, "09:00", "16:00", wclock)
        wclock.set("2026-03-03T09:00:00Z")
        good = {"check_out_at": "2026-03-02T17:00:00+00:00"}
        assert hr.client.patch(f"{ATT}/records/{rid}", json=good).status_code == 422
        assert hr.client.patch(f"{ATT}/records/{rid}", json={**good, "reason": "   "}).status_code == 422
        naive = {"check_out_at": "2026-03-02T17:00:00", "reason": "x"}
        assert hr.client.patch(f"{ATT}/records/{rid}", json=naive).status_code == 422
        assert hr.client.patch(f"{ATT}/records/{rid}", json={"reason": "nothing to change"}).status_code == 422
        assert hr.client.patch(f"{ATT}/records/{rid}", json={**good, "reason": "x", "worked_minutes": 1}).status_code == 422

    def test_creating_a_second_record_for_a_day_or_a_future_day_is_refused(self, hr, emp, wclock):
        day(emp, "09:00", "16:00", wclock)
        wclock.set("2026-03-03T09:00:00Z")
        base = {"employee_id": emp.id, "check_in_at": "2026-03-02T09:00:00+00:00", "reason": "dup"}
        assert hr.client.post(f"{ATT}/records", json={**base, "work_date": "2026-03-02"}).status_code == 409
        future = {**base, "work_date": "2026-03-10", "check_in_at": "2026-03-10T09:00:00+00:00"}
        assert hr.client.post(f"{ATT}/records", json=future).status_code == 422
        wrong_day = {**base, "work_date": "2026-03-01", "check_in_at": "2026-03-02T09:00:00+00:00"}
        assert hr.client.post(f"{ATT}/records", json=wrong_day).status_code == 422
        unknown = {**base, "work_date": "2026-03-01", "employee_id": "00000000-0000-0000-0000-000000000000"}
        assert hr.client.post(f"{ATT}/records", json=unknown).status_code == 404

    def test_the_audit_trail_cannot_be_changed(self, hr, emp, wclock, session_factory):
        rid = day(emp, "09:00", "16:00", wclock)
        wclock.set("2026-03-03T09:00:00Z")
        hr.client.patch(f"{ATT}/records/{rid}", json={"check_out_at": "2026-03-02T17:00:00+00:00", "reason": "r"})
        with session_factory() as db:
            entry = db.scalars(select(AttendanceCorrection)).first()
            entry.reason = "rewritten"
            with pytest.raises(HistoryIsAppendOnly):
                db.commit()


class TestRbacAndIdor:
    def test_employees_and_recruiters_cannot_correct_or_read_corrections(self, emp, person, hr, wclock):
        rid = day(emp, "09:00", "16:00", wclock)
        body = {"check_out_at": "2026-03-02T17:00:00+00:00", "reason": "self-serving"}
        for who in (emp, person(UserRole.RECRUITER, "Rex")):
            assert who.client.patch(f"{ATT}/records/{rid}", json=body).status_code == 403
            assert who.client.get(f"{ATT}/records/{rid}/corrections").status_code == 403
            add = {"employee_id": who.id, "work_date": "2026-03-02", "check_in_at": "2026-03-02T09:00:00+00:00", "reason": "x"}
            assert who.client.post(f"{ATT}/records", json=add).status_code == 403
        assert hr.client.get(f"{ATT}/records/{rid}").status_code == 405  # there is no single-record read route

    def test_there_is_no_way_for_an_employee_to_edit_or_delete_attendance(self, emp, wclock):
        rid = day(emp, "09:00", "16:00", wclock)
        for verb in (emp.client.put, emp.client.patch, emp.client.delete):
            assert verb(f"{ATT}/records/{rid}").status_code in (403, 405)
        assert emp.client.get(f"{ATT}/me/records").json()["items"][0]["worked_minutes"] == 420

    def test_the_employee_is_always_taken_from_the_login_never_the_request(self, emp, person, wclock):
        other = person(UserRole.EMPLOYEE, "Other")
        day(other, "09:00", "16:00", wclock)
        res = emp.client.get(f"{ATT}/me/records", params={"employee_id": other.id})
        assert res.status_code == 200 and res.json()["total"] == 0  # the parameter is ignored
        assert emp.client.get(f"{ATT}/records", params={"employee_id": other.id}).status_code == 403

    def test_employees_cannot_read_other_peoples_leave(self, emp, person, types, session_factory):
        victim = person(UserRole.EMPLOYEE, "Victim")
        grant(session_factory, victim.employee_id, types["annual"], 5)
        made = submit(victim, types["annual"], "2026-03-09").json()
        for path in (f"/requests/{made['id']}", f"/requests/{made['id']}/history"):
            assert emp.client.get(LV + path).status_code == 404  # not 403: ids cannot be probed
        assert emp.client.get(f"{LV}/requests").status_code == 403
        assert emp.client.get(f"{LV}/balances", params={"employee_id": victim.id}).status_code == 403
        assert emp.client.post(f"{LV}/requests/{made['id']}/cancel", json={}).status_code == 404
        assert emp.client.get(f"{LV}/requests/me").json()["total"] == 0

    def test_a_recruiter_has_only_self_service(self, person, types, session_factory):
        rec = person(UserRole.RECRUITER, "Rex")
        grant(session_factory, rec.employee_id, types["annual"], 5)
        assert submit(rec, types["annual"], "2026-03-09").status_code == 201
        assert rec.client.get(f"{LV}/requests").status_code == 403
        assert rec.client.get(f"{LV}/stats").status_code == 403
        assert rec.client.get(f"{ATT}/records").status_code == 403
        assert rec.client.post(f"{LV}/balances/allocate", json={"year": 2026}).status_code == 403
        assert rec.client.put(SETTINGS, json={}).status_code == 403

    def test_signed_out_is_401_everywhere(self, new_client, types):
        c = new_client()
        for call in (
            lambda: c.get(f"{ATT}/me/today"), lambda: c.post(f"{ATT}/check-in"), lambda: c.get(f"{LV}/types"),
            lambda: c.post(f"{LV}/requests", json={}), lambda: c.get(SETTINGS), lambda: c.get(f"{HOLIDAYS}?year=2026"),
            lambda: c.get("/api/v1/analytics/workforce"),
        ):  # fmt: skip
            assert call().status_code == 401

    def test_approval_takes_the_employee_lock_before_it_decides(self, emp, hr, types, session_factory, monkeypatch):
        """On PostgreSQL the row lock is what serialises two simultaneous approvals. SQLite cannot run
        that race, so this proves the order (lock, then re-read the status, then write); the real race
        is exercised on PostgreSQL in the deployment rehearsal."""
        grant(session_factory, emp.employee_id, types["annual"], 5)
        made = submit(emp, types["annual"], "2026-03-09").json()
        order: list[str] = []
        real_lock, real_load = leave_service.lock_employee, leave_service._load

        def spy_lock(db, employee_id):
            order.append("lock")
            return real_lock(db, employee_id)

        def spy_load(db, request_id, *, fresh=False):
            order.append("fresh-read" if fresh else "read")
            return real_load(db, request_id, fresh=fresh)

        monkeypatch.setattr(leave_service, "lock_employee", spy_lock)
        monkeypatch.setattr(leave_service, "_load", spy_load)
        assert hr.client.post(f"{LV}/requests/{made['id']}/approve").status_code == 200
        assert order[:3] == ["read", "lock", "fresh-read"]

    def test_two_decisions_on_one_request_leave_one_deduction(self, emp, hr, person, types, session_factory):
        grant(session_factory, emp.employee_id, types["annual"], 5)
        made = submit(emp, types["annual"], "2026-03-09", "2026-03-10").json()
        other_hr = person(UserRole.ADMIN, "Boss")
        codes = [c.client.post(f"{LV}/requests/{made['id']}/approve").status_code for c in (hr, other_hr)]
        assert sorted(codes) == [200, 409]
        row = next(r for r in emp.client.get(f"{LV}/balances/me", params={"year": 2026}).json()["balances"] if r["leave_type"]["code"] == "annual")
        assert row["used"] == 2


class TestConfiguration:
    VALID = {"timezone": "Asia/Karachi", "work_days": [0, 1, 2, 3, 4], "work_start": "09:00", "work_end": "18:00",
             "grace_minutes": 15, "max_backdate_days": 14}  # fmt: skip

    def test_defaults_exist_and_everyone_can_read_them(self, emp):
        s = emp.client.get(SETTINGS).json()
        assert s["timezone"] == "UTC" and s["work_days"] == [0, 1, 2, 3, 4]
        assert s["work_start"] == "09:00:00" and s["work_end"] == "17:00:00" and s["grace_minutes"] == 10

    def test_hr_updates_them_and_the_change_is_visible(self, hr, emp):
        assert hr.client.put(SETTINGS, json=self.VALID).status_code == 200
        s = emp.client.get(SETTINGS).json()
        assert (s["timezone"], s["work_end"], s["grace_minutes"], s["max_backdate_days"]) == ("Asia/Karachi", "18:00:00", 15, 14)

    @pytest.mark.parametrize(
        "change",
        [
            {"timezone": "Mars/Base"}, {"work_days": []}, {"work_days": [0, 0]}, {"work_days": [7]},
            {"work_days": [-1, 2]}, {"work_end": "09:00"}, {"work_end": "08:00"}, {"grace_minutes": -1},
            {"grace_minutes": 241}, {"max_backdate_days": 367}, {"timezone": ""}, {"extra": 1},
        ],
    )  # fmt: skip
    def test_bad_settings_are_refused(self, hr, change):
        assert hr.client.put(SETTINGS, json={**self.VALID, **change}).status_code == 422

    def test_only_hr_can_change_them(self, emp, person):
        for who in (emp, person(UserRole.RECRUITER, "Rex")):
            assert who.client.put(SETTINGS, json=self.VALID).status_code == 403

    def test_holidays(self, hr, emp):
        made = hr.client.post(HOLIDAYS, json={"day": "2026-03-23", "name": "  Pakistan Day "})
        assert made.status_code == 201 and made.json()["name"] == "Pakistan Day"
        assert hr.client.post(HOLIDAYS, json={"day": "2026-03-23", "name": "Again"}).status_code == 409
        assert [h["day"] for h in emp.client.get(HOLIDAYS, params={"year": 2026}).json()] == ["2026-03-23"]
        assert emp.client.get(HOLIDAYS, params={"year": 2027}).json() == []
        assert hr.client.delete(f"{HOLIDAYS}/{made.json()['id']}").status_code == 204
        assert hr.client.delete(f"{HOLIDAYS}/{made.json()['id']}").status_code == 404
        assert emp.client.get(HOLIDAYS, params={"year": 2026}).json() == []

    @pytest.mark.parametrize("body", [{"day": "2026-03-23"}, {"day": "nope", "name": "x"}, {"day": "2026-03-23", "name": " "},
                                      {"day": "2026-03-23", "name": "x" * 101}])  # fmt: skip
    def test_bad_holidays_are_refused(self, hr, body):
        assert hr.client.post(HOLIDAYS, json=body).status_code == 422

    def test_employees_cannot_manage_holidays_and_the_year_is_required(self, emp, hr):
        assert emp.client.post(HOLIDAYS, json={"day": "2026-03-23", "name": "Mine"}).status_code == 403
        made = hr.client.post(HOLIDAYS, json={"day": "2026-03-23", "name": "Real"}).json()
        assert emp.client.delete(f"{HOLIDAYS}/{made['id']}").status_code == 403
        assert emp.client.get(HOLIDAYS).status_code == 422


class TestDashboardFeed:
    def test_overview_numbers(self, person, hr, types, session_factory, wclock):
        a, b, c = (person(UserRole.EMPLOYEE, n) for n in ("A", "B", "C"))
        grant(session_factory, c.employee_id, types["annual"], 5)
        wclock.set("2026-03-02T08:00:00Z")
        pending = submit(a, types["unpaid"], "2026-03-10").json()
        away = submit(c, types["annual"], "2026-03-02").json()
        hr.client.post(f"{LV}/requests/{away['id']}/approve")
        wclock.set("2026-03-02T08:30:00Z")
        a.client.post(f"{ATT}/check-in")
        wclock.set("2026-03-02T09:45:00Z")
        b.client.post(f"{ATT}/check-in")
        s = hr.client.get("/api/v1/analytics/workforce").json()
        assert s["date"] == "2026-03-02" and s["is_working_day"] is True and s["timezone"] == "UTC"
        assert (s["expected"], s["present"], s["late"], s["on_leave"], s["not_checked_in"]) == (4, 2, 1, 1, 1)
        assert s["pending_leave_requests"] == 1 and pending["status"] == "pending"
        assert s["attendance_rate"] is None  # the 2nd is the first day of the month: nothing has finished yet
        assert [p["month"] for p in s["leave_trend"]] == ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]
        assert s["leave_trend"][-1]["approved_days"] == 1

    def test_attendance_rate_over_finished_days_excludes_leave(self, person, hr, types, session_factory, wclock):
        a, b = person(UserRole.EMPLOYEE, "A"), person(UserRole.EMPLOYEE, "B")
        grant(session_factory, b.employee_id, types["annual"], 5)
        wclock.set("2026-03-02T08:00:00Z")
        made = submit(b, types["annual"], "2026-03-03").json()
        hr.client.post(f"{LV}/requests/{made['id']}/approve")
        for d in ("02", "03"):  # A attends Monday and Tuesday; B attends Monday only (leave on Tuesday)
            wclock.set(f"2026-03-{d}T09:00:00Z")
            a.client.post(f"{ATT}/check-in")
            wclock.set(f"2026-03-{d}T17:00:00Z")
            a.client.post(f"{ATT}/check-out")
        wclock.set("2026-03-02T09:00:00Z")
        b.client.post(f"{ATT}/check-in")
        wclock.set("2026-03-04T12:00:00Z")  # Wednesday: Mon and Tue are finished
        s = hr.client.get("/api/v1/analytics/workforce").json()
        # 3 active people (A, B, HR) x 2 days = 6, minus B's 1 leave day = 5 expected; attended: A 2 + B 1 = 3
        assert s["attendance_rate"] == 0.6

    def test_it_is_for_admin_and_hr_only_and_recruitment_analytics_still_work(self, emp, person, hr):
        rec = person(UserRole.RECRUITER, "Rex")
        for who in (emp, rec):
            assert who.client.get("/api/v1/analytics/workforce").status_code == 403
        assert hr.client.get("/api/v1/analytics/workforce").status_code == 200
        res = rec.client.get("/api/v1/analytics/overview")
        assert res.status_code == 200 and set(res.json()) == {
            "period", "kpis", "funnel", "trends", "interviews", "sources", "time_to_hire", "recent_activity",
        }  # fmt: skip

    def test_an_empty_company_gives_zeros(self, person):
        admin = person(UserRole.ADMIN, "Boss")
        s = admin.client.get("/api/v1/analytics/workforce").json()
        assert s["present"] == 0 and s["late"] == 0 and s["pending_leave_requests"] == 0
        assert all(p["approved_days"] == 0 for p in s["leave_trend"])


class TestMigrationMatchesModels:
    FILE = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "99db234e646c_add_attendance_and_leave.py"

    def test_it_creates_exactly_the_eight_workforce_tables(self):
        from app.db.base import Base

        created = set(re.findall(r"op\.create_table\(\s*'(\w+)'", self.FILE.read_text()))
        modelled = {
            "work_settings", "holidays", "attendance_records", "attendance_corrections",
            "leave_types", "leave_requests", "leave_events", "leave_ledger",
        }  # fmt: skip
        assert created == modelled <= set(Base.metadata.tables)

    def test_one_head_with_the_right_parent(self):
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        script = ScriptDirectory.from_config(Config(str(Path(self.FILE).parents[2] / "alembic.ini")))
        assert script.get_heads() == ["99db234e646c"]
        assert script.get_revision("99db234e646c").down_revision == "d34d0c31088c"

    def test_the_downgrade_refuses_to_delete_records(self):
        text = self.FILE.read_text()
        for table in ("attendance_records", "leave_requests", "leave_ledger", "holidays"):
            assert f"'{table}'" in text.split("def downgrade")[1].split("op.drop")[0]
        assert "Refusing to downgrade" in text


def test_an_employee_with_attendance_or_leave_history_cannot_be_deleted(person, wclock):
    admin = person(UserRole.ADMIN, "Boss")
    worker = person(UserRole.EMPLOYEE, "Worker")
    idle = person(UserRole.EMPLOYEE, "Idle")
    worker.client.post(f"{ATT}/check-in")
    res = admin.client.delete(f"/api/v1/employees/{worker.id}")
    assert res.status_code == 409 and "inactive or terminated" in res.json()["detail"]
    assert admin.client.get(f"/api/v1/employees/{worker.id}").status_code == 200  # still there, history intact
    assert worker.client.get(f"{ATT}/me/records").json()["total"] == 1
    assert admin.client.delete(f"/api/v1/employees/{idle.id}").status_code == 204  # nothing attached: deletion still works
