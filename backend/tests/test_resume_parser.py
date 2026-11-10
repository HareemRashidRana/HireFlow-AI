"""The deterministic resume parser on controlled fixtures. Just as important as what it finds is what
it must NOT invent."""

from datetime import date

import pytest

from app.services.resume_parser import (
    parse_education,
    parse_email,
    parse_experience,
    parse_name,
    parse_phone,
    parse_resume,
    parse_skills,
    split_sections,
    total_experience,
)

TODAY = date(2026, 11, 10)


def parse(text: str, **kw):
    return parse_resume(text, today=TODAY, **kw)


FULL_CV = """Ayesha Khan
Lahore, Pakistan | +92 300 1234567 | ayesha.khan@example.com

Summary
Backend engineer.

Skills
Languages: Python, Go, SQL
Docker, PostgreSQL; CI/CD

Experience
Senior Software Engineer — Acme Technologies   Jan 2021 – Present
- Built things
Software Engineer
Globex Ltd
Mar 2018 - Dec 2020
Intern, Initech    06/2017 - 02/2018

Education
Bachelor of Science in Computer Science, FAST University  2014 - 2018
"""


class TestFullDocument:
    def test_personal_details(self):
        p = parse(FULL_CV)
        assert p["name"] == {"value": "Ayesha Khan", "confidence": "high"}
        assert p["email"] == {"value": "ayesha.khan@example.com", "confidence": "high"}
        assert p["phone"] == {"value": "+92 300 1234567", "confidence": "high"}

    def test_skills_come_from_the_skills_section_only(self):
        s = parse(FULL_CV)["skills"]
        assert s["values"] == ["Python", "Go", "SQL", "Docker", "PostgreSQL", "CI/CD"]
        assert s["source"] == "skills_section" and s["confidence"] == "high"

    def test_experience_entries_in_three_layouts(self):
        jobs = parse(FULL_CV)["experience"]
        assert [(j["title"], j["company"]) for j in jobs] == [
            ("Senior Software Engineer", "Acme Technologies"),
            ("Software Engineer", "Globex Ltd"),
            ("Intern", "Initech"),
        ]
        assert [(j["start"], j["end"], j["current"]) for j in jobs] == [
            ("2021-01", None, True), ("2018-03", "2020-12", False), ("2017-06", "2018-02", False)]
        assert [j["months"] for j in jobs] == [71, 34, 9]

    def test_total_experience_counts_months_once(self):
        p = parse(FULL_CV)
        assert p["total_experience_months"] == 71 + 34 + 9
        assert p["total_experience_confidence"] == "medium"

    def test_education(self):
        [edu] = parse(FULL_CV)["education"]
        assert edu == {"degree": "Bachelor of Science", "field": "Computer Science",
                       "institution": "FAST University", "start_year": 2014, "end_year": 2018,
                       "confidence": "high"}

    def test_sections_and_no_warnings(self):
        p = parse(FULL_CV)
        assert p["sections_found"] == ["education", "experience", "skills"]
        assert p["warnings"] == [] and p["parser_version"] == 1


class TestNothingIsInvented:
    @pytest.mark.parametrize("text", ["", "   \n\n  ", "Lorem ipsum dolor sit amet.", "1234 5678"])
    def test_text_without_a_resume_structure_yields_nothing(self, text):
        p = parse(text)
        assert p["name"]["value"] is None and p["email"]["value"] is None and p["phone"]["value"] is None
        assert p["skills"]["values"] == [] and p["education"] == [] and p["experience"] == []
        assert p["total_experience_months"] is None
        assert {"no_name", "no_email", "no_phone", "no_experience_section"} <= set(p["warnings"])

    def test_missing_pieces_are_reported_not_filled(self):
        p = parse("Experience\nEngineer, Acme Ltd   2019 - 2021\n")
        assert p["name"]["value"] is None and p["email"]["value"] is None
        assert "no_name" in p["warnings"] and "no_email" in p["warnings"]
        assert "no_skills_section" in p["warnings"] and "no_education_section" in p["warnings"]

    def test_confidence_is_none_when_there_is_no_value(self):
        p = parse("nothing here")
        assert p["name"]["confidence"] is None and p["phone"]["confidence"] is None

    def test_a_name_is_never_taken_from_a_sentence_or_heading(self):
        for first in ["Curriculum Vitae", "Resume", "Software Engineer", "I am a developer", "John", "A B C D E F"]:
            assert parse_name([first, "john@example.com"])["value"] is None, first

    def test_skills_are_not_scraped_from_prose_without_a_known_term(self):
        p = parse("Summary\nI enjoy gardening and long walks.\n")
        assert p["skills"]["values"] == []


class TestEmail:
    def test_first_valid_address_lowercased(self):
        f, w = parse_email("Contact: Ayesha.Khan@Example.COM or other@example.org")
        assert f["value"] == "ayesha.khan@example.com" and w == ["multiple_emails"]

    def test_trailing_punctuation_is_dropped(self):
        assert parse_email("write to me@example.com.")[0]["value"] == "me@example.com"

    @pytest.mark.parametrize("text", ["no at sign here", "user@", "@example.com", "a@b"])
    def test_non_addresses(self, text):
        assert parse_email(text)[0]["value"] is None


class TestPhone:
    @pytest.mark.parametrize("text,expected,conf", [
        ("Call +92 300 1234567 now", "+92 300 1234567", "high"),
        ("Tel: (042) 123-4567", "(042) 123-4567", "medium"),
        ("Mobile 0300-1234567", "0300-1234567", "medium"),
        ("+1 (415) 555-0132", "+1 (415) 555-0132", "high"),
    ])
    def test_phone_numbers(self, text, expected, conf):
        assert parse_phone(text) == {"value": expected, "confidence": conf}

    @pytest.mark.parametrize("text", ["2019 - 2022", "Jan 2019 - Mar 2022", "12345", "version 1.2.3", "ID 123456789012345678", ""])
    def test_not_phone_numbers(self, text):
        assert parse_phone(text)["value"] is None


class TestName:
    @pytest.mark.parametrize("lines,expected,conf", [
        (["Ayesha Khan", "x@y.com"], "Ayesha Khan", "high"),
        (["AYESHA KHAN"], "AYESHA KHAN", "high"),
        (["Ayesha"], None, None),  # one word is not enough to call a name
        (["Mary-Jane O'Neil"], "Mary-Jane O'Neil", "high"),
        (["Zoë Łukasz"], "Zoë Łukasz", "high"),
        (["Mary-Jane O'Neil Smith"], "Mary-Jane O'Neil Smith", "high"),
        (["Curriculum Vitae", "Bilal Ahmed"], "Bilal Ahmed", "medium"),
        (["ayesha khan"], None, None),
    ])
    def test_names(self, lines, expected, conf):
        got = parse_name(lines)
        assert got["value"] == expected and got["confidence"] == conf


class TestSections:
    def test_headings_are_recognised_case_insensitively_with_colons(self):
        s = split_sections(["WORK EXPERIENCE:", "a", "Technical Skills", "b", "EDUCATION", "c"])
        assert s == {"experience": ["a"], "skills": ["b"], "education": ["c"]}

    def test_a_long_line_is_not_a_heading(self):
        assert split_sections(["Experience in building scalable distributed systems for banks"]) == {}


class TestSkills:
    def test_labels_bullets_and_separators(self):
        s = parse_skills("", ["• Languages: Python, Go", "- SQL | Docker ; Git", "Tools: Jira"])
        assert s["values"] == ["Python", "Go", "SQL", "Docker", "Git", "Jira"]

    def test_duplicates_removed_case_insensitively_keeping_first(self):
        assert parse_skills("", ["Python, python, PYTHON, Go"])["values"] == ["Python", "Go"]

    def test_sentences_are_not_skills(self):
        assert parse_skills("", ["I have experience working with many teams across the world."])["values"] == []

    def test_vocabulary_fallback_is_marked_low_confidence(self):
        s = parse_skills("Built APIs in Python and PostgreSQL with Docker.", None)
        assert s["source"] == "vocabulary_match" and s["confidence"] == "low"
        assert {"Python", "PostgreSQL", "Docker"} <= set(s["values"])

    def test_vocabulary_matches_whole_terms_only(self):
        assert parse_skills("javascript and scripting", None)["values"] == ["JavaScript"]
        assert "Go" not in parse_skills("good gopher goal", None)["values"]

    def test_special_character_terms(self):
        v = parse_skills("C++, C#, .NET and Node.js", None)["values"]
        assert {"C++", "C#", ".NET", "Node.js"} <= set(v)

    def test_capped_at_sixty(self):
        assert len(parse_skills("", [", ".join(f"Skill{i}" for i in range(200))])["values"]) == 60


class TestExperience:
    def entries(self, *lines):
        return parse_experience(list(lines), TODAY)

    def test_title_at_company_with_dates_on_the_same_line(self):
        [e] = self.entries("Data Analyst at Initech  Feb 2019 - Mar 2021")
        assert (e["title"], e["company"], e["start"], e["end"]) == ("Data Analyst", "Initech", "2019-02", "2021-03")
        assert e["confidence"] == "high"

    def test_company_then_title_on_separate_lines(self):
        [e] = self.entries("Initech Ltd", "Data Analyst   2019 - 2021")
        assert (e["title"], e["company"]) == ("Data Analyst", "Initech Ltd")

    def test_year_only_dates_are_flagged_as_year_precision(self):
        [e] = self.entries("Software Engineer, Acme Ltd", "2019 - 2021")
        assert e["date_precision"] == "year" and e["start"] == "2019" and e["end"] == "2021"
        assert e["months"] == 36  # years are inclusive and approximate; flagged as such

    @pytest.mark.parametrize("end", ["Present", "present", "Current", "Now", "ongoing", "Till Date"])
    def test_open_ended_jobs_run_to_today(self, end):
        [e] = self.entries(f"Engineer, Acme Ltd   Jan 2026 - {end}")
        assert e["current"] is True and e["end"] is None and e["months"] == 11

    @pytest.mark.parametrize("rng", ["03/2019 - 05/2020", "March 2019 to May 2020", "Mar 2019 – May 2020", "2019-03 - 2020-05", "Mar. 2019 until May 2020"])
    def test_date_formats(self, rng):
        [e] = self.entries(f"Engineer, Acme Ltd   {rng}")
        assert (e["start"], e["end"], e["months"]) == ("2019-03", "2020-05", 15)

    def test_a_range_that_runs_backwards_is_kept_without_months(self):
        [e] = self.entries("Engineer, Acme Ltd   2022 - 2019")
        assert e["months"] is None

    def test_ambiguous_header_keeps_written_order_and_says_so(self):
        [e] = self.entries("Alpha, Beta   2019 - 2021")
        assert (e["title"], e["company"], e["confidence"]) == ("Alpha", "Beta", "low")

    def test_a_dates_only_line_gives_an_entry_with_no_names(self):
        [e] = self.entries("2019 - 2021")
        assert e["title"] is None and e["company"] is None and e["confidence"] == "low"

    def test_prose_dates_in_bullets_are_not_confused_with_titles(self):
        jobs = self.entries("Engineer, Acme Ltd   2019 - 2021", "- Shipped the platform in 2020")
        assert len(jobs) == 1

    def test_overlapping_jobs_are_counted_once(self):
        jobs = self.entries("Engineer, Acme Ltd  Jan 2019 - Dec 2019", "Consultant, Beta Ltd  Jul 2019 - Jun 2020")
        months, conf = total_experience(jobs, TODAY)
        assert months == 18 and conf == "medium"

    def test_gaps_are_not_counted(self):
        jobs = self.entries("Engineer, Acme Ltd  Jan 2018 - Dec 2018", "Engineer, Beta Ltd  Jan 2020 - Dec 2020")
        assert total_experience(jobs, TODAY)[0] == 24

    def test_total_is_year_precision_low_confidence_when_any_job_is_year_only(self):
        jobs = self.entries("Engineer, Acme Ltd  2018 - 2019", "Engineer, Beta Ltd  Jan 2020 - Dec 2020")
        assert total_experience(jobs, TODAY)[1] == "low"

    def test_no_entries_means_no_total(self):
        assert total_experience([], TODAY) == (None, None)


class TestEducation:
    def edu(self, *lines):
        return parse_education(list(lines))

    def test_degree_field_institution_years_on_one_line(self):
        [e] = self.edu("MSc in Data Science, Lahore University of Management Sciences, 2018 - 2020")
        assert (e["degree"], e["field"], e["start_year"], e["end_year"]) == ("MSc", "Data Science", 2018, 2020)
        assert "University" in e["institution"]

    def test_institution_on_the_next_line(self):
        [e] = self.edu("Bachelor of Engineering", "NED University of Engineering", "2012 - 2016")
        assert e["degree"] == "Bachelor of Engineering" and e["institution"] == "NED University of Engineering"
        assert (e["start_year"], e["end_year"]) == (2012, 2016)

    def test_institution_without_a_degree_is_low_confidence(self):
        [e] = self.edu("Government College, 2008 - 2010")
        assert e["degree"] is None and e["institution"] == "Government College" and e["confidence"] == "low"

    def test_two_entries(self):
        e = self.edu("MBA, IBA Karachi Institute of Business, 2020", "BBA, Beaconhouse School System, 2016")
        assert len(e) == 2

    def test_a_single_year_is_the_end_year(self):
        [e] = self.edu("BSc Physics, Punjab University, 2015")
        assert e["start_year"] is None and e["end_year"] == 2015

    def test_nothing_when_no_degree_or_institution(self):
        assert self.edu("Won a chess tournament", "Learned to cook") == []


class TestRobustness:
    def test_extreme_input_is_handled(self):
        text = "Experience\n" + "Engineer, Acme Ltd   2019 - 2021\n" * 300 + "x" * 100_000
        p = parse(text)
        assert len(p["experience"]) == 300  # bounded by the extractor's character limit upstream

    @pytest.mark.parametrize("text", ["\x00\x01\x02", "💥" * 50, "Ａｙｅｓｈａ", "‮evil‬@example.com", "a" * 10000])
    def test_odd_characters_never_crash(self, text):
        assert isinstance(parse(text), dict)

    def test_regex_denial_of_service_inputs_finish_quickly(self):
        import time

        nasty = ["1" * 5000, "-" * 5000, "a@" + "b." * 2500, "2019 " * 3000 + "-", "(" * 3000, "Jan " * 3000]
        start = time.monotonic()
        for text in nasty:
            parse(text)
        assert time.monotonic() - start < 5

    def test_one_enormous_unbroken_line_cannot_hog_the_cpu(self):
        import time

        start = time.monotonic()
        parse("x" * 200_000)
        parse("Experience\n" + "9" * 200_000)
        parse("a" * 100_000 + "@" + "b" * 100_000)
        assert time.monotonic() - start < 3

    def test_each_line_is_read_only_up_to_a_fixed_length(self):
        """Deterministic proof of the CPU guard: text far beyond a real line's length is not read,
        so a hostile single-line file costs the same as a normal one."""
        from app.services.resume_parser import MAX_LINE_CHARS

        inside = "x" * (MAX_LINE_CHARS - 40) + " near@example.com"
        beyond = "x" * (MAX_LINE_CHARS + 50) + " far@example.com"
        assert parse(inside)["email"]["value"] == "near@example.com"
        assert parse(beyond)["email"]["value"] is None
        assert parse(f"{beyond}\nreal@example.com")["email"]["value"] == "real@example.com"  # next line unaffected

    def test_the_total_time_for_hostile_lines_stays_small(self):
        import time

        start = time.monotonic()
        for _ in range(5):
            parse("x" * 200_000)
            parse("a" * 100_000 + "@" + "b" * 100_000)
        assert time.monotonic() - start < 1.0

    def test_result_is_json_serialisable(self):
        import json

        json.dumps(parse(FULL_CV))

    def test_the_same_text_always_gives_the_same_result(self):
        assert parse(FULL_CV) == parse(FULL_CV)

    def test_truncation_is_reported(self):
        assert "text_truncated" in parse(FULL_CV, truncated=True)["warnings"]

    def test_the_parser_never_scores_or_ranks(self):
        keys = set(parse(FULL_CV))
        assert not {"score", "rank", "rating", "recommendation", "decision", "match"} & keys
