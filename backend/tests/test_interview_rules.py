"""The pure interview rules: time zones (including daylight-saving edges), meeting links, lifecycle."""

from datetime import UTC, datetime, timedelta

import pytest

from app.models.interview import InterviewStatus as S
from app.services import interview_rules as rules


def naive(s: str) -> datetime:
    return datetime.fromisoformat(s)


class TestResolveInstant:
    def test_a_plain_local_time_is_read_in_the_zone(self):
        assert rules.resolve_instant(naive("2026-11-20T10:00"), "Asia/Karachi") == datetime(2026, 11, 20, 5, 0, tzinfo=UTC)
        assert rules.resolve_instant(naive("2026-11-20T10:00"), "UTC") == datetime(2026, 11, 20, 10, 0, tzinfo=UTC)
        assert rules.resolve_instant(naive("2026-07-01T10:00"), "Europe/London") == datetime(2026, 7, 1, 9, 0, tzinfo=UTC)
        assert rules.resolve_instant(naive("2026-01-01T10:00"), "Europe/London") == datetime(2026, 1, 1, 10, 0, tzinfo=UTC)

    def test_a_value_with_an_offset_is_converted_not_reinterpreted(self):
        aware = datetime.fromisoformat("2026-11-20T10:00:00+05:00")
        assert rules.resolve_instant(aware, "America/New_York") == datetime(2026, 11, 20, 5, 0, tzinfo=UTC)

    def test_seconds_are_dropped(self):
        assert rules.resolve_instant(naive("2026-11-20T10:00:45"), "UTC").second == 0

    @pytest.mark.parametrize("tz,local", [("Europe/London", "2027-03-28T01:30"), ("America/New_York", "2027-03-14T02:30")])
    def test_a_time_that_does_not_exist_is_refused(self, tz, local):
        with pytest.raises(ValueError, match="does not exist"):
            rules.resolve_instant(naive(local), tz)

    @pytest.mark.parametrize("tz,local", [("Europe/London", "2026-10-25T01:30"), ("America/New_York", "2026-11-01T01:30")])
    def test_a_time_that_happens_twice_is_refused(self, tz, local):
        with pytest.raises(ValueError, match="happens twice"):
            rules.resolve_instant(naive(local), tz)

    def test_the_hour_around_the_changes_is_fine(self):
        assert rules.resolve_instant(naive("2027-03-28T00:30"), "Europe/London") == datetime(2027, 3, 28, 0, 30, tzinfo=UTC)
        assert rules.resolve_instant(naive("2027-03-28T02:30"), "Europe/London") == datetime(2027, 3, 28, 1, 30, tzinfo=UTC)

    def test_an_exact_offset_resolves_an_ambiguous_time(self):
        first = rules.resolve_instant(datetime.fromisoformat("2026-10-25T01:30:00+01:00"), "Europe/London")
        second = rules.resolve_instant(datetime.fromisoformat("2026-10-25T01:30:00+00:00"), "Europe/London")
        assert second - first == timedelta(hours=1)

    @pytest.mark.parametrize("bad", ["Mars/Olympus", "", "not a zone", "../../etc/passwd", "UTC+5"])
    def test_unknown_zones_are_refused(self, bad):
        with pytest.raises(ValueError, match="Unknown time zone"):
            rules.zone(bad)


class TestDisplay:
    def test_local_text_and_offset_follow_the_zone_and_the_date(self):
        winter, summer = datetime(2026, 1, 15, 10, 0, tzinfo=UTC), datetime(2026, 7, 15, 10, 0, tzinfo=UTC)
        assert rules.local_text(winter, "Europe/London") == "2026-01-15T10:00"
        assert rules.local_text(summer, "Europe/London") == "2026-07-15T11:00"
        assert rules.utc_offset(winter, "Europe/London") == "+00:00"
        assert rules.utc_offset(summer, "Europe/London") == "+01:00"
        assert rules.utc_offset(winter, "Asia/Karachi") == "+05:00"
        assert rules.utc_offset(winter, "America/St_Johns") == "-03:30"

    def test_a_late_evening_in_one_zone_is_the_next_day_in_another(self):
        moment = datetime(2026, 11, 20, 20, 30, tzinfo=UTC)
        assert rules.local_text(moment, "UTC")[:10] == "2026-11-20"
        assert rules.local_text(moment, "Asia/Karachi") == "2026-11-21T01:30"


class TestRange:
    base = datetime(2026, 11, 20, 10, 0, tzinfo=UTC)

    def test_valid(self):
        rules.check_range(self.base, self.base + timedelta(minutes=5))
        rules.check_range(self.base, self.base + timedelta(hours=12))

    @pytest.mark.parametrize("minutes,message", [(0, "after the start"), (-30, "after the start"), (4, "at least 5"), (721, "at most 12")])
    def test_invalid(self, minutes, message):
        with pytest.raises(ValueError, match=message):
            rules.check_range(self.base, self.base + timedelta(minutes=minutes))


class TestMeetingLinks:
    @pytest.mark.parametrize("url", ["https://meet.example.com/room/abc", "https://zoom.us/j/12345?from=addon", " https://teams.example.com/l/meetup-join/xyz "])
    def test_plain_https_links_are_accepted(self, url):
        assert rules.clean_meeting_url(url) == url.strip()

    def test_empty_is_none(self):
        assert rules.clean_meeting_url(None) is None and rules.clean_meeting_url("   ") is None

    @pytest.mark.parametrize(
        "url",
        ["http://meet.example.com/x", "ftp://x.example.com", "meet.example.com/room", "javascript:alert(1)", "https://", "https:///path",
         "https://user:pw@meet.example.com/x", "https://user@meet.example.com/x", "https://meet.example.com/x#frag",
         "https://meet.example.com/a b", "https://meet.example.com/" + "a" * 500],
    )
    def test_unsafe_or_malformed_links_are_refused(self, url):
        with pytest.raises(ValueError):
            rules.clean_meeting_url(url)

    @pytest.mark.parametrize("key", ["pwd", "PWD", "password", "passcode", "token", "access_token", "key", "secret", "otp", "jwt", "sig"])
    def test_links_carrying_a_secret_are_refused(self, key):
        with pytest.raises(ValueError, match="password or access token"):
            rules.clean_meeting_url(f"https://meet.example.com/j/123?{key}=abcdef")

    def test_a_secret_is_found_even_among_harmless_parameters(self):
        with pytest.raises(ValueError, match="password or access token"):
            rules.clean_meeting_url("https://meet.example.com/j/1?lang=en&pwd=zzz&x=1")


class TestLifecycle:
    def test_the_whole_table(self):
        allowed = {
            (S.SCHEDULED, S.CONFIRMED), (S.SCHEDULED, S.COMPLETED), (S.SCHEDULED, S.CANCELLED), (S.SCHEDULED, S.RESCHEDULED),
            (S.CONFIRMED, S.COMPLETED), (S.CONFIRMED, S.CANCELLED), (S.CONFIRMED, S.RESCHEDULED),
        }
        for a in S:
            for b in S:
                assert rules.can_transition(a, b) == ((a, b) in allowed), (a, b)

    @pytest.mark.parametrize("end", [S.COMPLETED, S.CANCELLED, S.RESCHEDULED])
    def test_finished_interviews_never_come_back(self, end):
        for target in S:
            assert not rules.can_transition(end, target)


def test_the_rating_scale_is_complete_and_described():
    assert [r["value"] for r in rules.RATING_SCALE] == [1, 2, 3, 4, 5]
    assert all(r["label"] and r["description"] for r in rules.RATING_SCALE)
    assert {a["key"] for a in rules.RATING_AREAS} == {"overall_rating", "technical_rating", "communication_rating", "problem_solving_rating"}
    assert [a["key"] for a in rules.RATING_AREAS if a["required_to_submit"]] == ["overall_rating"]
