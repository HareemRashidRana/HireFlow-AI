import uuid

import pytest

URL = "/api/v1/employees"


def make_payload(**overrides) -> dict:
    payload = {
        "employee_id": "EMP-001",
        "first_name": "Ayesha",
        "last_name": "Khan",
        "work_email": "ayesha.khan@example.com",
        "phone_number": "+92 300 1234567",
        "job_title": "Software Engineer",
        "department": "Engineering",
        "employment_type": "full_time",
        "date_of_joining": "2024-03-01",
    }
    payload.update(overrides)
    return payload


def create(client, **overrides) -> dict:
    res = client.post(URL, json=make_payload(**overrides))
    assert res.status_code == 201, res.text
    return res.json()


# ---------- Create ----------


def test_create_employee(client):
    res = client.post(URL, json=make_payload())
    assert res.status_code == 201
    body = res.json()
    assert uuid.UUID(body["id"])
    assert body["employee_id"] == "EMP-001"
    assert body["employment_status"] == "active"  # default
    assert body["manager_id"] is None
    assert body["created_at"] and body["updated_at"]


def test_create_normalizes_email_and_employee_id(client):
    body = create(client, employee_id=" emp-777 ", work_email="Mixed.Case@Example.COM")
    assert body["employee_id"] == "EMP-777"
    assert body["work_email"] == "mixed.case@example.com"


def test_create_without_optional_fields(client):
    payload = make_payload()
    del payload["phone_number"]
    res = client.post(URL, json=payload)
    assert res.status_code == 201
    assert res.json()["phone_number"] is None


def test_create_with_manager(client):
    boss = create(client)
    report = create(
        client, employee_id="EMP-002", work_email="b@example.com", manager_id=boss["id"]
    )
    assert report["manager_id"] == boss["id"]


# ---------- Read / list ----------


def test_get_employee(client):
    created = create(client)
    res = client.get(f"{URL}/{created['id']}")
    assert res.status_code == 200
    assert res.json() == created


def test_get_unknown_employee_returns_404(client):
    res = client.get(f"{URL}/{uuid.uuid4()}")
    assert res.status_code == 404
    assert res.json() == {"detail": "Employee not found"}


def test_get_with_malformed_id_returns_422(client):
    assert client.get(f"{URL}/not-a-uuid").status_code == 422


def test_list_empty(client):
    res = client.get(URL)
    assert res.status_code == 200
    assert res.json() == {"items": [], "total": 0, "page": 1, "page_size": 20}


def _seed_three(client):
    create(client, employee_id="EMP-001", first_name="Ayesha", last_name="Khan",
           work_email="ayesha@example.com")
    create(client, employee_id="EMP-002", first_name="Bilal", last_name="Ahmed",
           work_email="bilal@example.com", department="Sales", employment_type="contract")
    create(client, employee_id="EMP-003", first_name="Sara", last_name="Malik",
           work_email="sara@corp.io", employment_status="inactive")


def test_list_pagination(client):
    _seed_three(client)
    page1 = client.get(URL, params={"page": 1, "page_size": 2}).json()
    page2 = client.get(URL, params={"page": 2, "page_size": 2}).json()
    assert page1["total"] == 3 and len(page1["items"]) == 2
    assert len(page2["items"]) == 1
    ids = [e["id"] for e in page1["items"] + page2["items"]]
    assert len(set(ids)) == 3  # no duplicates across pages


def test_list_search_by_name_email_and_code(client):
    _seed_three(client)
    by_name = client.get(URL, params={"q": "bilal"}).json()
    by_full_name = client.get(URL, params={"q": "sara malik"}).json()
    by_email = client.get(URL, params={"q": "corp.io"}).json()
    by_code = client.get(URL, params={"q": "emp-001"}).json()
    assert [e["first_name"] for e in by_name["items"]] == ["Bilal"]
    assert by_full_name["total"] == 1
    assert by_email["total"] == 1
    assert by_code["total"] == 1


def test_list_search_treats_wildcards_literally(client):
    _seed_three(client)
    assert client.get(URL, params={"q": "%"}).json()["total"] == 0
    assert client.get(URL, params={"q": "_"}).json()["total"] == 0


def test_list_filters(client):
    _seed_three(client)
    assert client.get(URL, params={"department": "sales"}).json()["total"] == 1
    assert client.get(URL, params={"employment_status": "inactive"}).json()["total"] == 1
    assert client.get(URL, params={"employment_type": "contract"}).json()["total"] == 1


@pytest.mark.parametrize(
    "params",
    [{"page": 0}, {"page_size": 0}, {"page_size": 101}, {"employment_status": "retired"}],
)
def test_list_rejects_invalid_query_params(client, params):
    assert client.get(URL, params=params).status_code == 422


# ---------- Update ----------


def test_update_employee_partial(client):
    created = create(client)
    res = client.patch(
        f"{URL}/{created['id']}",
        json={"job_title": "Senior Engineer", "employment_status": "inactive"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["job_title"] == "Senior Engineer"
    assert body["employment_status"] == "inactive"
    assert body["first_name"] == created["first_name"]  # untouched
    assert body["employee_id"] == created["employee_id"]


def test_update_can_clear_phone_and_manager(client):
    boss = create(client)
    emp = create(client, employee_id="EMP-002", work_email="b@example.com", manager_id=boss["id"])
    res = client.patch(f"{URL}/{emp['id']}", json={"phone_number": None, "manager_id": None})
    assert res.status_code == 200
    assert res.json()["phone_number"] is None
    assert res.json()["manager_id"] is None


def test_update_keeping_own_email_is_not_a_conflict(client):
    created = create(client)
    res = client.patch(f"{URL}/{created['id']}", json={"work_email": "AYESHA.KHAN@example.com"})
    assert res.status_code == 200


def test_update_unknown_employee_returns_404(client):
    assert client.patch(f"{URL}/{uuid.uuid4()}", json={"job_title": "X"}).status_code == 404


def test_update_rejects_null_for_required_field(client):
    created = create(client)
    res = client.patch(f"{URL}/{created['id']}", json={"first_name": None})
    assert res.status_code == 422


def test_update_rejects_unknown_fields(client):
    created = create(client)
    assert client.patch(f"{URL}/{created['id']}", json={"salary": 1}).status_code == 422


def test_update_to_duplicate_values_returns_409(client):
    a = create(client)
    b = create(client, employee_id="EMP-002", work_email="b@example.com")
    dup_id = client.patch(f"{URL}/{b['id']}", json={"employee_id": a["employee_id"]})
    dup_email = client.patch(f"{URL}/{b['id']}", json={"work_email": a["work_email"]})
    assert dup_id.status_code == 409
    assert dup_email.status_code == 409


def test_update_manager_rules(client):
    a = create(client)
    b = create(client, employee_id="EMP-002", work_email="b@example.com", manager_id=a["id"])
    # cannot manage yourself
    assert client.patch(f"{URL}/{a['id']}", json={"manager_id": a["id"]}).status_code == 422
    # cannot create a loop (a -> b while b -> a)
    assert client.patch(f"{URL}/{a['id']}", json={"manager_id": b["id"]}).status_code == 422
    # manager must exist
    unknown = client.patch(f"{URL}/{b['id']}", json={"manager_id": str(uuid.uuid4())})
    assert unknown.status_code == 422


# ---------- Delete ----------


def test_delete_employee(client):
    created = create(client)
    assert client.delete(f"{URL}/{created['id']}").status_code == 204
    assert client.get(f"{URL}/{created['id']}").status_code == 404


def test_delete_unknown_employee_returns_404(client):
    assert client.delete(f"{URL}/{uuid.uuid4()}").status_code == 404


def test_delete_manager_keeps_direct_reports(client):
    boss = create(client)
    emp = create(client, employee_id="EMP-002", work_email="b@example.com", manager_id=boss["id"])
    assert client.delete(f"{URL}/{boss['id']}").status_code == 204
    remaining = client.get(f"{URL}/{emp['id']}")
    assert remaining.status_code == 200
    assert remaining.json()["manager_id"] is None


# ---------- Duplicates ----------


def test_duplicate_employee_id_returns_409(client):
    create(client)
    res = client.post(URL, json=make_payload(work_email="other@example.com"))
    assert res.status_code == 409
    assert "Employee ID" in res.json()["detail"]


def test_duplicate_employee_id_is_case_insensitive(client):
    create(client)
    res = client.post(URL, json=make_payload(employee_id="emp-001", work_email="o@example.com"))
    assert res.status_code == 409


def test_duplicate_email_returns_409_case_insensitive(client):
    create(client)
    res = client.post(
        URL, json=make_payload(employee_id="EMP-002", work_email="AYESHA.KHAN@EXAMPLE.COM")
    )
    assert res.status_code == 409
    assert "email" in res.json()["detail"].lower()


# ---------- Invalid input ----------


@pytest.mark.parametrize(
    "override",
    [
        {"work_email": "not-an-email"},
        {"employment_type": "freelancer"},
        {"employment_status": "retired"},
        {"first_name": "   "},
        {"last_name": ""},
        {"employee_id": "x"},
        {"employee_id": "EMP 001!"},
        {"phone_number": "abc"},
        {"date_of_joining": "not-a-date"},
        {"date_of_joining": "2999-01-01"},
        {"manager_id": "not-a-uuid"},
        {"first_name": "A" * 101},
        {"salary": 100000},  # unknown / unwanted sensitive field
    ],
)
def test_create_rejects_invalid_input(client, override):
    res = client.post(URL, json=make_payload(**override))
    assert res.status_code == 422, res.text
    assert client.get(URL).json()["total"] == 0  # nothing was saved


@pytest.mark.parametrize(
    "missing",
    ["employee_id", "first_name", "last_name", "work_email", "job_title", "department",
     "employment_type", "date_of_joining"],
)
def test_create_requires_mandatory_fields(client, missing):
    payload = make_payload()
    del payload[missing]
    assert client.post(URL, json=payload).status_code == 422


def test_create_with_unknown_manager_returns_422(client):
    res = client.post(URL, json=make_payload(manager_id=str(uuid.uuid4())))
    assert res.status_code == 422
    assert res.json()["detail"] == "Manager not found"
