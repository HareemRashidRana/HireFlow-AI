"""Candidates: create, read, list/search/filter/paginate, update, delete, consent and validation."""

import logging
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.models.candidate import Candidate
from tests.conftest import employee_payload

CANDIDATES = "/api/v1/candidates"
TODAY = datetime.now(UTC).date()


def candidate_payload(n: int = 1, **overrides) -> dict:
    payload = {
        "first_name": "Sana",
        "last_name": f"Iqbal{n}",
        "email": f"sana.iqbal{n}@example.com",
        "phone": "+92 300 1234567",
        "location": "Lahore, Pakistan",
        "current_title": "Backend Developer",
        "current_company": "Acme Ltd",
        "source": "linkedin",
        "consent_basis": "legitimate_interest",
        "consent_date": TODAY.isoformat(),
    }
    payload.update(overrides)
    return payload


def create(client, n: int = 1, **overrides) -> dict:
    res = client.post(CANDIDATES, json=candidate_payload(n, **overrides))
    assert res.status_code == 201, res.text
    return res.json()


# ---------- create ----------


class TestCreate:
    def test_creates_a_candidate(self, client):
        res = client.post(CANDIDATES, json=candidate_payload())
        assert res.status_code == 201
        body = res.json()
        assert uuid.UUID(body["id"])
        assert body["first_name"] == "Sana"
        assert body["email"] == "sana.iqbal1@example.com"
        assert body["source"] == "linkedin"
        assert body["consent_basis"] == "legitimate_interest"
        assert body["consent_basis_note"] is None
        assert body["anonymized_at"] is None
        assert body["created_at"] and body["updated_at"] and body["last_activity_at"]

    def test_minimal_payload(self, client):
        res = client.post(
            CANDIDATES,
            json={
                "first_name": "A",
                "last_name": "B",
                "email": "ab@example.com",
                "source": "direct",
                "consent_basis": "pre_contract_steps",
                "consent_date": TODAY.isoformat(),
            },
        )
        assert res.status_code == 201
        body = res.json()
        assert body["phone"] is None and body["location"] is None
        assert body["current_title"] is None and body["current_company"] is None

    def test_trims_text_and_lowercases_email(self, client):
        body = create(
            client,
            first_name="  Sana ",
            last_name=" Iqbal  ",
            email="  Sana.Iqbal@Example.COM ".strip(),
            location="  Karachi  ",
        )
        assert (body["first_name"], body["last_name"]) == ("Sana", "Iqbal")
        assert body["email"] == "sana.iqbal@example.com"
        assert body["location"] == "Karachi"

    @pytest.mark.parametrize("field", ["phone", "location", "current_title", "current_company"])
    @pytest.mark.parametrize("blank", ["", "   "])
    def test_blank_optional_text_becomes_null(self, client, field, blank):
        assert create(client, **{field: blank})[field] is None

    @pytest.mark.parametrize("basis", ["consent", "legitimate_interest", "pre_contract_steps"])
    def test_each_basis_is_accepted(self, client, basis):
        assert create(client, consent_basis=basis)["consent_basis"] == basis

    def test_other_basis_needs_an_explanation(self, client):
        res = client.post(CANDIDATES, json=candidate_payload(consent_basis="other"))
        assert res.status_code == 422
        ok = create(client, consent_basis="other", consent_basis_note="Referred by a partner firm")
        assert ok["consent_basis_note"] == "Referred by a partner firm"

    def test_explanation_only_allowed_for_other(self, client):
        res = client.post(CANDIDATES, json=candidate_payload(consent_basis_note="why"))
        assert res.status_code == 422

    def test_consent_is_never_assumed(self, client):
        payload = candidate_payload()
        del payload["consent_basis"]
        assert client.post(CANDIDATES, json=payload).status_code == 422  # no silent default

    def test_consent_date_may_be_today_or_earlier_but_not_future(self, client):
        assert create(client, 1, consent_date=TODAY.isoformat())
        assert create(client, 2, consent_date=(TODAY - timedelta(days=400)).isoformat())
        future = (TODAY + timedelta(days=2)).isoformat()
        assert client.post(CANDIDATES, json=candidate_payload(3, consent_date=future)).status_code == 422

    def test_the_date_check_allows_for_time_zones_but_not_real_future_dates(self, client, monkeypatch):
        """Late in the UTC day, a user east of UTC already sees "tomorrow": that must be accepted."""
        from app.core import security

        monkeypatch.setattr(security, "utcnow", lambda: datetime(2026, 3, 15, 23, 30, tzinfo=UTC))
        # same UTC day, next day (a user in UTC+5 at local 04:30), and the day before: all fine
        for n, day in enumerate(("2026-03-14", "2026-03-15", "2026-03-16"), start=1):
            res = client.post(CANDIDATES, json=candidate_payload(n, consent_date=day))
            assert res.status_code == 201, (day, res.text)
        # two days ahead is genuinely in the future in every time zone
        too_far = client.post(CANDIDATES, json=candidate_payload(9, consent_date="2026-03-17"))
        assert too_far.status_code == 422
        assert "future" in str(too_far.json())

    def test_the_same_time_zone_allowance_applies_when_editing(self, client, monkeypatch):
        from app.core import security

        monkeypatch.setattr(security, "utcnow", lambda: datetime(2026, 3, 15, 23, 30, tzinfo=UTC))
        created = create(client, consent_date="2026-03-15")
        url = f"{CANDIDATES}/{created['id']}"
        assert client.patch(url, json={"consent_date": "2026-03-16"}).status_code == 200
        assert client.patch(url, json={"consent_date": "2026-03-17"}).status_code == 422

    @pytest.mark.parametrize(
        "override",
        [
            {"first_name": ""},
            {"first_name": "   "},
            {"first_name": "x" * 101},
            {"last_name": ""},
            {"last_name": "x" * 101},
            {"email": "not-an-email"},
            {"email": "x@y"},
            {"phone": "abc"},
            {"phone": "12"},
            {"location": "l" * 151},
            {"current_title": "t" * 151},
            {"current_company": "c" * 151},
            {"source": "billboard"},
            {"consent_basis": "vibes"},
            {"consent_basis": "other", "consent_basis_note": "n" * 201},
            {"consent_date": "not-a-date"},
            {"consent_date": None},
        ],
    )
    def test_invalid_input_rejected_and_nothing_saved(self, client, override):
        res = client.post(CANDIDATES, json=candidate_payload(**override))
        assert res.status_code == 422, res.text
        assert client.get(CANDIDATES).json()["total"] == 0

    @pytest.mark.parametrize(
        "field",
        # Data we deliberately do not collect. Sending it must be refused, not silently stored.
        ["date_of_birth", "gender", "nationality", "photo", "national_id", "address",
         "salary_expectation", "marital_status", "religion", "id", "retain_until",
         "last_activity_at", "anonymized_at", "created_by_id"],
    )
    def test_sensitive_and_system_fields_are_refused(self, client, field):
        res = client.post(CANDIDATES, json=candidate_payload(**{field: "x"}))
        assert res.status_code == 422
        assert client.get(CANDIDATES).json()["total"] == 0

    @pytest.mark.parametrize(
        "field", ["first_name", "last_name", "email", "source", "consent_basis", "consent_date"]
    )
    def test_required_fields(self, client, field):
        payload = candidate_payload()
        del payload[field]
        assert client.post(CANDIDATES, json=payload).status_code == 422

    def test_response_has_no_employee_or_internal_fields(self, client):
        body = create(client)
        assert not {"employee_id", "created_by_id", "password"} & body.keys()


class TestDuplicates:
    def test_duplicate_email_is_a_conflict(self, client):
        create(client)
        res = client.post(CANDIDATES, json=candidate_payload(2, email="sana.iqbal1@example.com"))
        assert res.status_code == 409
        assert res.json()["detail"] == "A candidate with this email already exists"

    def test_duplicate_detection_ignores_case(self, client):
        create(client)
        res = client.post(CANDIDATES, json=candidate_payload(2, email="SANA.IQBAL1@EXAMPLE.COM"))
        assert res.status_code == 409

    def test_email_lookup_finds_the_existing_candidate(self, client):
        created = create(client)
        found = client.get(CANDIDATES, params={"email": "Sana.Iqbal1@Example.com"}).json()
        assert [c["id"] for c in found["items"]] == [created["id"]]
        assert client.get(CANDIDATES, params={"email": "nobody@example.com"}).json()["total"] == 0

    def test_candidates_are_separate_from_employees(self, client):
        """The same email may exist as an employee: they are unrelated records."""
        emp = client.post("/api/v1/employees", json=employee_payload(1, work_email="same@example.com"))
        assert emp.status_code == 201
        assert create(client, email="same@example.com")["email"] == "same@example.com"
        assert client.get(f"/api/v1/employees/{emp.json()['id']}").status_code == 200
        assert client.get(CANDIDATES).json()["total"] == 1

    def test_candidate_table_has_no_link_to_employees(self):
        columns = {c.name for c in Candidate.__table__.columns}
        assert "employee_id" not in columns and "hired_employee_id" not in columns
        assert not any(fk.column.table.name == "employees" for fk in Candidate.__table__.foreign_keys)


# ---------- retention ----------


class TestRetention:
    """Dates below are fixed and hand-checked, not derived with the code under test."""

    @staticmethod
    def _freeze(monkeypatch, year, month, day):
        from app.core import security

        monkeypatch.setattr(
            security, "utcnow", lambda: datetime(year, month, day, 10, 0, tzinfo=UTC)
        )

    def _create_on(self, client, monkeypatch, y, m, d, n=1):
        self._freeze(monkeypatch, y, m, d)
        return create(client, n, consent_date="2025-01-01")

    def test_default_is_twelve_months_from_creation(self, client, monkeypatch):
        assert settings.CANDIDATE_RETENTION_MONTHS == 12
        body = self._create_on(client, monkeypatch, 2026, 3, 15)
        assert body["last_activity_at"].startswith("2026-03-15")
        assert body["retain_until"] == "2027-03-15"

    def test_month_end_is_clamped_not_an_error(self, client, monkeypatch):
        monkeypatch.setattr(settings, "CANDIDATE_RETENTION_MONTHS", 6)
        assert self._create_on(client, monkeypatch, 2026, 8, 31)["retain_until"] == "2027-02-28"

    def test_leap_year_february(self, client, monkeypatch):
        monkeypatch.setattr(settings, "CANDIDATE_RETENTION_MONTHS", 6)
        assert self._create_on(client, monkeypatch, 2027, 8, 31)["retain_until"] == "2028-02-29"

    def test_feb_29_plus_a_year_is_feb_28(self, client, monkeypatch):
        assert self._create_on(client, monkeypatch, 2028, 2, 29)["retain_until"] == "2029-02-28"

    def test_setting_is_honoured(self, client, monkeypatch):
        monkeypatch.setattr(settings, "CANDIDATE_RETENTION_MONTHS", 24)
        assert self._create_on(client, monkeypatch, 2026, 1, 10)["retain_until"] == "2028-01-10"
        monkeypatch.setattr(settings, "CANDIDATE_RETENTION_MONTHS", 1)
        assert self._create_on(client, monkeypatch, 2026, 12, 31, n=2)["retain_until"] == "2027-01-31"

    def test_retention_setting_is_validated(self):
        from pydantic import ValidationError

        from app.core.config import Settings

        for bad in (0, -1, 121):
            with pytest.raises(ValidationError):
                Settings(CANDIDATE_RETENTION_MONTHS=bad, _env_file=None)
        assert Settings(CANDIDATE_RETENTION_MONTHS=12, _env_file=None).CANDIDATE_RETENTION_MONTHS == 12

    def test_re_recording_the_basis_restarts_the_clock(self, client, clock):
        body = create(client)
        clock.advance(days=200)
        updated = client.patch(f"{CANDIDATES}/{body['id']}", json={"consent_basis": "consent"}).json()
        assert updated["last_activity_at"] > body["last_activity_at"]
        assert updated["retain_until"] > body["retain_until"]

    def test_re_recording_the_consent_date_restarts_the_clock(self, client, clock):
        body = create(client)
        clock.advance(days=100)
        updated = client.patch(
            f"{CANDIDATES}/{body['id']}", json={"consent_date": TODAY.isoformat()}
        ).json()
        assert updated["retain_until"] > body["retain_until"]

    @pytest.mark.parametrize(
        "change",
        [{"phone": "+92 321 7654321"}, {"location": "Karachi"}, {"current_title": "Lead"},
         {"current_company": "New Co"}, {"first_name": "Sanaa"}, {"source": "referral"}],
    )
    def test_routine_edits_do_not_extend_retention(self, client, clock, change):
        """Touching up contact details must not keep someone's data alive indefinitely."""
        body = create(client)
        clock.advance(days=200)
        updated = client.patch(f"{CANDIDATES}/{body['id']}", json=change).json()
        assert updated["last_activity_at"] == body["last_activity_at"]
        assert updated["retain_until"] == body["retain_until"]

    def test_retention_filters(self, client, clock):
        old = create(client, 1)
        clock.advance(days=340)  # 25 days before the 12 month mark
        create(client, 2)
        assert client.get(CANDIDATES, params={"retention": "expiring"}).json()["total"] == 1
        assert client.get(CANDIDATES, params={"retention": "expired"}).json()["total"] == 0
        clock.advance(days=40)  # first candidate is now past its retention date
        expired = client.get(CANDIDATES, params={"retention": "expired"}).json()
        assert [c["id"] for c in expired["items"]] == [old["id"]]
        assert client.get(CANDIDATES).json()["total"] == 2  # still listed, just flagged

    def test_invalid_retention_filter(self, client):
        assert client.get(CANDIDATES, params={"retention": "soon"}).status_code == 422


# ---------- read ----------


class TestRead:
    def test_get_one_includes_consent_details(self, client):
        created = create(client, consent_basis="other", consent_basis_note="Met at a career fair")
        res = client.get(f"{CANDIDATES}/{created['id']}")
        assert res.status_code == 200
        assert res.json() == created
        assert res.json()["phone"] == "+92 300 1234567"

    def test_unknown_is_404(self, client):
        res = client.get(f"{CANDIDATES}/{uuid.uuid4()}")
        assert res.status_code == 404
        assert res.json() == {"detail": "Candidate not found"}

    def test_malformed_id_is_422(self, client):
        assert client.get(f"{CANDIDATES}/not-a-uuid").status_code == 422


# ---------- list ----------


def seed(client):
    a = create(client, 1, first_name="Sana", last_name="Iqbal", email="sana@example.com",
               current_title="Backend Developer", current_company="Acme", source="linkedin")
    b = create(client, 2, first_name="Bilal", last_name="Ahmed", email="bilal@corp.io",
               current_title="Accountant", current_company="Globex", source="referral")
    c = create(client, 3, first_name="Omar", last_name="Farooq", email="omar@example.com",
               current_title="Designer", current_company="Initech", source="agency")
    return a, b, c


class TestList:
    def test_empty(self, client):
        assert client.get(CANDIDATES).json() == {"items": [], "total": 0, "page": 1, "page_size": 20}

    def test_newest_first(self, client):
        ids = [create(client, n)["id"] for n in (1, 2, 3)]
        assert [c["id"] for c in client.get(CANDIDATES).json()["items"]] == ids[::-1]

    def test_list_rows_are_lean_and_omit_phone_and_consent_details(self, client):
        create(client)
        row = client.get(CANDIDATES).json()["items"][0]
        assert "phone" not in row
        assert not {"consent_basis", "consent_basis_note", "consent_date", "anonymized_at"} & row.keys()
        assert {"email", "current_title", "retain_until", "source"} <= row.keys()

    def test_pagination(self, client):
        for n in range(5):
            create(client, n)
        p1 = client.get(CANDIDATES, params={"page": 1, "page_size": 2}).json()
        p3 = client.get(CANDIDATES, params={"page": 3, "page_size": 2}).json()
        assert p1["total"] == 5 and len(p1["items"]) == 2 and len(p3["items"]) == 1
        seen = {
            c["id"]
            for page in (1, 2, 3)
            for c in client.get(CANDIDATES, params={"page": page, "page_size": 2}).json()["items"]
        }
        assert len(seen) == 5

    @pytest.mark.parametrize(
        "term,expected",
        [("sana", 1), ("SANA IQBAL", 1), ("ahmed", 1), ("corp.io", 1), ("accountant", 1),
         ("globex", 1), ("example.com", 2), ("nothing-matches", 0)],
    )
    def test_search_name_email_title_company(self, client, term, expected):
        seed(client)
        assert client.get(CANDIDATES, params={"q": term}).json()["total"] == expected

    @pytest.mark.parametrize("wildcard", ["%", "_", "\\"])
    def test_search_wildcards_are_literal(self, client, wildcard):
        seed(client)
        assert client.get(CANDIDATES, params={"q": wildcard}).json()["total"] == 0

    def test_filter_by_source_and_combine_with_search(self, client):
        seed(client)
        assert client.get(CANDIDATES, params={"source": "referral"}).json()["total"] == 1
        both = client.get(CANDIDATES, params={"source": "linkedin", "q": "sana"}).json()
        assert both["total"] == 1
        none = client.get(CANDIDATES, params={"source": "agency", "q": "sana"}).json()
        assert none["total"] == 0

    def test_anonymized_candidates_are_not_listed(self, client, session_factory):
        a, *_ = seed(client)
        with session_factory() as db:
            row = db.scalar(select(Candidate).where(Candidate.id == uuid.UUID(a["id"])))
            row.anonymized_at = datetime.now(UTC)
            db.commit()
        assert client.get(CANDIDATES).json()["total"] == 2

    @pytest.mark.parametrize(
        "params",
        [{"page": 0}, {"page_size": 0}, {"page_size": 101}, {"source": "tv"}, {"q": "q" * 101}],
    )
    def test_invalid_query_params(self, client, params):
        assert client.get(CANDIDATES, params=params).status_code == 422


# ---------- update ----------


class TestUpdate:
    def test_partial_update(self, client):
        created = create(client)
        res = client.patch(f"{CANDIDATES}/{created['id']}", json={"current_title": "Staff Engineer"})
        assert res.status_code == 200
        body = res.json()
        assert body["current_title"] == "Staff Engineer"
        assert body["email"] == created["email"] and body["phone"] == created["phone"]

    def test_null_clears_optional_fields(self, client):
        created = create(client)
        res = client.patch(
            f"{CANDIDATES}/{created['id']}",
            json={"phone": None, "location": None, "current_title": None, "current_company": None},
        )
        body = res.json()
        assert (body["phone"], body["location"], body["current_title"], body["current_company"]) == (None,) * 4

    @pytest.mark.parametrize(
        "field", ["first_name", "last_name", "email", "source", "consent_basis", "consent_date"]
    )
    def test_required_fields_cannot_be_null(self, client, field):
        created = create(client)
        assert client.patch(f"{CANDIDATES}/{created['id']}", json={field: None}).status_code == 422

    @pytest.mark.parametrize(
        "override",
        [{"email": "nope"}, {"first_name": ""}, {"source": "tv"}, {"consent_basis": "vibes"},
         {"consent_date": (TODAY + timedelta(days=3)).isoformat()}, {"phone": "abc"},
         {"retain_until": "2030-01-01"}, {"anonymized_at": "2026-01-01T00:00:00Z"},
         {"date_of_birth": "1990-01-01"}, {"id": str(uuid.uuid4())}],
    )
    def test_invalid_updates_rejected(self, client, override):
        created = create(client)
        assert client.patch(f"{CANDIDATES}/{created['id']}", json=override).status_code == 422

    def test_email_change_is_lowercased_and_checked_for_duplicates(self, client):
        a, b = create(client, 1), create(client, 2)
        url = f"{CANDIDATES}/{b['id']}"
        assert client.patch(url, json={"email": a["email"].upper()}).status_code == 409
        ok = client.patch(url, json={"email": "NEW.Address@Example.com"})
        assert ok.status_code == 200 and ok.json()["email"] == "new.address@example.com"

    def test_keeping_your_own_email_is_not_a_conflict(self, client):
        created = create(client)
        res = client.patch(f"{CANDIDATES}/{created['id']}", json={"email": created["email"].upper()})
        assert res.status_code == 200

    def test_basis_and_note_stay_consistent(self, client):
        created = create(client)  # legitimate_interest, no note
        url = f"{CANDIDATES}/{created['id']}"
        # switching to "other" without a note is refused
        assert client.patch(url, json={"consent_basis": "other"}).status_code == 422
        # with a note it works
        res = client.patch(url, json={"consent_basis": "other", "consent_basis_note": "Walk-in"})
        assert res.status_code == 200 and res.json()["consent_basis_note"] == "Walk-in"
        # a note cannot be removed while the basis is still "other"
        assert client.patch(url, json={"consent_basis_note": None}).status_code == 422
        # moving away from "other" drops the old explanation automatically
        back = client.patch(url, json={"consent_basis": "consent"})
        assert back.status_code == 200 and back.json()["consent_basis_note"] is None
        # a note on a non-"other" basis is refused
        assert client.patch(url, json={"consent_basis_note": "stray"}).status_code == 422

    def test_unknown_is_404(self, client):
        assert client.patch(f"{CANDIDATES}/{uuid.uuid4()}", json={"location": "x"}).status_code == 404

    def test_anonymized_candidates_cannot_be_edited(self, client, session_factory):
        created = create(client)
        with session_factory() as db:
            row = db.scalar(select(Candidate).where(Candidate.id == uuid.UUID(created["id"])))
            row.anonymized_at = datetime.now(UTC)
            db.commit()
        res = client.patch(f"{CANDIDATES}/{created['id']}", json={"location": "x"})
        assert res.status_code == 409
        assert "anonymized" in res.json()["detail"]


# ---------- delete ----------


class TestDelete:
    def test_delete(self, client):
        created = create(client)
        assert client.delete(f"{CANDIDATES}/{created['id']}").status_code == 204
        assert client.get(f"{CANDIDATES}/{created['id']}").status_code == 404
        # the email is free again
        assert client.post(CANDIDATES, json=candidate_payload()).status_code == 201

    def test_unknown_is_404(self, client):
        assert client.delete(f"{CANDIDATES}/{uuid.uuid4()}").status_code == 404


# ---------- privacy: logs and database integrity ----------


def test_candidate_personal_data_never_reaches_the_logs(client, caplog):
    with caplog.at_level(logging.DEBUG):
        created = create(client, email="very.private@example.com", first_name="Confidential", phone="+92 300 7654321")
        client.post(CANDIDATES, json=candidate_payload(2, email="very.private@example.com"))  # 409
        client.patch(f"{CANDIDATES}/{created['id']}", json={"location": "Secret City"})
        client.delete(f"{CANDIDATES}/{created['id']}")
    for secret in ("very.private", "Confidential", "7654321", "Secret City", "Iqbal"):
        assert secret not in caplog.text


class TestDatabaseConstraints:
    def _row(self, **fields):
        base = dict(first_name="A", last_name="B", email="a@b.co", source="direct",
                    consent_basis="consent", consent_date=TODAY,
                    last_activity_at=datetime.now(UTC), retain_until=TODAY)
        base.update(fields)
        return Candidate(**base)

    def test_other_basis_requires_a_note_even_via_direct_inserts(self, session_factory):
        with session_factory() as db:
            db.add(self._row(consent_basis="other", consent_basis_note=None))
            with pytest.raises(IntegrityError):
                db.commit()

    def test_email_is_unique_at_the_database_level(self, session_factory):
        with session_factory() as db:
            db.add(self._row())
            db.commit()
            db.add(self._row())
            with pytest.raises(IntegrityError):
                db.commit()


class TestExplanationForOtherBasis:
    """The explanation for basis "other" must be real text, enforced by the API AND the database."""

    @staticmethod
    def _row(note, basis="other", n=1):
        return Candidate(
            first_name="A", last_name="B", email=f"probe{n}@example.com", source="direct",
            consent_basis=basis, consent_basis_note=note, consent_date=TODAY,
            last_activity_at=datetime.now(UTC), retain_until=TODAY,
        )

    # --- database level: a direct insert that bypasses the API ---

    @pytest.mark.parametrize("note", [None, "", " ", "   ", "          "], ids=repr)
    def test_database_rejects_a_missing_empty_or_space_only_explanation(self, session_factory, note):
        with session_factory() as db:
            db.add(self._row(note))
            with pytest.raises(IntegrityError):
                db.commit()

    @pytest.mark.parametrize("note", ["Walk-in", "  Met at a career fair  ", "x", "a b"], ids=repr)
    def test_database_accepts_a_real_explanation(self, session_factory, note):
        with session_factory() as db:
            db.add(self._row(note))
            db.commit()
            assert db.scalar(select(Candidate.consent_basis_note)) == note

    @pytest.mark.parametrize("basis", ["consent", "legitimate_interest", "pre_contract_steps"])
    @pytest.mark.parametrize("note", [None, "", "   "], ids=repr)
    def test_other_bases_do_not_need_an_explanation(self, session_factory, basis, note):
        """The rule only applies to "other": other bases are unaffected, whatever the note holds."""
        with session_factory() as db:
            db.add(self._row(note, basis=basis))
            db.commit()

    def test_updating_to_a_blank_explanation_is_rejected_by_the_database_too(self, session_factory):
        with session_factory() as db:
            row = self._row("Walk-in")
            db.add(row)
            db.commit()
            row.consent_basis_note = "   "
            with pytest.raises(IntegrityError):
                db.commit()

    def test_the_migration_and_the_model_define_the_same_constraint(self):
        """The migration was edited by hand: make sure it can never drift from the model."""
        from pathlib import Path

        expression = next(
            c.sqltext.text
            for c in Candidate.__table__.constraints
            if getattr(c, "name", None) == "ck_candidates_basis_note_when_other"
        )
        assert "TRIM(consent_basis_note) <> ''" in expression
        migration = next(Path(__file__).parents[1].glob("alembic/versions/*_add_candidates.py"))
        assert expression in migration.read_text(encoding="utf-8")

    # --- API level: blank text never even reaches the database ---

    @pytest.mark.parametrize("note", ["", "   ", "\t\n ", None], ids=repr)
    def test_api_refuses_a_blank_explanation_on_create(self, client, note):
        res = client.post(
            CANDIDATES, json=candidate_payload(consent_basis="other", consent_basis_note=note)
        )
        assert res.status_code == 422
        assert client.get(CANDIDATES).json()["total"] == 0

    @pytest.mark.parametrize("note", ["", "   ", "\t\n ", None], ids=repr)
    def test_api_refuses_to_blank_the_explanation_on_edit(self, client, note):
        created = create(client, consent_basis="other", consent_basis_note="Walk-in")
        url = f"{CANDIDATES}/{created['id']}"
        res = client.patch(url, json={"consent_basis_note": note})
        assert res.status_code == 422
        assert "Explain the basis" in res.json()["detail"]
        assert client.get(url).json()["consent_basis_note"] == "Walk-in"  # unchanged

    def test_api_trims_a_real_explanation(self, client):
        created = create(client, consent_basis="other", consent_basis_note="  Met at a fair  ")
        assert created["consent_basis_note"] == "Met at a fair"
