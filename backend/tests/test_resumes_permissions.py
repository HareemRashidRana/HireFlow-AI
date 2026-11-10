"""Who may use the resume endpoints. Direct API calls: the UI is not involved."""

import uuid

import pytest
from sqlalchemy import text

from app.models.user import UserRole
from tests.conftest import sign_in
from tests.resume_files import CV_LINES, make_pdf
from tests.test_applications import make_application
from tests.test_candidates import CANDIDATES, candidate_payload
from tests.test_resumes import PDF, RESUMES, REVIEW, stored_files, upload

A, HR, REC, EMP = UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER, UserRole.EMPLOYEE
ROLES = (A, HR, REC, EMP)


@pytest.fixture
def setup(client_as, make_user, new_client):
    admin = client_as(A)
    cand = admin.post(CANDIDATES, json=candidate_payload(1)).json()

    def as_role(role):
        if role == A:
            return admin
        if role == EMP:
            c = new_client()
            sign_in(c, make_user(EMP, employee_id=None).email)
            return c
        return client_as(role)

    return admin, cand, as_role


def fresh_resume(admin, cand, n=[0]):  # noqa: B006  (a counter so every call uploads a different file)
    n[0] += 1
    return upload(admin, cand["id"], data=make_pdf([*CV_LINES, f"unique {n[0]} {uuid.uuid4()}"])).json()["id"]


# (description, how to call, {role: expected status}). `rid` is a fresh resume for state-changing calls.
CASES = [
    ("list", lambda c, cand, rid: c.get(f"{CANDIDATES}/{cand['id']}/resumes"), {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("upload", lambda c, cand, rid: upload(c, cand["id"], data=make_pdf([*CV_LINES, str(uuid.uuid4())])), {A: 201, HR: 201, REC: 201, EMP: 403}),
    ("get", lambda c, cand, rid: c.get(f"{RESUMES}/{rid}"), {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("parsed data", lambda c, cand, rid: c.get(f"{RESUMES}/{rid}/parsed"), {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("download", lambda c, cand, rid: c.get(f"{RESUMES}/{rid}/download"), {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("parse / retry", lambda c, cand, rid: c.post(f"{RESUMES}/{rid}/parse"), {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("review", lambda c, cand, rid: c.put(f"{RESUMES}/{rid}/review", json=REVIEW), {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("activate", lambda c, cand, rid: c.post(f"{RESUMES}/{rid}/activate"), {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("link to application", lambda c, cand, rid: c.patch(f"{RESUMES}/{rid}", json={"application_id": None}), {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("delete", lambda c, cand, rid: c.delete(f"{RESUMES}/{rid}"), {A: 204, HR: 204, REC: 403, EMP: 403}),
]
PARAMS = [(d, role, exp[role], call) for d, call, exp in CASES for role in ROLES]


@pytest.mark.parametrize("desc,role,expected,call", PARAMS, ids=[f"{d}|{r.value}" for d, r, _, _ in PARAMS])
def test_permission_matrix(setup, desc, role, expected, call):
    admin, cand, as_role = setup
    rid = fresh_resume(admin, cand)
    res = call(as_role(role), cand, rid)
    assert res.status_code == expected, f"{desc} as {role.value}: {res.status_code} {res.text[:200]}"


def test_a_forbidden_request_changes_nothing_and_leaks_nothing(setup, session_factory):
    admin, cand, as_role = setup
    rid = fresh_resume(admin, cand)
    before = len(stored_files())
    with session_factory() as db:
        events_before = db.scalar(text("select count(*) from candidate_audit_events"))
    for who in (as_role(EMP), as_role(REC)):
        who.delete(f"{RESUMES}/{rid}")
    emp = as_role(EMP)
    res = emp.get(f"{RESUMES}/{rid}/download")
    assert res.status_code == 403 and cand["email"] not in res.text and res.content[:5] != b"%PDF-"
    emp.put(f"{RESUMES}/{rid}/review", json=REVIEW)
    emp.post(f"{RESUMES}/{rid}/parse")
    upload(emp, cand["id"], data=make_pdf(["something else"]))
    assert len(stored_files()) == before and admin.get(f"{RESUMES}/{rid}").json()["reviewed"] is False
    with session_factory() as db:
        assert db.scalar(text("select count(*) from candidate_audit_events")) == events_before  # nothing was logged either


def test_guessing_ids_gets_an_employee_nothing(setup):
    admin, cand, as_role = setup
    emp = as_role(EMP)
    for _ in range(5):
        assert emp.get(f"{RESUMES}/{uuid.uuid4()}").status_code == 403  # the role check comes before any lookup
    rid = fresh_resume(admin, cand)
    assert emp.get(f"{RESUMES}/{rid}").status_code == 403 and emp.get(f"{RESUMES}/{rid}/parsed").status_code == 403


def test_a_resume_is_only_listed_under_its_own_candidate(setup):
    admin, cand, as_role = setup
    other = admin.post(CANDIDATES, json=candidate_payload(2)).json()
    rid = fresh_resume(admin, cand)
    listing = as_role(REC).get(f"{CANDIDATES}/{other['id']}/resumes").json()
    assert listing["total"] == 0 and rid not in str(listing)
    assert as_role(REC).get(f"{RESUMES}/{rid}").json()["candidate_id"] == cand["id"]


def test_the_candidate_in_the_url_cannot_be_used_to_reach_another_candidates_application(setup):
    admin, cand, as_role = setup
    app = make_application(admin, 5)
    res = upload(as_role(REC), cand["id"], data=make_pdf(["x y z"]), application_id=app["id"])
    assert res.status_code == 422 and app["candidate"]["email"] not in res.text


PROTECTED = [
    ("get", f"{CANDIDATES}/{uuid.uuid4()}/resumes"), ("post", f"{CANDIDATES}/{uuid.uuid4()}/resumes"),
    ("get", f"{RESUMES}/{uuid.uuid4()}"), ("get", f"{RESUMES}/{uuid.uuid4()}/parsed"), ("get", f"{RESUMES}/{uuid.uuid4()}/download"),
    ("post", f"{RESUMES}/{uuid.uuid4()}/parse"), ("put", f"{RESUMES}/{uuid.uuid4()}/review"),
    ("post", f"{RESUMES}/{uuid.uuid4()}/activate"), ("patch", f"{RESUMES}/{uuid.uuid4()}"), ("delete", f"{RESUMES}/{uuid.uuid4()}"),
]


@pytest.mark.parametrize("method,path", PROTECTED)
def test_anonymous_requests_get_401(anon, method, path):
    kwargs = {"files": {"file": ("a.pdf", b"%PDF-1.4", PDF)}} if method == "post" and path.endswith("/resumes") else {}
    res = getattr(anon, method)(path, **kwargs)
    assert res.status_code == 401 and res.headers["www-authenticate"] == "Bearer"


def test_a_user_who_must_change_their_password_is_blocked(new_client, make_user, setup):
    admin, cand, _ = setup
    rid = fresh_resume(admin, cand)
    c = new_client()
    sign_in(c, make_user(REC, must_change_password=True).email)
    assert c.get(f"{RESUMES}/{rid}/download").status_code == 403


def test_a_deactivated_recruiter_loses_file_access_immediately(setup, client_as):
    admin, cand, _ = setup
    rid = fresh_resume(admin, cand)
    rec = client_as(REC)
    assert rec.get(f"{RESUMES}/{rid}/download").status_code == 200
    admin.patch(f"/api/v1/users/{rec.user.id}", json={"is_active": False})
    assert rec.get(f"{RESUMES}/{rid}/download").status_code == 401


def test_demoting_hr_removes_delete_rights_at_once(setup, client_as):
    admin, cand, _ = setup
    rid = fresh_resume(admin, cand)
    hr = client_as(HR)
    assert hr.get(f"{RESUMES}/{rid}").status_code == 200
    admin.patch(f"/api/v1/users/{hr.user.id}", json={"role": "recruiter"})
    assert hr.delete(f"{RESUMES}/{rid}").status_code == 403


def test_the_uploader_is_recorded_from_the_session_not_the_request(setup, client_as):
    admin, cand, _ = setup
    rec = client_as(REC)
    res = rec.post(f"{CANDIDATES}/{cand['id']}/resumes", files={"file": ("a.pdf", make_pdf(["q"]), PDF)},
                   data={"uploaded_by_id": str(admin.user.id)})
    assert res.status_code == 201 and res.json()["uploaded_by"]["email"] == rec.user.email
