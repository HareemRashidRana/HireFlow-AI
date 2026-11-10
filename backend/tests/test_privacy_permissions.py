"""Who may use the privacy endpoints. Direct API calls: the UI is not involved."""

import uuid

import pytest
from sqlalchemy import text

from app.core.config import settings
from app.models.user import UserRole
from tests.conftest import sign_in
from tests.test_applications import make_application
from tests.test_candidates import CANDIDATES, candidate_payload

A, HR, REC, EMP = UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.RECRUITER, UserRole.EMPLOYEE
ROLES = (A, HR, REC, EMP)
PRIV = "/api/v1/privacy"


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


# (description, method, path-builder, json-builder or None, {role: expected})
MATRIX = [
    ("retention list", "get", lambda c: f"{PRIV}/retention", None, {A: 200, HR: 200, REC: 403, EMP: 403}),
    ("audit trail", "get", lambda c: f"{PRIV}/audit", None, {A: 200, HR: 200, REC: 403, EMP: 403}),
    ("audit for one candidate", "get", lambda c: f"{PRIV}/audit?candidate_id={c['id']}", None, {A: 200, HR: 200, REC: 403, EMP: 403}),
    ("purge preview", "post", lambda c: f"{PRIV}/purge", lambda c: {}, {A: 200, HR: 200, REC: 403, EMP: 403}),
    ("purge for real (switched off)", "post", lambda c: f"{PRIV}/purge", lambda c: {"dry_run": False, "confirm": "PURGE"},
     {A: 409, HR: 403, REC: 403, EMP: 403}),
    ("anonymization preview", "get", lambda c: f"{CANDIDATES}/{c['id']}/anonymization-preview", None, {A: 200, HR: 200, REC: 403, EMP: 403}),
    ("export one", "post", lambda c: f"{CANDIDATES}/{c['id']}/export", lambda c: {"format": "csv"}, {A: 200, HR: 200, REC: 403, EMP: 403}),
    ("export many", "post", lambda c: f"{CANDIDATES}/export", lambda c: {"format": "json"}, {A: 200, HR: 200, REC: 403, EMP: 403}),
    ("view a profile", "get", lambda c: f"{CANDIDATES}/{c['id']}", None, {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("edit a profile", "patch", lambda c: f"{CANDIDATES}/{c['id']}", lambda c: {"location": "X"}, {A: 200, HR: 200, REC: 200, EMP: 403}),
    ("anonymize", "post", lambda c: f"{CANDIDATES}/{c['id']}/anonymize", lambda c: {"confirm": True}, {A: 200, HR: 200, REC: 403, EMP: 403}),
]
CASES = [(m[0], role, m[4][role], m) for m in MATRIX for role in ROLES]


@pytest.mark.parametrize("desc,role,expected,case", CASES, ids=[f"{d}|{r.value}" for d, r, _, _ in CASES])
def test_permission_matrix(setup, desc, role, expected, case):
    _, cand, as_role = setup
    _, method, path_for, body_for, _ = case
    res = getattr(as_role(role), method)(path_for(cand), **({"json": body_for(cand)} if body_for else {}))
    assert res.status_code == expected, f"{desc} as {role.value}: {res.status_code} {res.text[:200]}"


def test_a_recruiter_has_no_privacy_privileges_at_all(setup, session_factory):
    admin, cand, as_role = setup
    rec = as_role(REC)
    for method, path, body in [
        ("post", f"{CANDIDATES}/{cand['id']}/anonymize", {"confirm": True}),
        ("post", f"{CANDIDATES}/{cand['id']}/export", {"format": "csv"}),
        ("post", f"{CANDIDATES}/export", {"format": "csv"}),
        ("post", f"{PRIV}/purge", {"dry_run": False, "confirm": "PURGE"}),
        ("delete", f"{CANDIDATES}/{cand['id']}", None),
    ]:
        res = getattr(rec, method)(path, **({"json": body} if body is not None else {}))
        assert res.status_code == 403, path
    assert admin.get(f"{CANDIDATES}/{cand['id']}").json()["anonymized_at"] is None


def test_forbidden_privacy_requests_change_nothing_and_leak_nothing(setup, session_factory):
    admin, cand, as_role = setup
    with session_factory() as db:
        before = db.scalar(text("select count(*) from candidate_audit_events"))
    for who in (as_role(REC), as_role(EMP)):
        res = who.post(f"{CANDIDATES}/{cand['id']}/anonymize", json={"confirm": True})
        assert res.status_code == 403
        for secret in (cand["email"], cand["first_name"], cand["phone"]):
            assert secret not in res.text
        who.post(f"{CANDIDATES}/{cand['id']}/export", json={"format": "json"})
    with session_factory() as db:
        assert db.scalar(text("select count(*) from candidate_audit_events")) == before
    assert admin.get(f"{CANDIDATES}/{cand['id']}").json()["first_name"] == cand["first_name"]


def test_employees_are_blocked_from_every_candidate_privacy_path_even_for_ids_that_do_not_exist(setup):
    _, _, as_role = setup
    emp = as_role(EMP)
    missing = uuid.uuid4()
    for method, path in [("get", f"{CANDIDATES}/{missing}"), ("get", f"{CANDIDATES}/{missing}/anonymization-preview"),
                         ("post", f"{CANDIDATES}/{missing}/export"), ("post", f"{CANDIDATES}/{missing}/anonymize")]:
        assert getattr(emp, method)(path, **({"json": {"format": "csv", "confirm": True}} if method == "post" else {})).status_code == 403


PROTECTED = [
    ("get", f"{PRIV}/retention"), ("get", f"{PRIV}/audit"), ("post", f"{PRIV}/purge"),
    ("get", f"{CANDIDATES}/{uuid.uuid4()}/anonymization-preview"), ("post", f"{CANDIDATES}/{uuid.uuid4()}/anonymize"),
    ("post", f"{CANDIDATES}/{uuid.uuid4()}/export"), ("post", f"{CANDIDATES}/export"),
]


@pytest.mark.parametrize("method,path", PROTECTED)
def test_anonymous_requests_get_401(anon, method, path):
    res = getattr(anon, method)(path)
    assert res.status_code == 401 and res.headers["www-authenticate"] == "Bearer"


def test_deactivated_hr_loses_privacy_access_immediately(setup, client_as):
    admin, cand, _ = setup
    hr = client_as(HR)
    assert hr.get(f"{PRIV}/retention").status_code == 200
    admin.patch(f"/api/v1/users/{hr.user.id}", json={"is_active": False})
    assert hr.get(f"{PRIV}/retention").status_code == 401
    assert hr.post(f"{CANDIDATES}/{cand['id']}/anonymize", json={"confirm": True}).status_code == 401


def test_demoting_hr_to_recruiter_removes_the_privacy_rights_at_once(setup, client_as):
    admin, cand, _ = setup
    hr = client_as(HR)
    assert hr.post(f"{CANDIDATES}/{cand['id']}/export", json={"format": "csv"}).status_code == 200
    admin.patch(f"/api/v1/users/{hr.user.id}", json={"role": "recruiter"})
    assert hr.post(f"{CANDIDATES}/{cand['id']}/export", json={"format": "csv"}).status_code == 403
    assert hr.get(f"{PRIV}/audit").status_code == 403


def test_a_user_who_must_change_their_password_is_blocked(new_client, make_user):
    user = make_user(HR, must_change_password=True)
    c = new_client()
    sign_in(c, user.email)
    assert c.get(f"{PRIV}/retention").status_code == 403


def test_a_client_cannot_turn_purging_on_itself(setup):
    admin, _, _ = setup
    assert settings.PRIVACY_PURGE_ENABLED is False
    res = admin.post(f"{PRIV}/purge", json={"dry_run": False, "confirm": "PURGE", "purge_enabled": True})
    assert res.status_code == 422  # extra fields are refused, not obeyed
    assert admin.post(f"{PRIV}/purge", json={"dry_run": False, "confirm": "PURGE"}).status_code == 409


def test_malformed_ids_are_rejected_before_anything_runs(setup):
    admin, _, _ = setup
    for path, method in [(f"{CANDIDATES}/1/anonymization-preview", "get"), (f"{CANDIDATES}/../export", "post"),
                         (f"{PRIV}/audit?candidate_id=1%27%20OR%201=1", "get")]:
        res = getattr(admin, method)(path, **({"json": {"format": "csv"}} if method == "post" else {}))
        assert res.status_code in (404, 405, 422)


def test_applications_do_not_expose_privacy_actions_to_recruiters(client_as):
    rec = client_as(REC)
    app = make_application(rec)
    assert rec.post(f"{CANDIDATES}/{app['candidate']['id']}/anonymize", json={"confirm": True}).status_code == 403
