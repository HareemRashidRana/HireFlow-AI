"""Recruitment analytics: definitions, boundaries and filters. Dates are fixed (March 2026)."""

from datetime import UTC, datetime, timedelta

import pytest

from app.models.application import ApplicationEventType as E
from app.models.application import ApplicationStage as S
from app.models.candidate import CandidateSource as Src
from app.models.employee import EmploymentStatus
from app.models.interview import InterviewStatus as IS
from app.models.interview import InterviewType as IT
from app.models.job import JobStatus
from app.models.user import UserRole
from tests.analytics_helpers import ANALYTICS, UTC_RANGE, Seed, at, funnel, overview


@pytest.fixture
def seed(session_factory) -> Seed:
    return Seed(session_factory)


@pytest.fixture
def hr(client_as):
    return client_as(UserRole.HR_MANAGER)


class TestEmpty:
    def test_an_empty_database_gives_zeros_and_no_errors(self, hr):
        body = overview(hr)
        assert all(v == 0 for v in body["kpis"].values())
        assert funnel(body) == dict.fromkeys(
            ["applied", "screening", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn"], 0
        )
        assert body["sources"] == [] and body["recent_activity"] == []
        assert body["time_to_hire"] == {"average_days": None, "hires_measured": 0, "hires_without_date": 0}
        assert body["interviews"]["by_type"] == {}
        assert len(body["trends"]) == 31 and all(p["applications"] == 0 for p in body["trends"])

    def test_the_default_range_is_the_last_thirty_days(self, hr):
        body = hr.get(f"{ANALYTICS}/overview").json()
        start, end = body["period"]["start"], body["period"]["end"]
        assert (datetime.fromisoformat(end) - datetime.fromisoformat(start)).days == 29
        assert body["period"]["timezone"] == "UTC" and body["period"]["granularity"] == "day"

    def test_an_empty_jobs_table(self, hr):
        assert hr.get(f"{ANALYTICS}/jobs").json() == {"items": [], "total": 0, "page": 1, "page_size": 10}
        assert hr.get(f"{ANALYTICS}/filter-options").json() == {"jobs": [], "departments": []}


class TestOverviewMetrics:
    def test_every_kpi_comes_from_real_rows(self, hr, seed):
        seed.employee("Engineering")
        seed.employee("Sales")
        seed.employee("Sales", EmploymentStatus.TERMINATED)
        open_job = seed.job(status=JobStatus.OPEN)
        seed.job("Closed role", status=JobStatus.CLOSED)
        seed.job("Draft role", status=JobStatus.DRAFT)
        a1 = seed.application(open_job, at(5), S.INTERVIEW)
        a2 = seed.application(open_job, at(6), S.SCREENING)
        seed.hired(open_job, at(7), at(20))
        seed.application(open_job, at(1, month=2))  # applied before the range
        seed.interview(a1, at(10), IS.COMPLETED)
        seed.interview(a1, at(11), IS.COMPLETED)
        seed.interview(a2, at(12), IS.CANCELLED)
        k = overview(hr)["kpis"]
        assert (k["total_employees"], k["active_employees"]) == (3, 2)
        assert k["total_candidates"] == 4  # everyone in the database: a snapshot
        assert (k["open_jobs"], k["closed_jobs"]) == (1, 1)  # drafts are neither
        assert k["total_applications"] == 3  # the February one is outside the range
        assert k["hires"] == 1
        assert k["completed_interviews"] == 2

    def test_upcoming_counts_only_open_future_interviews_and_ignores_the_range(self, hr, seed):
        job = seed.job()
        app = seed.application(job, at(5))
        now = datetime.now(UTC)
        seed.interview(app, now + timedelta(days=2), IS.SCHEDULED)
        seed.interview(app, now + timedelta(days=3), IS.CONFIRMED)
        seed.interview(app, now + timedelta(days=4), IS.CANCELLED)
        seed.interview(app, now + timedelta(days=5), IS.RESCHEDULED)  # the moved original
        seed.interview(app, now - timedelta(days=2), IS.SCHEDULED)  # in the past
        assert overview(hr)["kpis"]["upcoming_interviews"] == 2  # March 2026 range is in the past

    def test_department_filter_applies_to_employees_jobs_and_applications(self, hr, seed):
        seed.employee("Engineering")
        seed.employee("Sales")
        eng, sales = seed.job("A", "Engineering"), seed.job("B", "Sales", JobStatus.CLOSED)
        seed.application(eng, at(5))
        seed.application(sales, at(6))
        seed.application(sales, at(7))
        k = overview(hr, department="Sales")["kpis"]
        assert (k["total_employees"], k["open_jobs"], k["closed_jobs"], k["total_applications"]) == (1, 0, 1, 2)
        assert k["total_candidates"] == 2


class TestFunnel:
    def test_current_stages_count_each_application_once(self, hr, seed):
        job = seed.job()
        for stage in [S.APPLIED, S.APPLIED, S.SCREENING, S.SHORTLISTED, S.INTERVIEW, S.OFFER, S.REJECTED, S.WITHDRAWN]:
            seed.application(job, at(5), stage)
        seed.hired(job, at(5), at(15))
        body = overview(hr)
        assert funnel(body) == {
            "applied": 2, "screening": 1, "shortlisted": 1, "interview": 1, "offer": 1,
            "hired": 1, "rejected": 1, "withdrawn": 1,
        }
        assert sum(funnel(body).values()) == body["kpis"]["total_applications"] == 9

    def test_funnel_order_is_the_pipeline_order(self, hr):
        assert [f["stage"] for f in overview(hr)["funnel"]] == [
            "applied", "screening", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn",
        ]

    def test_a_reopened_application_counts_once_where_it_is_now(self, hr, seed):
        job = seed.job()
        events = [
            (E.CREATED, None, "applied", at(5)),
            (E.STAGE_CHANGED, "applied", "screening", at(6)),
            (E.REJECTED, "screening", "rejected", at(7)),
            (E.REOPENED, "rejected", "screening", at(8)),
        ]
        seed.application(job, at(5), S.SCREENING, events=events)
        f = funnel(overview(hr))
        assert f["screening"] == 1 and f["rejected"] == 0 and sum(f.values()) == 1

    def test_withdrawn_and_rejected_are_counted_not_dropped(self, hr, seed):
        job = seed.job()
        seed.application(job, at(5), S.REJECTED)
        seed.application(job, at(5), S.WITHDRAWN)
        f = funnel(overview(hr))
        assert (f["rejected"], f["withdrawn"]) == (1, 1)


class TestHiresAndTimeToHire:
    def test_average_days_uses_the_recorded_hire_event(self, hr, seed):
        job = seed.job()
        seed.hired(job, at(1, 12), at(11, 12))  # 10 days
        seed.hired(job, at(2, 12), at(6, 0))  # 3.5 days
        body = overview(hr)
        assert body["time_to_hire"] == {"average_days": 6.8, "hires_measured": 2, "hires_without_date": 0}
        assert body["kpis"]["hires"] == 2

    def test_a_hired_application_without_history_is_reported_not_invented(self, hr, seed):
        job = seed.job()
        seed.hired(job, at(1), at(9))
        seed.hired(job, at(2), None)  # hired, but no event says when
        body = overview(hr)
        assert body["time_to_hire"]["hires_measured"] == 1
        assert body["time_to_hire"]["hires_without_date"] == 1
        assert body["kpis"]["hires"] == 1
        assert funnel(body)["hired"] == 2  # the funnel is by current stage, so both appear

    def test_only_hires_inside_the_range_count(self, hr, seed):
        job = seed.job()
        seed.hired(job, at(1), at(10))
        seed.hired(job, at(1), at(10, month=4))  # hired after the range
        assert overview(hr)["kpis"]["hires"] == 1

    def test_hires_land_in_the_bucket_of_their_hire_date(self, hr, seed):
        job = seed.job()
        seed.hired(job, at(1), at(10, 8))
        seed.hired(job, at(1), at(10, 20))
        seed.hired(job, at(1), at(12))
        hires = {p["bucket_start"]: p["hires"] for p in overview(hr)["trends"]}
        assert hires["2026-03-10"] == 2 and hires["2026-03-12"] == 1 and sum(hires.values()) == 3


class TestTrends:
    def test_buckets_are_days_for_short_ranges_with_every_day_present(self, hr, seed):
        job = seed.job()
        seed.application(job, at(3))
        seed.application(job, at(3, 23))
        seed.application(job, at(9))
        t = overview(hr)["trends"]
        assert [p["bucket_start"] for p in t][:3] == ["2026-03-01", "2026-03-02", "2026-03-03"]
        by = {p["bucket_start"]: p["applications"] for p in t}
        assert by["2026-03-03"] == 2 and by["2026-03-09"] == 1 and sum(by.values()) == 3

    def test_weekly_buckets_start_on_mondays_after_the_first_partial_week(self, hr):
        body = hr.get(f"{ANALYTICS}/overview", params={"start": "2026-02-04", "end": "2026-04-10"}).json()
        assert body["period"]["granularity"] == "week"
        starts = [p["bucket_start"] for p in body["trends"]]
        assert starts[0] == "2026-02-04"  # a Wednesday: the first bucket is partial
        assert starts[1] == "2026-02-09" and all(
            datetime.fromisoformat(s).weekday() == 0 for s in starts[1:]
        )

    def test_monthly_buckets_for_long_ranges(self, hr, seed):
        job = seed.job()
        seed.application(job, at(20, month=1))
        seed.application(job, at(5, month=3))
        body = hr.get(f"{ANALYTICS}/overview", params={"start": "2025-12-15", "end": "2026-06-30"}).json()
        assert body["period"]["granularity"] == "month"
        by = {p["bucket_start"]: p["applications"] for p in body["trends"]}
        assert list(by)[:3] == ["2025-12-15", "2026-01-01", "2026-02-01"]
        assert by["2026-01-01"] == 1 and by["2026-03-01"] == 1

    def test_interviews_in_trends_exclude_cancelled_and_rescheduled(self, hr, seed):
        job = seed.job()
        app = seed.application(job, at(2))
        seed.interview(app, at(10), IS.SCHEDULED)
        seed.interview(app, at(10, 15), IS.COMPLETED)
        seed.interview(app, at(10, 16), IS.CANCELLED)
        seed.interview(app, at(10, 17), IS.RESCHEDULED)
        by = {p["bucket_start"]: p["interviews"] for p in overview(hr)["trends"]}
        assert by["2026-03-10"] == 2 and sum(by.values()) == 2

    def test_bucket_totals_equal_the_kpi_totals(self, hr, seed):
        job = seed.job()
        for day in (1, 8, 15, 22, 29, 31):
            seed.application(job, at(day))
        body = overview(hr)
        assert sum(p["applications"] for p in body["trends"]) == body["kpis"]["total_applications"] == 6


class TestDateBoundaries:
    def test_start_is_inclusive_and_end_is_the_whole_last_day(self, hr, seed):
        job = seed.job()
        seed.application(job, datetime(2026, 2, 28, 23, 59, 59, tzinfo=UTC))  # just before
        seed.application(job, datetime(2026, 3, 1, 0, 0, 0, tzinfo=UTC))  # first instant
        seed.application(job, datetime(2026, 3, 31, 23, 59, 59, tzinfo=UTC))  # last second
        seed.application(job, datetime(2026, 4, 1, 0, 0, 0, tzinfo=UTC))  # just after
        assert overview(hr)["kpis"]["total_applications"] == 2

    def test_a_single_day_range(self, hr, seed):
        job = seed.job()
        seed.application(job, at(5))
        seed.application(job, at(6))
        body = hr.get(f"{ANALYTICS}/overview", params={"start": "2026-03-05", "end": "2026-03-05"}).json()
        assert body["kpis"]["total_applications"] == 1 and len(body["trends"]) == 1

    def test_days_follow_the_requested_time_zone(self, hr, seed):
        job = seed.job()
        seed.application(job, datetime(2026, 3, 9, 19, 30, tzinfo=UTC))  # 00:30 on the 10th in Karachi
        params = {"start": "2026-03-10", "end": "2026-03-10"}
        assert hr.get(f"{ANALYTICS}/overview", params=params).json()["kpis"]["total_applications"] == 0
        karachi = hr.get(f"{ANALYTICS}/overview", params={**params, "timezone": "Asia/Karachi"}).json()
        assert karachi["kpis"]["total_applications"] == 1 and karachi["period"]["timezone"] == "Asia/Karachi"

    def test_a_clock_change_day_is_handled(self, hr, seed):
        job = seed.job()
        # New York springs forward on 8 March 2026 at 02:00 local: that local day is only 23 hours.
        seed.application(job, datetime(2026, 3, 8, 4, 59, tzinfo=UTC))  # 23:59 on the 7th local
        seed.application(job, datetime(2026, 3, 8, 5, 0, tzinfo=UTC))  # 00:00 on the 8th local
        seed.application(job, datetime(2026, 3, 9, 3, 59, tzinfo=UTC))  # 23:59 on the 8th local (EDT)
        seed.application(job, datetime(2026, 3, 9, 4, 0, tzinfo=UTC))  # 00:00 on the 9th local
        params = {"start": "2026-03-07", "end": "2026-03-09", "timezone": "America/New_York"}
        by = {p["bucket_start"]: p["applications"] for p in hr.get(f"{ANALYTICS}/overview", params=params).json()["trends"]}
        assert by == {"2026-03-07": 1, "2026-03-08": 2, "2026-03-09": 1}


class TestInterviewAnalytics:
    def test_statuses_and_types_over_the_range(self, hr, seed):
        job = seed.job()
        app = seed.application(job, at(2))
        seed.interview(app, at(10), IS.SCHEDULED, IT.TECHNICAL)
        seed.interview(app, at(11), IS.CONFIRMED, IT.TECHNICAL)
        seed.interview(app, at(12), IS.COMPLETED, IT.HR_ROUND)
        seed.interview(app, at(13), IS.CANCELLED, IT.FINAL)
        seed.interview(app, at(14), IS.RESCHEDULED, IT.FINAL)
        seed.interview(app, at(5, month=2), IS.COMPLETED, IT.PANEL)  # outside the range
        i = overview(hr)["interviews"]
        assert (i["scheduled"], i["confirmed"], i["completed"], i["cancelled"], i["rescheduled"]) == (1, 1, 1, 1, 1)
        assert i["by_type"] == {"technical": 2, "hr_round": 1}  # cancelled and moved ones are not "held"

    def test_a_rescheduled_original_is_never_upcoming_but_its_replacement_is(self, hr, seed):
        job = seed.job()
        app = seed.application(job, at(2))
        soon = datetime.now(UTC) + timedelta(days=3)
        seed.interview(app, soon, IS.RESCHEDULED)
        assert overview(hr)["kpis"]["upcoming_interviews"] == 0
        seed.interview(app, soon + timedelta(days=1), IS.SCHEDULED)
        assert overview(hr)["kpis"]["upcoming_interviews"] == 1


class TestSources:
    def test_grouped_by_the_real_source_and_ordered_by_size(self, hr, seed):
        job = seed.job()
        for _ in range(3):
            seed.application(job, at(5), source=Src.REFERRAL)
        seed.application(job, at(5), source=Src.LINKEDIN)
        seed.application(job, at(5), source=Src.OTHER)
        seed.application(job, at(5, month=2), source=Src.AGENCY)  # outside the range
        assert overview(hr)["sources"] == [
            {"source": "referral", "label": "Referral", "count": 3},
            {"source": "linkedin", "label": "LinkedIn", "count": 1},
            {"source": "other", "label": "Other", "count": 1},
        ]


class TestJobPerformance:
    def test_counts_per_job_and_conversion(self, hr, seed):
        busy = seed.job("Busy role", "Engineering")
        quiet = seed.job("Quiet role", "Sales", JobStatus.CLOSED)
        a = seed.application(busy, at(5), S.INTERVIEW)
        seed.application(busy, at(6), S.REJECTED)
        seed.application(busy, at(7), S.REJECTED)
        seed.hired(busy, at(8), at(20))
        seed.interview(a, at(10), IS.COMPLETED)
        seed.interview(a, at(11), IS.CANCELLED)  # does not count as an interview held
        body = hr.get(f"{ANALYTICS}/jobs", params=UTC_RANGE).json()
        assert body["total"] == 2
        top, bottom = body["items"]
        assert (top["title"], top["department"], top["status"]) == ("Busy role", "Engineering", "open")
        assert (top["applications"], top["interviews"], top["hired"], top["rejected"]) == (4, 1, 1, 2)
        assert top["conversion_rate"] == 0.25
        assert (bottom["title"], bottom["status"], bottom["applications"]) == ("Quiet role", "closed", 0)
        assert bottom["conversion_rate"] is None  # no applications: no rate, not 0%
        assert quiet == bottom["job_id"] or str(quiet) == bottom["job_id"]

    def test_job_and_department_filters_and_paging(self, hr, seed):
        ids = [seed.job(f"Role {n:02d}", "Engineering" if n % 2 else "Sales") for n in range(12)]
        seed.application(ids[3], at(5))
        page1 = hr.get(f"{ANALYTICS}/jobs", params={**UTC_RANGE, "page_size": 5}).json()
        assert page1["total"] == 12 and len(page1["items"]) == 5 and page1["items"][0]["title"] == "Role 03"
        page3 = hr.get(f"{ANALYTICS}/jobs", params={**UTC_RANGE, "page_size": 5, "page": 3}).json()
        assert len(page3["items"]) == 2
        eng = hr.get(f"{ANALYTICS}/jobs", params={**UTC_RANGE, "department": "Engineering", "page_size": 50}).json()
        assert eng["total"] == 6 and {i["department"] for i in eng["items"]} == {"Engineering"}
        one = hr.get(f"{ANALYTICS}/jobs", params={**UTC_RANGE, "job_id": str(ids[3])}).json()
        assert [i["title"] for i in one["items"]] == ["Role 03"]

    def test_the_date_range_applies_to_each_jobs_numbers(self, hr, seed):
        job = seed.job()
        seed.application(job, at(5))
        seed.application(job, at(5, month=4))
        items = hr.get(f"{ANALYTICS}/jobs", params=UTC_RANGE).json()["items"]
        assert items[0]["applications"] == 1


class TestFilters:
    def test_job_filter_narrows_every_section(self, hr, seed):
        mine, other = seed.job("Mine"), seed.job("Other")
        a = seed.application(mine, at(5), S.OFFER, source=Src.REFERRAL)
        seed.application(other, at(5), S.APPLIED, source=Src.AGENCY)
        seed.interview(a, at(9), IS.COMPLETED)
        seed.hired(other, at(2), at(8))
        body = overview(hr, job_id=str(mine))
        assert funnel(body)["offer"] == 1 and sum(funnel(body).values()) == 1
        assert [s["source"] for s in body["sources"]] == ["referral"]
        assert body["interviews"]["completed"] == 1
        assert body["kpis"]["hires"] == 0 and (body["kpis"]["open_jobs"], body["kpis"]["closed_jobs"]) == (1, 0)
        assert body["period"]["job_id"] == str(mine)

    def test_an_unknown_job_is_not_found(self, hr):
        res = hr.get(f"{ANALYTICS}/overview", params={"job_id": "00000000-0000-0000-0000-000000000000"})
        assert res.status_code == 404

    @pytest.mark.parametrize(
        "params",
        [
            {"start": "2026-03-10", "end": "2026-03-01"},
            {"start": "2020-01-01", "end": "2026-03-01"},  # more than 731 days
            {"timezone": "Mars/Olympus"},
            {"start": "not-a-date"},
            {"job_id": "not-a-uuid"},
            {"department": "x" * 101},
            {"timezone": "x" * 65},
        ],
    )
    def test_bad_filters_are_refused_with_422(self, hr, params):
        assert hr.get(f"{ANALYTICS}/overview", params=params).status_code == 422

    @pytest.mark.parametrize("page", [{"page": 0}, {"page_size": 0}, {"page_size": 51}])
    def test_bad_paging_is_refused(self, hr, page):
        assert hr.get(f"{ANALYTICS}/jobs", params=page).status_code == 422

    def test_a_department_is_matched_as_data_never_as_sql(self, hr, seed):
        seed.job()
        seed.employee()
        evil = "Engineering'; DROP TABLE job_postings; --"
        body = overview(hr, department=evil)
        assert body["kpis"]["total_employees"] == 0
        assert overview(hr)["kpis"]["open_jobs"] == 1  # the table is still there

    def test_filter_options_list_jobs_and_departments(self, hr, seed):
        seed.job("A role", "Design")
        seed.employee("Finance")
        body = hr.get(f"{ANALYTICS}/filter-options").json()
        assert [j["title"] for j in body["jobs"]] == ["A role"] and body["jobs"][0]["status"] == "open"
        assert body["departments"] == ["Design", "Finance"]


class TestRecentActivity:
    def test_shows_events_with_the_job_title_and_never_a_person(self, hr, seed):
        job = seed.job("Platform Engineer")
        seed.application(
            job, at(5), events=[(E.CREATED, None, "applied", at(5)), (E.STAGE_CHANGED, "applied", "screening", at(6)),
                                (E.NOTES_UPDATED, None, None, at(7))]
        )
        recent = overview(hr)["recent_activity"]
        assert [r["event"] for r in recent] == ["stage_changed", "created"]  # notes edits are not activity
        assert recent[0]["to_stage"] == "screening" and recent[0]["job_title"] == "Platform Engineer"
        assert set(recent[0]) == {"application_id", "event", "to_stage", "job_title", "at"}

    def test_is_limited_to_the_latest_eight(self, hr, seed):
        job = seed.job()
        for d in range(1, 13):
            seed.application(job, at(d), events=[(E.CREATED, None, "applied", at(d))])
        recent = overview(hr)["recent_activity"]
        assert len(recent) == 8 and recent[0]["at"].startswith("2026-03-12")
