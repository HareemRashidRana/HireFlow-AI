"""Dated experience: context only. Overlaps once, nothing guessed, nothing penalised."""

from datetime import date

import pytest

from app.services.screening.experience import Position, format_months, summarize_experience

TODAY = date(2026, 11, 10)


def months(*positions):
    return summarize_experience(tuple(positions), TODAY).dated_months


class TestCounting:
    def test_inclusive_months(self):
        assert months(Position("2018-03", "2020-12")) == 34
        assert months(Position("2020-05", "2020-05")) == 1

    def test_back_to_back_positions_do_not_lose_a_month(self):
        assert months(Position("2018-03", "2020-12"), Position("2021-01", "2021-12")) == 34 + 12

    def test_overlaps_are_counted_once(self):
        assert months(Position("2020-01", "2020-12"), Position("2020-06", "2021-05")) == 17
        assert months(Position("2020-01", "2021-12"), Position("2020-06", "2020-08")) == 24  # nested
        assert months(Position("2020-01", "2020-12"), Position("2020-01", "2020-12")) == 12  # same

    def test_order_does_not_matter(self):
        a, b, c = Position("2010", "2012"), Position("2011-06", "2014-02"), Position("2019", "2020")
        assert months(a, b, c) == months(c, b, a) == months(b, c, a)

    def test_a_current_position_runs_to_today(self):
        assert months(Position("2026-01", None, True)) == 11  # Jan..Nov 2026
        assert months(Position("2026-01", "2020-01", True)) == 11  # the end date is ignored

    def test_year_only_dates_are_mid_year_and_flagged_approximate(self):
        ctx = summarize_experience((Position("2018", "2020"),), TODAY)
        assert ctx.dated_months == 25 and ctx.approximate is True
        exact = summarize_experience((Position("2018-03", "2020-12"),), TODAY)
        assert exact.approximate is False

    def test_a_current_position_with_a_month_start_is_not_flagged(self):
        assert summarize_experience((Position("2020-01", None, True),), TODAY).approximate is False

    def test_nothing_is_counted_for_an_empty_list(self):
        ctx = summarize_experience((), TODAY)
        assert (ctx.dated_months, ctx.positions_total, ctx.positions_counted) == (0, 0, 0)


class TestNothingIsGuessedOrPenalised:
    @pytest.mark.parametrize(
        "start,end",
        [(None, None), (None, "2020"), ("2020", None), ("", "2021"), ("abcd", "2021"),
         ("2020-13", "2021"), ("2020-00", "2021"), ("20", "2021"), ("2020-1", "2021"),
         ("2020-01-01", "2021"), ("1949", "2020"), (2020, "2021"), ("2020", 2021)],
    )
    def test_unusable_dates_are_left_out_not_guessed(self, start, end):
        ctx = summarize_experience((Position(start, end),), TODAY)  # type: ignore[arg-type]
        assert ctx.dated_months == 0 and ctx.positions_counted == 0
        assert ctx.positions_not_counted == 1 and ctx.positions_total == 1

    def test_undated_positions_are_counted_separately_and_do_not_reduce_the_total(self):
        base = summarize_experience((Position("2020", "2022"),), TODAY)
        more = summarize_experience((Position("2020", "2022"), Position(None, None)), TODAY)
        assert more.dated_months == base.dated_months
        assert (more.positions_counted, more.positions_not_counted) == (1, 1)

    def test_gaps_between_positions_are_not_measured_or_penalised(self):
        close = months(Position("2010", "2011"), Position("2012", "2013"))
        far = months(Position("2010", "2011"), Position("2022", "2023"))
        assert close == far

    def test_an_end_before_the_start_is_set_aside_with_a_note(self):
        ctx = summarize_experience((Position("2022", "2020"),), TODAY)
        assert ctx.dated_months == 0 and "invalid_range" in ctx.notes

    def test_future_dates_cannot_inflate_the_figure(self):
        ctx = summarize_experience((Position("2026-01", "2035-01"),), TODAY)
        assert ctx.dated_months == 11 and "future_end_clamped" in ctx.notes
        ctx2 = summarize_experience((Position("2030", "2031"),), TODAY)
        assert ctx2.dated_months == 0 and "future_start" in ctx2.notes

    def test_the_input_type_cannot_carry_titles_or_companies(self):
        assert set(Position.__dataclass_fields__) == {"start", "end", "current"}


class TestFormatting:
    @pytest.mark.parametrize(
        "n,text",
        [(0, "less than a month"), (1, "1 month"), (2, "2 months"), (12, "1 year"),
         (13, "1 year 1 month"), (34, "2 years 10 months"), (120, "10 years")],
    )
    def test_format_months(self, n, text):
        assert format_months(n) == text
