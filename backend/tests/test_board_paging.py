"""The pipeline board at scale: per-column paging, true totals, filters and query counts."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import event

from app.models.application import Application
from app.models.user import UserRole
from tests.test_applications import APPS, apply, make_candidate, move, open_job

BOARD = f"{APPS}/board"


@pytest.fixture
def crowded(client):
    """One job, 12 applicants in 'applied', 3 in 'screening', 1 rejected."""
    job = open_job(client)
    ids = []
    for n in range(1, 17):
        ids.append(apply(client, make_candidate(client, n), job).json()["id"])
    for app_id in ids[:3]:
        move(client, app_id, "screening")
    move(client, ids[3], "rejected", note="No")
    return {"job": job, "ids": ids}


class TestColumnPaging:
    def test_the_board_reports_true_totals_even_when_it_shows_a_page(self, client, crowded):
        cols = client.get(BOARD, params={"page_size": 5}).json()["columns"]
        assert cols["applied"]["total"] == 12 and len(cols["applied"]["items"]) == 5
        assert cols["applied"]["has_more"] is True
        assert cols["screening"]["total"] == 3 and cols["screening"]["has_more"] is False
        assert cols["rejected"]["total"] == 1

    def test_load_more_returns_the_next_cards_without_overlap_or_gaps(self, client, crowded):
        seen = [i["id"] for i in client.get(BOARD, params={"page_size": 5}).json()["columns"]["applied"]["items"]]
        for page in (2, 3):
            col = client.get(f"{BOARD}/applied", params={"page": page, "page_size": 5}).json()
            assert col["total"] == 12 and col["page"] == page
            seen += [i["id"] for i in col["items"]]
        assert len(seen) == 12 and len(set(seen)) == 12  # every application exactly once
        last = client.get(f"{BOARD}/applied", params={"page": 3, "page_size": 5}).json()
        assert len(last["items"]) == 2 and last["has_more"] is False

    def test_the_first_board_page_and_page_one_of_a_column_agree(self, client, crowded):
        from_board = [i["id"] for i in client.get(BOARD, params={"page_size": 5}).json()["columns"]["applied"]["items"]]
        from_column = [i["id"] for i in client.get(f"{BOARD}/applied", params={"page_size": 5}).json()["items"]]
        assert from_board == from_column

    def test_a_page_past_the_end_is_empty_not_an_error(self, client, crowded):
        col = client.get(f"{BOARD}/applied", params={"page": 9, "page_size": 5}).json()
        assert col["items"] == [] and col["total"] == 12 and col["has_more"] is False

    def test_every_application_is_reachable_nothing_is_silently_hidden(self, client, crowded):
        total = 0
        for stage in ("applied", "screening", "rejected"):
            page, got = 1, 0
            while True:
                col = client.get(f"{BOARD}/{stage}", params={"page": page, "page_size": 4}).json()
                got += len(col["items"])
                if not col["has_more"]:
                    break
                page += 1
            assert got == col["total"]
            total += got
        assert total == 16

    def test_the_default_page_size_is_25(self, client, crowded):
        assert client.get(BOARD).json()["per_column_limit"] == 25

    @pytest.mark.parametrize("params", [{"page": 0}, {"page_size": 0}, {"page_size": 51}])
    def test_bad_paging_is_422(self, client, crowded, params):
        assert client.get(f"{BOARD}/applied", params=params).status_code == 422
        if "page_size" in params:
            assert client.get(BOARD, params=params).status_code == 422

    def test_an_unknown_stage_is_422(self, client, crowded):
        assert client.get(f"{BOARD}/promoted").status_code == 422

    def test_cards_carry_title_source_recruiter_and_allowed_stages(self, client, crowded):
        item = client.get(f"{BOARD}/screening").json()["items"][0]
        assert item["candidate"]["current_title"] == "Backend Developer"
        assert item["source"] and item["job"]["title"] and "assigned_recruiter" in item
        assert "events" not in item and "internal_notes" not in item  # never whole histories on cards
        assert "applied" in item["allowed_stages"]


class TestBoardFilters:
    def test_filters_apply_to_totals_and_to_load_more(self, client, crowded):
        other = open_job(client, 2)
        apply(client, make_candidate(client, 99), other)
        by_job = client.get(BOARD, params={"job_id": other["id"]}).json()["columns"]
        assert by_job["applied"]["total"] == 1 and by_job["screening"]["total"] == 0
        col = client.get(f"{BOARD}/applied", params={"job_id": crowded["job"]["id"], "page_size": 50}).json()
        assert col["total"] == 12

    def test_date_filters(self, client, crowded, session_factory):
        with session_factory() as db:
            db.get(Application, uuid.UUID(crowded["ids"][5])).applied_at = datetime(2024, 1, 15, 12, tzinfo=UTC)
            db.commit()
        cols = client.get(BOARD, params={"applied_from": "2024-01-01", "applied_to": "2024-01-31"}).json()["columns"]
        assert cols["applied"]["total"] == 1
        later = client.get(f"{BOARD}/applied", params={"applied_from": "2025-01-01"}).json()
        assert later["total"] == 11

    def test_search_and_recruiter_and_source_filters(self, client, crowded):
        client.patch(f"{APPS}/{crowded['ids'][5]}", json={"assigned_recruiter_id": str(client.user.id)})
        mine = client.get(BOARD, params={"recruiter_id": str(client.user.id)}).json()["columns"]
        assert mine["applied"]["total"] == 1
        assert client.get(BOARD, params={"q": "Iqbal7"}).json()["columns"]["applied"]["total"] >= 1
        assert client.get(BOARD, params={"source": "agency"}).json()["columns"]["applied"]["total"] == 0

    def test_bad_filters_are_422(self, client):
        assert client.get(BOARD, params={"applied_from": "soon"}).status_code == 422
        assert client.get(BOARD, params={"job_id": "x"}).status_code == 422

    def test_the_employee_role_cannot_read_columns(self, client, make_user, new_client):
        from tests.conftest import sign_in

        c = new_client()
        sign_in(c, make_user(UserRole.EMPLOYEE).email)
        assert c.get(f"{BOARD}/applied").status_code == 403


class TestQueryCount:
    """Loading the board must cost the same few queries whether it holds 5 cards or 40 (no N+1)."""

    @staticmethod
    def statements(engine, call):
        seen = []

        def before(_conn, _cursor, statement, *_a):
            seen.append(statement)

        event.listen(engine, "before_cursor_execute", before)
        try:
            call()
        finally:
            event.remove(engine, "before_cursor_execute", before)
        return len(seen)

    def test_the_board_query_count_does_not_grow_with_the_number_of_cards(self, client, engine):
        job = open_job(client)
        for n in range(1, 6):
            apply(client, make_candidate(client, n), job)
        small = self.statements(engine, lambda: client.get(BOARD))
        for n in range(6, 41):
            apply(client, make_candidate(client, n), job)
        large = self.statements(engine, lambda: client.get(BOARD))
        assert large == small, (small, large)

    def test_the_list_query_count_does_not_grow_either(self, client, engine):
        job = open_job(client)
        for n in range(1, 4):
            apply(client, make_candidate(client, n), job)
        small = self.statements(engine, lambda: client.get(APPS, params={"page_size": 50}))
        for n in range(4, 31):
            apply(client, make_candidate(client, n), job)
        large = self.statements(engine, lambda: client.get(APPS, params={"page_size": 50}))
        assert large == small, (small, large)

    def test_the_board_is_a_handful_of_queries(self, client, engine):
        job = open_job(client)
        for n in range(1, 11):
            apply(client, make_candidate(client, n), job)
        assert self.statements(engine, lambda: client.get(BOARD)) <= 8  # auth + totals + 1 per filled stage
