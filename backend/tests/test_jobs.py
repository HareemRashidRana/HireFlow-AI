"""Job postings: create, read, list/search/filter/paginate, update, delete, validation."""

import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.job import JobPosting
from tests.conftest import employee_payload

JOBS = "/api/v1/jobs"


def job_payload(n: int = 1, **overrides) -> dict:
    payload = {
        "title": f"Software Engineer {n}",
        "department": "Engineering",
        "location": "Lahore, Pakistan",
        "employment_type": "full_time",
        "description": "Build and maintain our HR platform.",
        "required_skills": ["Python", "SQL"],
        "nice_to_have_skills": ["React"],
        "min_experience_years": 2,
        "salary_min": 100000,
        "salary_max": 200000,
        "salary_currency": "PKR",
        "openings": 2,
    }
    payload.update(overrides)
    return payload


def create(client, n: int = 1, **overrides) -> dict:
    res = client.post(JOBS, json=job_payload(n, **overrides))
    assert res.status_code == 201, res.text
    return res.json()


def make_employee(client, n: int = 1, **overrides) -> dict:
    res = client.post("/api/v1/employees", json=employee_payload(n, **overrides))
    assert res.status_code == 201, res.text
    return res.json()


# ---------- create ----------


class TestCreate:
    def test_creates_a_draft_with_all_fields(self, client):
        res = client.post(JOBS, json=job_payload())
        assert res.status_code == 201
        body = res.json()
        assert uuid.UUID(body["id"])
        assert body["status"] == "draft"
        assert body["title"] == "Software Engineer 1"
        assert body["required_skills"] == ["Python", "SQL"]
        assert body["openings"] == 2
        assert body["opened_at"] is None and body["closed_at"] is None
        assert body["hiring_manager"] is None
        assert body["created_at"] and body["updated_at"]

    def test_minimal_payload_uses_defaults(self, client):
        res = client.post(
            JOBS,
            json={
                "title": "Office Assistant",
                "department": "Admin",
                "location": "Remote",
                "employment_type": "part_time",
            },
        )
        assert res.status_code == 201
        body = res.json()
        assert body["description"] == ""
        assert body["required_skills"] == [] and body["nice_to_have_skills"] == []
        assert body["openings"] == 1
        assert body["salary_min"] is None and body["salary_currency"] is None

    def test_trims_text_and_normalises_skills(self, client):
        body = create(
            client,
            title="  Data Analyst  ",
            department="  Analytics ",
            required_skills=["  python ", "Python", "PYTHON", "", "  ", "Machine   Learning"],
            nice_to_have_skills=["sql", "SQL"],
            salary_currency="usd",
        )
        assert body["title"] == "Data Analyst"
        assert body["department"] == "Analytics"
        assert body["required_skills"] == ["python", "Machine Learning"]  # de-duplicated, spaced
        assert body["nice_to_have_skills"] == ["sql"]
        assert body["salary_currency"] == "USD"

    def test_with_hiring_manager(self, client):
        boss = make_employee(client)
        body = create(client, hiring_manager_id=boss["id"])
        assert body["hiring_manager_id"] == boss["id"]
        assert body["hiring_manager"] == {
            "id": boss["id"],
            "first_name": "Test",
            "last_name": "Person1",
            "job_title": "Engineer",
        }

    def test_unknown_hiring_manager_rejected(self, client):
        res = client.post(JOBS, json=job_payload(hiring_manager_id=str(uuid.uuid4())))
        assert res.status_code == 422
        assert res.json()["detail"] == "Hiring manager not found"

    @pytest.mark.parametrize("employment_status", ["inactive", "terminated"])
    def test_inactive_hiring_manager_rejected(self, client, employment_status):
        boss = make_employee(client)
        client.patch(f"/api/v1/employees/{boss['id']}", json={"employment_status": employment_status})
        res = client.post(JOBS, json=job_payload(hiring_manager_id=boss["id"]))
        assert res.status_code == 422
        assert "active employee" in res.json()["detail"]

    @pytest.mark.parametrize(
        "override",
        [
            {"title": "ab"},
            {"title": "   "},
            {"title": "x" * 151},
            {"department": ""},
            {"department": "d" * 101},
            {"location": "  "},
            {"employment_type": "freelancer"},
            {"openings": 0},
            {"openings": 501},
            {"openings": "many"},
            {"min_experience_years": -1},
            {"min_experience_years": 51},
            {"salary_min": -5},
            {"salary_min": 300000, "salary_max": 100000},
            {"salary_min": 100000, "salary_max": 200000, "salary_currency": None},
            {"salary_min": None, "salary_max": None, "salary_currency": "PKR"},
            {"salary_currency": "US"},
            {"salary_currency": "USDX"},
            {"salary_currency": "12$"},
            {"required_skills": [f"skill{i}" for i in range(31)]},
            {"required_skills": ["x" * 51]},
            {"required_skills": "python"},
            {"description": "d" * 10_001},
            {"hiring_manager_id": "not-a-uuid"},
            {"status": "open"},  # status is not settable on create
            {"id": str(uuid.uuid4())},
            {"salary_note": "secret"},
        ],
    )
    def test_invalid_input_is_rejected_and_nothing_saved(self, client, override):
        res = client.post(JOBS, json=job_payload(**override))
        assert res.status_code == 422, res.text
        assert client.get(JOBS).json()["total"] == 0

    @pytest.mark.parametrize("missing", ["title", "department", "location", "employment_type"])
    def test_required_fields(self, client, missing):
        payload = job_payload()
        del payload[missing]
        assert client.post(JOBS, json=payload).status_code == 422

    def test_exactly_30_skills_is_allowed(self, client):
        body = create(client, required_skills=[f"skill{i}" for i in range(30)])
        assert len(body["required_skills"]) == 30

    def test_markup_in_text_is_stored_verbatim_not_interpreted(self, client):
        body = create(client, title="<b>Engineer</b>", description="<script>alert(1)</script>")
        assert body["title"] == "<b>Engineer</b>"  # stored as plain text; the UI renders it as text


# ---------- read ----------


class TestRead:
    def test_get_one(self, client):
        created = create(client)
        res = client.get(f"{JOBS}/{created['id']}")
        assert res.status_code == 200
        assert res.json() == created

    def test_unknown_is_404(self, client):
        res = client.get(f"{JOBS}/{uuid.uuid4()}")
        assert res.status_code == 404
        assert res.json() == {"detail": "Job not found"}

    def test_malformed_id_is_422(self, client):
        assert client.get(f"{JOBS}/not-a-uuid").status_code == 422


# ---------- list / search / filter / paginate ----------


def seed(client):
    boss = make_employee(client, 1)
    a = create(client, 1, title="Backend Engineer", department="Engineering", location="Lahore")
    b = create(client, 2, title="Sales Executive", department="Sales", location="Karachi",
               employment_type="contract", hiring_manager_id=boss["id"])
    c = create(client, 3, title="Product Designer", department="Design", location="Remote",
               employment_type="part_time")
    client.post(f"{JOBS}/{a['id']}/status", json={"status": "open"})
    client.post(f"{JOBS}/{b['id']}/status", json={"status": "open"})
    client.post(f"{JOBS}/{b['id']}/status", json={"status": "on_hold"})
    return boss, a, b, c


class TestList:
    def test_empty(self, client):
        assert client.get(JOBS).json() == {
            "items": [],
            "total": 0,
            "page": 1,
            "page_size": 20,
            "status_counts": {"draft": 0, "open": 0, "on_hold": 0, "closed": 0},
        }

    def test_newest_first(self, client):
        ids = [create(client, n)["id"] for n in (1, 2, 3)]
        assert [j["id"] for j in client.get(JOBS).json()["items"]] == ids[::-1]

    def test_pagination(self, client):
        for n in range(5):
            create(client, n)
        p1 = client.get(JOBS, params={"page": 1, "page_size": 2}).json()
        p3 = client.get(JOBS, params={"page": 3, "page_size": 2}).json()
        assert p1["total"] == 5 and len(p1["items"]) == 2
        assert len(p3["items"]) == 1
        seen = {j["id"] for page in (1, 2, 3) for j in client.get(JOBS, params={"page": page, "page_size": 2}).json()["items"]}
        assert len(seen) == 5  # no duplicates or gaps across pages

    def test_search_title_department_location(self, client):
        seed(client)
        assert client.get(JOBS, params={"q": "backend"}).json()["total"] == 1  # title
        assert client.get(JOBS, params={"q": "sales"}).json()["total"] == 1  # department
        assert client.get(JOBS, params={"q": "karachi"}).json()["total"] == 1  # location
        assert client.get(JOBS, params={"q": "ENGINEER"}).json()["total"] == 1  # case-insensitive
        assert client.get(JOBS, params={"q": "nothing-matches"}).json()["total"] == 0

    @pytest.mark.parametrize("wildcard", ["%", "_", "\\"])
    def test_search_wildcards_are_literal(self, client, wildcard):
        seed(client)
        assert client.get(JOBS, params={"q": wildcard}).json()["total"] == 0

    def test_filters(self, client):
        boss, *_ = seed(client)
        assert client.get(JOBS, params={"status": "open"}).json()["total"] == 1
        assert client.get(JOBS, params={"status": "on_hold"}).json()["total"] == 1
        assert client.get(JOBS, params={"status": "draft"}).json()["total"] == 1
        assert client.get(JOBS, params={"status": "closed"}).json()["total"] == 0
        assert client.get(JOBS, params={"department": "SALES"}).json()["total"] == 1  # case-insens.
        assert client.get(JOBS, params={"employment_type": "contract"}).json()["total"] == 1
        assert client.get(JOBS, params={"hiring_manager_id": boss["id"]}).json()["total"] == 1

    def test_filters_combine(self, client):
        seed(client)
        both = client.get(JOBS, params={"department": "engineering", "status": "open"}).json()
        assert both["total"] == 1
        none = client.get(JOBS, params={"department": "engineering", "status": "on_hold"}).json()
        assert none["total"] == 0

    def test_status_counts_follow_filters_but_ignore_the_status_filter(self, client):
        seed(client)
        assert client.get(JOBS).json()["status_counts"] == {
            "draft": 1, "open": 1, "on_hold": 1, "closed": 0,
        }
        # Filtering by status does not change the tab counts...
        filtered = client.get(JOBS, params={"status": "open"}).json()
        assert filtered["total"] == 1
        assert filtered["status_counts"] == {"draft": 1, "open": 1, "on_hold": 1, "closed": 0}
        # ...but other filters do.
        eng = client.get(JOBS, params={"department": "engineering"}).json()["status_counts"]
        assert eng == {"draft": 0, "open": 1, "on_hold": 0, "closed": 0}

    def test_list_includes_hiring_manager(self, client):
        boss, _, b, _ = seed(client)
        row = next(j for j in client.get(JOBS).json()["items"] if j["id"] == b["id"])
        assert row["hiring_manager"]["id"] == boss["id"]

    @pytest.mark.parametrize(
        "params",
        [{"page": 0}, {"page_size": 0}, {"page_size": 101}, {"status": "archived"},
         {"employment_type": "freelance"}, {"hiring_manager_id": "x"}, {"q": "q" * 101}],
    )
    def test_invalid_query_params(self, client, params):
        assert client.get(JOBS, params=params).status_code == 422


class TestDepartments:
    def test_union_of_jobs_and_employees_deduplicated(self, client):
        make_employee(client, 1, department="Human Resources")
        make_employee(client, 2, department="engineering")
        create(client, 1, department="Engineering")
        create(client, 2, department="Sales")
        # "engineering" (employee) and "Engineering" (job) are one department. The kept spelling is
        # deterministic: the one that sorts first, so the capitalised form wins.
        assert client.get(f"{JOBS}/departments").json() == ["Engineering", "Human Resources", "Sales"]

    def test_empty(self, client):
        assert client.get(f"{JOBS}/departments").json() == []


# ---------- update ----------


class TestUpdate:
    def test_partial_update_changes_only_sent_fields(self, client):
        created = create(client)
        res = client.patch(f"{JOBS}/{created['id']}", json={"title": "Staff Engineer", "openings": 5})
        assert res.status_code == 200
        body = res.json()
        assert body["title"] == "Staff Engineer" and body["openings"] == 5
        assert body["department"] == created["department"]
        assert body["required_skills"] == created["required_skills"]
        assert body["status"] == "draft"

    def test_skills_are_normalised_on_update(self, client):
        created = create(client)
        res = client.patch(f"{JOBS}/{created['id']}", json={"required_skills": [" go ", "GO", "rust"]})
        assert res.json()["required_skills"] == ["go", "rust"]

    def test_null_clears_optional_fields(self, client):
        created = create(client, hiring_manager_id=make_employee(client)["id"])
        res = client.patch(
            f"{JOBS}/{created['id']}",
            json={"min_experience_years": None, "salary_min": None, "salary_max": None,
                  "salary_currency": None, "hiring_manager_id": None},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["min_experience_years"] is None
        assert body["salary_min"] is None and body["salary_currency"] is None
        assert body["hiring_manager"] is None

    @pytest.mark.parametrize(
        "field",
        ["title", "department", "location", "employment_type", "description",
         "required_skills", "nice_to_have_skills", "openings"],
    )
    def test_required_fields_cannot_be_null(self, client, field):
        created = create(client)
        assert client.patch(f"{JOBS}/{created['id']}", json={field: None}).status_code == 422

    def test_salary_rules_use_the_merged_values(self, client):
        created = create(client, salary_min=100000, salary_max=200000, salary_currency="PKR")
        url = f"{JOBS}/{created['id']}"
        # only raising the minimum above the existing maximum must fail
        assert client.patch(url, json={"salary_min": 250000}).status_code == 422
        # lowering the max below the existing min must fail
        assert client.patch(url, json={"salary_max": 50000}).status_code == 422
        # removing the currency while amounts remain must fail
        assert client.patch(url, json={"salary_currency": None}).status_code == 422
        # a consistent change works
        ok = client.patch(url, json={"salary_min": 150000, "salary_max": 300000})
        assert ok.status_code == 200
        assert client.get(url).json()["salary_max"] == 300000

    @pytest.mark.parametrize(
        "override",
        [{"title": "ab"}, {"openings": 0}, {"salary_currency": "XX"}, {"status": "open"},
         {"id": str(uuid.uuid4())}, {"hiring_manager_id": "nope"}, {"unknown": 1}],
    )
    def test_invalid_updates_rejected(self, client, override):
        created = create(client)
        assert client.patch(f"{JOBS}/{created['id']}", json=override).status_code == 422

    def test_changing_the_hiring_manager_returns_the_new_one_not_a_stale_copy(self, client):
        first, second = make_employee(client, 11), make_employee(client, 12)
        job = create(client, hiring_manager_id=first["id"])
        res = client.patch(f"{JOBS}/{job['id']}", json={"hiring_manager_id": second["id"]})
        assert res.json()["hiring_manager"]["id"] == second["id"]
        assert client.get(f"{JOBS}/{job['id']}").json()["hiring_manager"]["id"] == second["id"]

    def test_hiring_manager_rules(self, client):
        created = create(client)
        url = f"{JOBS}/{created['id']}"
        assert client.patch(url, json={"hiring_manager_id": str(uuid.uuid4())}).status_code == 422
        gone = make_employee(client, 7)
        client.patch(f"/api/v1/employees/{gone['id']}", json={"employment_status": "terminated"})
        assert client.patch(url, json={"hiring_manager_id": gone["id"]}).status_code == 422
        active = make_employee(client, 8)
        assert client.patch(url, json={"hiring_manager_id": active["id"]}).status_code == 200

    def test_unknown_job_is_404(self, client):
        assert client.patch(f"{JOBS}/{uuid.uuid4()}", json={"title": "Anything"}).status_code == 404

    def test_updated_at_moves_forward(self, client):
        created = create(client)
        updated = client.patch(f"{JOBS}/{created['id']}", json={"title": "Different Title"}).json()
        assert updated["updated_at"] >= created["updated_at"]


# ---------- delete ----------


class TestDelete:
    def test_draft_can_be_deleted(self, client):
        created = create(client)
        assert client.delete(f"{JOBS}/{created['id']}").status_code == 204
        assert client.get(f"{JOBS}/{created['id']}").status_code == 404

    @pytest.mark.parametrize("target", ["open", "on_hold", "closed"])
    def test_published_jobs_cannot_be_deleted(self, client, target):
        created = create(client)
        url = f"{JOBS}/{created['id']}"
        client.post(f"{url}/status", json={"status": "open"})
        if target != "open":
            client.post(f"{url}/status", json={"status": target})
        res = client.delete(url)
        assert res.status_code == 409
        assert "Close the job instead" in res.json()["detail"]
        assert client.get(url).status_code == 200  # still there

    def test_unknown_is_404(self, client):
        assert client.delete(f"{JOBS}/{uuid.uuid4()}").status_code == 404


# ---------- database-level integrity ----------


class TestDatabaseConstraints:
    def _job(self, **fields):
        base = dict(title="T", department="D", location="L", employment_type="full_time",
                    description="", required_skills=[], nice_to_have_skills=[], openings=1,
                    status="draft")
        base.update(fields)
        return JobPosting(**base)

    def test_openings_must_be_positive(self, session_factory):
        with session_factory() as db:
            db.add(self._job(openings=0))
            with pytest.raises(IntegrityError):
                db.commit()

    def test_salary_range_must_be_ordered(self, session_factory):
        with session_factory() as db:
            db.add(self._job(salary_min=10, salary_max=5, salary_currency="USD"))
            with pytest.raises(IntegrityError):
                db.commit()

    def test_deleting_the_hiring_manager_keeps_the_job(self, client):
        boss = make_employee(client)
        job = create(client, hiring_manager_id=boss["id"])
        assert client.delete(f"/api/v1/employees/{boss['id']}").status_code == 204
        after = client.get(f"{JOBS}/{job['id']}").json()
        assert after["hiring_manager_id"] is None and after["hiring_manager"] is None
