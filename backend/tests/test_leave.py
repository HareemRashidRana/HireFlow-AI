"""Leave: working days, overlaps, balances, the approval lifecycle and the ledger."""

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.user import UserRole
from app.models.workforce import (
    HistoryIsAppendOnly,
    LeaveLedgerEntry,
    LeaveRequest,
    LedgerEntryType,
)
from tests.workforce_helpers import LV, balance, grant, request_body, submit

pytestmark = pytest.mark.usefixtures("wclock")

# "Now" is Monday 2 March 2026, 10:00 UTC. Working week Mon-Fri, no holidays unless a test adds one.


@pytest.fixture
def hr(person):
    return person(UserRole.HR_MANAGER, "Hana")


@pytest.fixture
def emp(person, types, session_factory):
    who = person(UserRole.EMPLOYEE, "Sana")
    grant(session_factory, who.employee_id, types["annual"], 10)
    grant(session_factory, who.employee_id, types["sick"], 5)
    return who


def ledger(session_factory, employee_id) -> list[LeaveLedgerEntry]:
    with session_factory() as db:
        return list(
            db.scalars(
                select(LeaveLedgerEntry)
                .where(LeaveLedgerEntry.employee_id == employee_id)
                .order_by(LeaveLedgerEntry.created_at, LeaveLedgerEntry.id)
            )
        )


class TestWorkingDays:
    @pytest.mark.parametrize(
        ("start", "end", "days"),
        [
            ("2026-03-02", "2026-03-02", 1),  # one Monday
            ("2026-03-02", "2026-03-06", 5),  # Mon-Fri
            ("2026-03-04", "2026-03-10", 5),  # Wed-Tue spanning a weekend: Wed Thu Fri Mon Tue
            ("2026-03-06", "2026-03-09", 2),  # Fri and Mon only
        ],
    )
    def test_weekends_are_not_leave_days(self, emp, types, start, end, days):
        body = submit(emp, types["annual"], start, end).json()
        assert body["days"] == days

    def test_preview_matches_what_would_be_charged(self, emp):
        p = emp.client.get(f"{LV}/preview", params={"start_date": "2026-03-04", "end_date": "2026-03-10"}).json()
        assert (p["days"], p["weekends_skipped"], p["holidays_skipped"]) == (5, 2, 0)

    def test_holidays_are_not_leave_days(self, emp, types, person):
        admin = person(UserRole.ADMIN, "Boss")
        admin.client.post("/api/v1/holidays", json={"day": "2026-03-04", "name": "Founders day"})
        p = emp.client.get(f"{LV}/preview", params={"start_date": "2026-03-02", "end_date": "2026-03-06"}).json()
        assert (p["days"], p["holidays_skipped"]) == (4, 1)
        assert submit(emp, types["annual"], "2026-03-02", "2026-03-06").json()["days"] == 4

    def test_a_holiday_on_a_weekend_is_counted_once_as_a_weekend(self, emp, person):
        admin = person(UserRole.ADMIN, "Boss")
        admin.client.post("/api/v1/holidays", json={"day": "2026-03-07", "name": "Saturday fair"})
        p = emp.client.get(f"{LV}/preview", params={"start_date": "2026-03-06", "end_date": "2026-03-09"}).json()
        assert (p["days"], p["weekends_skipped"], p["holidays_skipped"]) == (2, 2, 0)

    def test_the_work_week_comes_from_settings(self, emp, types, person):
        admin = person(UserRole.ADMIN, "Boss")
        body = {"timezone": "UTC", "work_days": [0, 1, 2, 3, 5], "work_start": "09:00", "work_end": "17:00",
                "grace_minutes": 10, "max_backdate_days": 30}  # fmt: skip
        admin.client.put("/api/v1/work-settings", json=body)  # Saturday works, Friday is off
        assert submit(emp, types["annual"], "2026-03-05", "2026-03-08").json()["days"] == 2  # Thu and Sat

    def test_changing_holidays_later_never_rewrites_approved_leave(self, emp, types, hr, person):
        made = submit(emp, types["annual"], "2026-03-09", "2026-03-13").json()
        assert made["days"] == 5
        hr.client.post(f"{LV}/requests/{made['id']}/approve")
        admin = person(UserRole.ADMIN, "Boss")
        admin.client.post("/api/v1/holidays", json={"day": "2026-03-11", "name": "Added later"})
        again = emp.client.get(f"{LV}/requests/{made['id']}").json()
        assert again["days"] == 5
        assert balance(emp, "annual")["used"] == 5

    def test_a_range_of_only_a_weekend_is_refused(self, emp, types):
        res = submit(emp, types["annual"], "2026-03-07", "2026-03-08")
        assert res.status_code == 422 and "no working days" in res.json()["detail"]


class TestValidation:
    def test_end_before_start(self, emp, types):
        assert submit(emp, types["annual"], "2026-03-10", "2026-03-09").status_code == 422

    def test_cannot_span_two_years(self, emp, types):
        res = submit(emp, types["annual"], "2026-12-30", "2027-01-05")
        assert res.status_code == 422 and "two calendar years" in res.json()["detail"]

    def test_backdating_is_limited_by_settings(self, emp, types):
        assert submit(emp, types["sick"], "2026-02-02", "2026-02-02").status_code == 201  # 28 days back
        res = submit(emp, types["sick"], "2026-01-26", "2026-01-26")  # 35 days back
        assert res.status_code == 422 and "30 days" in res.json()["detail"]

    def test_unknown_and_inactive_types(self, emp, types, hr):
        assert submit(emp, "00000000-0000-0000-0000-000000000000", "2026-03-10").status_code == 404
        hr.client.patch(f"{LV}/types/{types['casual']}", json={"is_active": False})
        assert submit(emp, types["casual"], "2026-03-10").status_code == 422

    def test_reason_is_optional_but_capped(self, emp, types):
        assert emp.client.post(f"{LV}/requests", json={**request_body(types["annual"], "2026-03-10"), "reason": ""}).status_code == 201
        assert emp.client.post(f"{LV}/requests", json={**request_body(types["annual"], "2026-03-11"), "reason": "x" * 1001}).status_code == 422

    def test_extra_fields_are_rejected(self, emp, types):
        body = {**request_body(types["annual"], "2026-03-10"), "status": "approved", "days": 99}
        assert emp.client.post(f"{LV}/requests", json=body).status_code == 422

    def test_a_user_without_an_employee_record_cannot_request(self, person, types):
        nobody = person(UserRole.ADMIN, link=False)
        assert submit(nobody, types["annual"], "2026-03-10").status_code == 409


class TestOverlap:
    def test_pending_overlap_is_refused(self, emp, types):
        assert submit(emp, types["annual"], "2026-03-10", "2026-03-12").status_code == 201
        res = submit(emp, types["sick"], "2026-03-12", "2026-03-13")
        assert res.status_code == 409 and "overlaps" in res.json()["detail"]

    def test_approved_overlap_is_refused(self, emp, types, hr):
        made = submit(emp, types["annual"], "2026-03-10", "2026-03-12").json()
        hr.client.post(f"{LV}/requests/{made['id']}/approve")
        assert submit(emp, types["sick"], "2026-03-09", "2026-03-10").status_code == 409

    def test_touching_ranges_do_not_overlap(self, emp, types):
        assert submit(emp, types["annual"], "2026-03-10", "2026-03-11").status_code == 201
        assert submit(emp, types["annual"], "2026-03-12", "2026-03-12").status_code == 201
        assert submit(emp, types["annual"], "2026-03-09", "2026-03-09").status_code == 201

    @pytest.mark.parametrize("finish", ["reject", "withdraw"])
    def test_dead_requests_never_block(self, emp, types, hr, finish):
        made = submit(emp, types["annual"], "2026-03-10", "2026-03-11").json()
        if finish == "reject":
            hr.client.post(f"{LV}/requests/{made['id']}/reject", json={"reason": "Busy week"})
        else:
            emp.client.post(f"{LV}/requests/{made['id']}/withdraw")
        assert submit(emp, types["annual"], "2026-03-10", "2026-03-11").status_code == 201

    def test_two_employees_may_take_the_same_days(self, emp, person, types, session_factory):
        other = person(UserRole.EMPLOYEE, "Omar")
        grant(session_factory, other.employee_id, types["annual"], 5)
        assert submit(emp, types["annual"], "2026-03-10").status_code == 201
        assert submit(other, types["annual"], "2026-03-10").status_code == 201


class TestBalances:
    def test_not_enough_balance_is_refused_with_the_numbers(self, emp, types):
        res = submit(emp, types["annual"], "2026-03-09", "2026-03-24")  # 12 working days, 10 available
        assert res.status_code == 422
        assert "10 day(s) available" in res.json()["detail"] and "12 requested" in res.json()["detail"]

    def test_pending_requests_reserve_balance(self, emp, types):
        assert submit(emp, types["annual"], "2026-03-09", "2026-03-13").status_code == 201  # 5 of 10
        assert balance(emp, "annual")["pending"] == 5 and balance(emp, "annual")["available"] == 5
        assert submit(emp, types["annual"], "2026-03-16", "2026-03-20").status_code == 201  # the other 5
        res = submit(emp, types["annual"], "2026-03-23")
        assert res.status_code == 422  # nothing left to reserve

    def test_a_withdrawn_request_releases_its_reservation(self, emp, types):
        made = submit(emp, types["annual"], "2026-03-09", "2026-03-13").json()
        emp.client.post(f"{LV}/requests/{made['id']}/withdraw")
        assert balance(emp, "annual")["available"] == 10

    def test_someone_with_no_allocation_has_zero_available(self, person, types):
        fresh = person(UserRole.EMPLOYEE, "New")
        assert submit(fresh, types["annual"], "2026-03-10").status_code == 422
        assert balance(fresh, "annual")["available"] == 0

    def test_unpaid_and_untracked_types_need_no_balance(self, emp, types):
        assert submit(emp, types["unpaid"], "2026-03-09", "2026-03-13").status_code == 201
        assert submit(emp, types["other"], "2026-03-16", "2026-03-17").status_code == 201

    def test_balance_rows_exist_only_for_tracked_types(self, emp):
        rows = emp.client.get(f"{LV}/balances/me", params={"year": 2026}).json()["balances"]
        assert {r["leave_type"]["code"] for r in rows} == {"annual", "sick", "casual"}

    def test_the_year_defaults_to_the_current_year(self, emp):
        assert emp.client.get(f"{LV}/balances/me").json()["year"] == 2026


class TestApprovalLifecycle:
    def test_approval_deducts_exactly_once(self, emp, types, hr, session_factory):
        made = submit(emp, types["annual"], "2026-03-09", "2026-03-11").json()
        assert made["status"] == "pending" and made["allowed_actions"] == ["withdraw"]
        done = hr.client.post(f"{LV}/requests/{made['id']}/approve", json={"reason": "Enjoy"}).json()
        assert done["status"] == "approved" and done["review_reason"] == "Enjoy"
        assert done["reviewer"]["email"] == hr.user.email and done["decided_at"]
        assert balance(emp, "annual") == {**balance(emp, "annual"), "entitlement": 10, "used": 3, "pending": 0, "available": 7}
        deductions = [e for e in ledger(session_factory, emp.employee_id) if e.entry_type == LedgerEntryType.DEDUCTION]
        assert len(deductions) == 1 and deductions[0].days == Decimal("-3.0")

    def test_approving_twice_is_refused_and_deducts_once(self, emp, types, hr, session_factory):
        made = submit(emp, types["annual"], "2026-03-09", "2026-03-10").json()
        assert hr.client.post(f"{LV}/requests/{made['id']}/approve").status_code == 200
        res = hr.client.post(f"{LV}/requests/{made['id']}/approve")
        assert res.status_code == 409 and "already approved" in res.json()["detail"]
        assert balance(emp, "annual")["used"] == 2

    def test_approving_a_rejected_or_withdrawn_request_is_refused(self, emp, types, hr):
        rejected = submit(emp, types["annual"], "2026-03-09").json()
        hr.client.post(f"{LV}/requests/{rejected['id']}/reject", json={"reason": "No cover"})
        withdrawn = submit(emp, types["annual"], "2026-03-10").json()
        emp.client.post(f"{LV}/requests/{withdrawn['id']}/withdraw")
        for made in (rejected, withdrawn):
            assert hr.client.post(f"{LV}/requests/{made['id']}/approve").status_code == 409

    def test_approval_rechecks_the_balance(self, emp, types, hr, session_factory):
        made = submit(emp, types["annual"], "2026-03-09", "2026-03-13").json()  # 5 of 10
        hr.client.post(f"{LV}/balances/adjust", json={"employee_id": emp.id, "leave_type_id": str(types["annual"]),
                                                      "year": 2026, "days": -6, "reason": "Correction"})  # fmt: skip
        res = hr.client.post(f"{LV}/requests/{made['id']}/approve")
        assert res.status_code == 409 and "enough balance" in res.json()["detail"]
        assert emp.client.get(f"{LV}/requests/{made['id']}").json()["status"] == "pending"

    def test_unpaid_leave_never_touches_paid_balances(self, emp, types, hr, session_factory):
        before = ledger(session_factory, emp.employee_id)
        made = submit(emp, types["unpaid"], "2026-03-09", "2026-03-13").json()
        assert hr.client.post(f"{LV}/requests/{made['id']}/approve").status_code == 200
        assert len(ledger(session_factory, emp.employee_id)) == len(before)  # no entry at all
        assert balance(emp, "annual")["available"] == 10 and balance(emp, "sick")["available"] == 5

    def test_rejection_needs_a_reason_and_deducts_nothing(self, emp, types, hr):
        made = submit(emp, types["annual"], "2026-03-09").json()
        assert hr.client.post(f"{LV}/requests/{made['id']}/reject", json={"reason": ""}).status_code == 422
        done = hr.client.post(f"{LV}/requests/{made['id']}/reject", json={"reason": "Release week"}).json()
        assert done["status"] == "rejected" and done["review_reason"] == "Release week"
        assert balance(emp, "annual")["used"] == 0

    def test_withdraw_only_while_pending_and_only_by_the_owner(self, emp, types, hr, person):
        made = submit(emp, types["annual"], "2026-03-09").json()
        stranger = person(UserRole.EMPLOYEE, "Zed")
        assert stranger.client.post(f"{LV}/requests/{made['id']}/withdraw").status_code == 404
        assert hr.client.post(f"{LV}/requests/{made['id']}/withdraw").status_code == 403  # HR may view it, not withdraw it
        assert emp.client.post(f"{LV}/requests/{made['id']}/withdraw").json()["status"] == "withdrawn"
        assert emp.client.post(f"{LV}/requests/{made['id']}/withdraw").status_code == 409
        again = submit(emp, types["annual"], "2026-03-10").json()
        hr.client.post(f"{LV}/requests/{again['id']}/approve")
        assert emp.client.post(f"{LV}/requests/{again['id']}/withdraw").status_code == 409

    def test_history_records_every_step_with_who_and_why(self, emp, types, hr, wclock):
        made = submit(emp, types["annual"], "2026-03-09").json()
        wclock.advance(minutes=5)
        hr.client.post(f"{LV}/requests/{made['id']}/approve", json={"reason": "Fine"})
        wclock.advance(minutes=5)
        emp.client.post(f"{LV}/requests/{made['id']}/cancel", json={"reason": "Plans changed"})
        events = emp.client.get(f"{LV}/requests/{made['id']}/history").json()
        assert [e["event_type"] for e in events] == ["submitted", "approved", "cancelled"]
        assert events[1]["actor_email"] == hr.user.email and events[1]["note"] == "Fine"
        assert events[2]["note"] == "Plans changed"


class TestSelfApproval:
    def test_hr_cannot_decide_their_own_request(self, hr, types, session_factory):
        grant(session_factory, hr.employee_id, types["annual"], 5)
        mine = submit(hr, types["annual"], "2026-03-09").json()
        assert mine["allowed_actions"] == ["withdraw"]  # no approve button for your own request
        assert hr.client.post(f"{LV}/requests/{mine['id']}/approve").status_code == 403
        assert hr.client.post(f"{LV}/requests/{mine['id']}/reject", json={"reason": "x"}).status_code == 403
        assert hr.client.get(f"{LV}/requests/{mine['id']}").json()["status"] == "pending"

    def test_an_admin_cannot_approve_their_own_either_but_another_admin_can(self, person, types, session_factory):
        a1, a2 = person(UserRole.ADMIN, "One"), person(UserRole.ADMIN, "Two")
        grant(session_factory, a1.employee_id, types["annual"], 5)
        mine = submit(a1, types["annual"], "2026-03-09").json()
        assert a1.client.post(f"{LV}/requests/{mine['id']}/approve").status_code == 403
        assert a2.client.post(f"{LV}/requests/{mine['id']}/approve").status_code == 200

    @pytest.mark.parametrize("role", [UserRole.EMPLOYEE, UserRole.RECRUITER])
    def test_non_hr_roles_cannot_decide_anything(self, person, emp, types, role):
        made = submit(emp, types["annual"], "2026-03-09").json()
        other = person(role, "Peer")
        assert other.client.post(f"{LV}/requests/{made['id']}/approve").status_code == 403
        assert other.client.post(f"{LV}/requests/{made['id']}/reject", json={"reason": "no"}).status_code == 403
        assert emp.client.post(f"{LV}/requests/{made['id']}/approve").status_code == 403


class TestCancellation:
    def approved(self, emp, types, hr, start="2026-03-09", end="2026-03-11"):
        made = submit(emp, types["annual"], start, end).json()
        hr.client.post(f"{LV}/requests/{made['id']}/approve")
        return made["id"]

    def test_cancelling_future_approved_leave_gives_the_days_back_once(self, emp, types, hr, session_factory):
        rid = self.approved(emp, types, hr)
        assert balance(emp, "annual")["available"] == 7
        done = emp.client.post(f"{LV}/requests/{rid}/cancel", json={}).json()
        assert done["status"] == "cancelled" and done["cancelled_at"]
        assert balance(emp, "annual")["available"] == 10 and balance(emp, "annual")["used"] == 0
        kinds = [e.entry_type for e in ledger(session_factory, emp.employee_id)]
        assert kinds.count(LedgerEntryType.DEDUCTION) == 1 and kinds.count(LedgerEntryType.REVERSAL) == 1
        assert emp.client.post(f"{LV}/requests/{rid}/cancel", json={}).status_code == 409
        assert balance(emp, "annual")["available"] == 10

    def test_hr_can_cancel_with_a_reason_but_not_without(self, emp, types, hr):
        rid = self.approved(emp, types, hr)
        assert hr.client.post(f"{LV}/requests/{rid}/cancel", json={}).status_code == 422
        res = hr.client.post(f"{LV}/requests/{rid}/cancel", json={"reason": "Project deadline"})
        assert res.status_code == 200 and balance(emp, "annual")["available"] == 10

    def test_leave_that_has_started_cannot_be_cancelled(self, emp, types, hr, wclock):
        rid = self.approved(emp, types, hr, "2026-03-09", "2026-03-11")
        wclock.set("2026-03-09T08:00:00Z")
        res = emp.client.post(f"{LV}/requests/{rid}/cancel", json={})
        assert res.status_code == 409 and "already started" in res.json()["detail"]
        assert balance(emp, "annual")["used"] == 3

    def test_only_approved_leave_can_be_cancelled(self, emp, types):
        made = submit(emp, types["annual"], "2026-03-09").json()
        assert emp.client.post(f"{LV}/requests/{made['id']}/cancel", json={}).status_code == 409

    def test_others_cannot_cancel_it(self, emp, types, hr, person):
        rid = self.approved(emp, types, hr)
        assert person(UserRole.EMPLOYEE, "Zed").client.post(f"{LV}/requests/{rid}/cancel", json={}).status_code == 404
        assert person(UserRole.RECRUITER, "Rex").client.post(f"{LV}/requests/{rid}/cancel", json={}).status_code == 404

    def test_cancelling_untracked_leave_makes_no_ledger_entry(self, emp, types, hr, session_factory):
        made = submit(emp, types["unpaid"], "2026-03-09").json()
        hr.client.post(f"{LV}/requests/{made['id']}/approve")
        n = len(ledger(session_factory, emp.employee_id))
        assert emp.client.post(f"{LV}/requests/{made['id']}/cancel", json={}).status_code == 200
        assert len(ledger(session_factory, emp.employee_id)) == n

    def test_the_freed_dates_can_be_requested_again(self, emp, types, hr):
        rid = self.approved(emp, types, hr)
        emp.client.post(f"{LV}/requests/{rid}/cancel", json={})
        assert submit(emp, types["annual"], "2026-03-09", "2026-03-11").status_code == 201


class TestAllocationAndAdjustment:
    def test_allocate_grants_the_defaults_to_active_employees_once(self, person, types, hr):
        a, b = person(UserRole.EMPLOYEE, "A"), person(UserRole.EMPLOYEE, "B")
        first = hr.client.post(f"{LV}/balances/allocate", json={"year": 2027}).json()
        assert first["granted"] == 9 and first["already_granted"] == 0  # 3 people x 3 tracked types
        again = hr.client.post(f"{LV}/balances/allocate", json={"year": 2027}).json()
        assert again == {"granted": 0, "already_granted": 9}
        assert balance(a, "annual", 2027)["entitlement"] == 14 and balance(b, "sick", 2027)["entitlement"] == 10

    def test_allocate_for_one_employee(self, person, types, hr):
        a, b = person(UserRole.EMPLOYEE, "A"), person(UserRole.EMPLOYEE, "B")
        res = hr.client.post(f"{LV}/balances/allocate", json={"year": 2027, "employee_id": a.id}).json()
        assert res["granted"] == 3
        assert balance(b, "annual", 2027)["entitlement"] == 0

    def test_inactive_employees_get_no_allocation(self, person, types, hr):
        from app.models.employee import EmploymentStatus

        gone = person(UserRole.EMPLOYEE, "Gone", status=EmploymentStatus.TERMINATED)
        hr.client.post(f"{LV}/balances/allocate", json={"year": 2027})
        assert hr.client.get(f"{LV}/balances", params={"employee_id": gone.id, "year": 2027}).json()["balances"][0]["entitlement"] == 0

    def test_adjustments_are_audited_and_cannot_overdraw(self, emp, types, hr, session_factory):
        body = {"employee_id": emp.id, "leave_type_id": str(types["annual"]), "year": 2026, "reason": "Carry-over"}
        assert hr.client.post(f"{LV}/balances/adjust", json={**body, "days": 3}).status_code == 200
        assert balance(emp, "annual")["entitlement"] == 13
        res = hr.client.post(f"{LV}/balances/adjust", json={**body, "days": -14})
        assert res.status_code == 422 and "negative" in res.json()["detail"]
        entry = [e for e in ledger(session_factory, emp.employee_id) if e.entry_type == LedgerEntryType.ADJUSTMENT][0]
        assert entry.reason == "Carry-over" and entry.actor_id == hr.user.id

    def test_adjustment_validation(self, emp, types, hr):
        base = {"employee_id": emp.id, "leave_type_id": str(types["annual"]), "year": 2026, "days": 1, "reason": "x"}
        assert hr.client.post(f"{LV}/balances/adjust", json={**base, "days": 0}).status_code == 422
        assert hr.client.post(f"{LV}/balances/adjust", json={**base, "reason": "  "}).status_code == 422
        assert hr.client.post(f"{LV}/balances/adjust", json={**base, "leave_type_id": str(types["unpaid"])}).status_code == 422
        missing = {**base, "employee_id": "00000000-0000-0000-0000-000000000000"}
        assert hr.client.post(f"{LV}/balances/adjust", json=missing).status_code == 404

    def test_employees_cannot_change_balances(self, emp, types):
        body = {"employee_id": emp.id, "leave_type_id": str(types["annual"]), "year": 2026, "days": 30, "reason": "mine"}
        assert emp.client.post(f"{LV}/balances/adjust", json=body).status_code == 403
        assert emp.client.post(f"{LV}/balances/allocate", json={"year": 2026}).status_code == 403
        assert balance(emp, "annual")["entitlement"] == 10


class TestLedgerIntegrity:
    def test_the_ledger_is_append_only(self, emp, session_factory):
        with session_factory() as db:
            entry = db.scalars(select(LeaveLedgerEntry)).first()
            entry.days = Decimal("99")
            with pytest.raises(HistoryIsAppendOnly):
                db.commit()
        with session_factory() as db:
            entry = db.scalars(select(LeaveLedgerEntry)).first()
            db.delete(entry)
            with pytest.raises(HistoryIsAppendOnly):
                db.commit()

    def test_the_database_itself_refuses_a_second_deduction(self, emp, types, hr, session_factory):
        made = submit(emp, types["annual"], "2026-03-09").json()
        hr.client.post(f"{LV}/requests/{made['id']}/approve")
        with session_factory() as db:
            db.add(
                LeaveLedgerEntry(
                    employee_id=emp.employee_id, leave_type_id=types["annual"], year=2026,
                    entry_type=LedgerEntryType.DEDUCTION, days=Decimal("-1"), request_id=uuid.UUID(made["id"]),
                )
            )  # fmt: skip
            with pytest.raises(IntegrityError):
                db.commit()

    def test_the_database_refuses_a_second_allocation_and_malformed_entries(self, emp, types, session_factory):
        for bad in (
            dict(entry_type=LedgerEntryType.ALLOCATION, days=Decimal("5")),  # duplicate for the year
            dict(entry_type=LedgerEntryType.DEDUCTION, days=Decimal("-1")),  # no request
            dict(entry_type=LedgerEntryType.REVERSAL, days=Decimal("1")),  # no request
            dict(entry_type=LedgerEntryType.ADJUSTMENT, days=Decimal("0")),
        ):
            with session_factory() as db:
                db.add(LeaveLedgerEntry(employee_id=emp.employee_id, leave_type_id=types["annual"], year=2026, **bad))
                with pytest.raises(IntegrityError):
                    db.commit()

    def test_balance_is_the_sum_of_the_ledger_after_a_busy_year(self, emp, types, hr, session_factory):
        for start, end in (("2026-03-09", "2026-03-10"), ("2026-03-16", "2026-03-18")):
            made = submit(emp, types["annual"], start, end).json()
            hr.client.post(f"{LV}/requests/{made['id']}/approve")
        last = submit(emp, types["annual"], "2026-03-23").json()
        hr.client.post(f"{LV}/requests/{last['id']}/approve")
        emp.client.post(f"{LV}/requests/{last['id']}/cancel", json={})
        total = sum(e.days for e in ledger(session_factory, emp.employee_id) if e.leave_type_id == types["annual"])
        assert total == Decimal("5") and balance(emp, "annual")["available"] == 5


class TestListingsAndCalendar:
    def test_my_requests_only_and_paged(self, emp, types, person):
        other = person(UserRole.EMPLOYEE, "Other")
        for d in range(9, 14):
            submit(emp, types["unpaid"], f"2026-03-{d:02d}")
        submit(other, types["unpaid"], "2026-03-09")
        page = emp.client.get(f"{LV}/requests/me", params={"page_size": 2}).json()
        assert page["total"] == 5 and len(page["items"]) == 2
        assert {r["employee"]["id"] for r in page["items"]} == {emp.id}

    def test_hr_list_filters(self, emp, types, hr, person):
        other = person(UserRole.EMPLOYEE, "Other")
        a = submit(emp, types["unpaid"], "2026-03-09").json()
        submit(other, types["unpaid"], "2026-03-10")
        hr.client.post(f"{LV}/requests/{a['id']}/approve")
        assert hr.client.get(f"{LV}/requests").json()["total"] == 2
        assert hr.client.get(f"{LV}/requests", params={"status": "approved"}).json()["total"] == 1
        assert hr.client.get(f"{LV}/requests", params={"employee_id": other.id}).json()["total"] == 1
        assert hr.client.get(f"{LV}/requests", params={"type_id": str(types["annual"])}).json()["total"] == 0
        assert hr.client.get(f"{LV}/requests", params={"start": "2026-03-10", "end": "2026-03-10"}).json()["total"] == 1
        assert hr.client.get(f"{LV}/requests", params={"status": "nonsense"}).status_code == 422

    def test_calendar_shows_holidays_to_all_and_other_peoples_leave_only_to_hr(self, emp, types, hr, person):
        person(UserRole.ADMIN, "Boss").client.post("/api/v1/holidays", json={"day": "2026-03-20", "name": "Spring day"})
        made = submit(emp, types["unpaid"], "2026-03-09", "2026-03-10").json()
        hr.client.post(f"{LV}/requests/{made['id']}/approve")
        peer = person(UserRole.EMPLOYEE, "Peer")
        mine = emp.client.get(f"{LV}/calendar", params={"month": "2026-03"}).json()
        theirs = peer.client.get(f"{LV}/calendar", params={"month": "2026-03"}).json()
        boss = hr.client.get(f"{LV}/calendar", params={"month": "2026-03"}).json()
        assert [h["name"] for h in theirs["holidays"]] == ["Spring day"]
        assert len(mine["my_leave"]) == 1 and mine["team_leave"] == []
        assert theirs["my_leave"] == [] and theirs["team_leave"] == []
        assert len(boss["team_leave"]) == 1 and boss["team_leave"][0]["leave_type"] == "Unpaid leave"

    def test_leave_stats(self, emp, types, hr, person):
        a = submit(emp, types["annual"], "2026-03-02").json()  # today
        b = submit(person(UserRole.EMPLOYEE, "Other"), types["unpaid"], "2026-03-10").json()
        hr.client.post(f"{LV}/requests/{a['id']}/approve")
        s = hr.client.get(f"{LV}/stats").json()
        assert s["pending_requests"] == 1 and s["on_leave_today"] == 1
        assert s["approved_days_this_month"] == 1 and s["starting_next_14_days"] == 1
        assert b["status"] == "pending"


class TestLeaveTypes:
    def test_hr_manages_types_and_unpaid_never_tracks_a_balance(self, hr, emp):
        made = hr.client.post(f"{LV}/types", json={"code": "study", "name": "Study leave", "is_paid": False,
                                                    "tracks_balance": True, "default_days": 5}).json()  # fmt: skip
        assert made["tracks_balance"] is False  # unpaid cannot deduct anything
        assert hr.client.post(f"{LV}/types", json={"code": "study", "name": "Dup"}).status_code == 409
        assert hr.client.post(f"{LV}/types", json={"code": "Bad Code!", "name": "x"}).status_code == 422
        assert hr.client.patch(f"{LV}/types/{made['id']}", json={"name": "Exam leave"}).json()["name"] == "Exam leave"
        assert emp.client.post(f"{LV}/types", json={"code": "mine", "name": "Mine"}).status_code == 403
        assert emp.client.patch(f"{LV}/types/{made['id']}", json={"name": "x"}).status_code == 403

    def test_everyone_lists_active_types_only_hr_sees_inactive(self, emp, hr, types):
        hr.client.patch(f"{LV}/types/{types['other']}", json={"is_active": False})
        assert "other" not in {t["code"] for t in emp.client.get(f"{LV}/types").json()}
        assert "other" not in {t["code"] for t in emp.client.get(f"{LV}/types", params={"include_inactive": True}).json()}
        assert "other" in {t["code"] for t in hr.client.get(f"{LV}/types", params={"include_inactive": True}).json()}


def test_the_request_row_checks_hold_in_the_database(emp, types, session_factory):
    import datetime as dt

    with session_factory() as db:
        db.add(
            LeaveRequest(
                employee_id=emp.employee_id, leave_type_id=types["annual"],
                start_date=dt.date(2026, 3, 10), end_date=dt.date(2026, 3, 9), days=Decimal("1"),
                submitted_at=dt.datetime(2026, 3, 2, tzinfo=dt.UTC),
            )
        )  # fmt: skip
        with pytest.raises(IntegrityError):
            db.commit()
