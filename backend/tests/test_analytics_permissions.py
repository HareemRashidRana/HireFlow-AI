"""Who may read analytics, what they must never see, and how many queries it costs."""

import json

import pytest
from sqlalchemy import event

from app.models.application import ApplicationStage as S
from app.models.interview import InterviewStatus as IS
from app.models.user import UserRole
from tests.analytics_helpers import ANALYTICS, EMAIL_DOMAIN, NAME, UTC_RANGE, Seed, at, overview

PATHS = ["/overview", "/jobs", "/filter-options"]


@pytest.fixture
def seed(session_factory) -> Seed:
    return Seed(session_factory)


def populate(seed: Seed, n: int = 3) -> None:
    seed.employee()
    job = seed.job()
    for i in range(n):
        app = seed.application(job, at(2 + i % 20), S.INTERVIEW)
        seed.interview(app, at(10 + i % 20), IS.COMPLETED)
    seed.hired(job, at(1), at(9))


class TestAccess:
    @pytest.mark.parametrize("path", PATHS)
    def test_signed_out_is_401(self, new_client, path):
        assert new_client().get(ANALYTICS + path).status_code == 401

    @pytest.mark.parametrize("path", PATHS)
    def test_employees_are_refused_even_with_a_linked_record(self, client_as, seed, path):
        seed.employee()
        employee = client_as(UserRole.EMPLOYEE)
        res = employee.get(ANALYTICS + path)
        assert res.status_code == 403
        assert "kpis" not in res.text and "funnel" not in res.text

    @pytest.mark.parametrize("role", [UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER])
    @pytest.mark.parametrize("path", PATHS)
    def test_recruitment_staff_can_read(self, client_as, role, path):
        assert client_as(role).get(ANALYTICS + path, params=UTC_RANGE).status_code == 200

    def test_a_recruiter_sees_exactly_what_the_hr_manager_sees(self, client_as, seed):
        """Recruiters already read every application and the whole directory, so analytics add no
        new visibility. Neither the recruiter's own assignments nor anything else changes it."""
        populate(seed)
        hr, rec = client_as(UserRole.HR_MANAGER), client_as(UserRole.RECRUITER)
        a, b = overview(hr), overview(rec)
        a["period"].pop("generated_at")
        b["period"].pop("generated_at")
        assert a == b

    def test_the_employee_role_cannot_pass_a_filter_to_get_in(self, client_as, seed):
        job = seed.job()
        employee = client_as(UserRole.EMPLOYEE)
        res = employee.get(f"{ANALYTICS}/overview", params={"job_id": str(job), **UTC_RANGE})
        assert res.status_code == 403  # access is decided before the filter is even looked at

    def test_an_unknown_job_id_does_not_reveal_anything_to_an_employee(self, client_as):
        res = client_as(UserRole.EMPLOYEE).get(
            f"{ANALYTICS}/overview", params={"job_id": "00000000-0000-0000-0000-000000000000"}
        )
        assert res.status_code == 403  # not 404: an employee cannot probe which jobs exist

    def test_analytics_are_read_only(self, client_as):
        hr = client_as(UserRole.HR_MANAGER)
        for path in PATHS:
            for verb in (hr.post, hr.put, hr.patch, hr.delete):
                assert verb(ANALYTICS + path).status_code in (404, 405, 422)


class TestNoPersonalData:
    @pytest.mark.parametrize("path", PATHS)
    def test_responses_never_contain_names_emails_or_notes(self, client_as, seed, path):
        populate(seed)
        res = client_as(UserRole.ADMIN).get(ANALYTICS + path, params={**UTC_RANGE, "page_size": 50})
        text = res.text
        assert NAME not in text and EMAIL_DOMAIN not in text and "private note" not in text
        assert "internal_notes" not in text and "email" not in text

    def test_the_response_keys_are_a_fixed_aggregate_shape(self, client_as, seed):
        populate(seed)
        body = overview(client_as(UserRole.ADMIN))
        assert set(body) == {
            "period", "kpis", "funnel", "trends", "interviews", "sources", "time_to_hire", "recent_activity",
        }
        assert set(json.dumps(body["kpis"]).replace('"', "").split()) >= set()  # JSON-serialisable
        assert set(body["recent_activity"][0]) == {"application_id", "event", "to_stage", "job_title", "at"}


class TestQueryCost:
    """The query count must not grow with the amount of data (no N+1), and nothing is written."""

    def statements(self, engine, client, path, params) -> list[str]:
        seen: list[str] = []

        @event.listens_for(engine, "before_cursor_execute")
        def record(_c, _cur, statement, *_rest):
            seen.append(statement)

        try:
            assert client.get(ANALYTICS + path, params=params).status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", record)
        return seen

    def test_the_overview_costs_the_same_for_a_few_rows_or_many(self, engine, client_as, seed):
        hr = client_as(UserRole.HR_MANAGER)
        populate(seed, 2)
        small = self.statements(engine, hr, "/overview", UTC_RANGE)
        populate(seed, 40)
        large = self.statements(engine, hr, "/overview", UTC_RANGE)
        assert len(small) == len(large)
        assert len(large) <= 20

    def test_job_performance_costs_the_same_for_one_job_or_forty(self, engine, client_as, seed):
        hr = client_as(UserRole.HR_MANAGER)
        populate(seed, 2)
        small = self.statements(engine, hr, "/jobs", UTC_RANGE)
        for n in range(40):
            seed.application(seed.job(f"Job {n}"), at(5))
        large = self.statements(engine, hr, "/jobs", {**UTC_RANGE, "page_size": 50})
        assert len(small) == len(large) <= 6

    def test_nothing_is_written(self, engine, client_as, seed):
        populate(seed)
        hr = client_as(UserRole.HR_MANAGER)
        for path in PATHS:
            statements = self.statements(engine, hr, path, UTC_RANGE)
            writes = [s for s in statements if s.lstrip().split(None, 1)[0].upper() in {"INSERT", "UPDATE", "DELETE"}]
            assert writes == [], writes

    def test_aggregation_happens_in_sql_not_python(self, engine, client_as, seed):
        populate(seed, 5)
        statements = self.statements(engine, client_as(UserRole.ADMIN), "/overview", UTC_RANGE)
        joined = "\n".join(statements).upper()
        assert "GROUP BY" in joined and "COUNT(" in joined
        analytics = [s for s in statements if "FROM USERS" not in s.upper()]  # not the sign-in check
        loose = [s for s in analytics if not any(k in s.upper() for k in ("COUNT(", "SUM(", "AVG(", "LIMIT"))]
        assert loose == [], "a statement loads rows instead of aggregating"
