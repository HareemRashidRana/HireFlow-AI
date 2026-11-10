"""Skill normalisation and the alias table. Symbols that carry meaning must survive; look-alikes
must never merge."""

import random
import string

import pytest

from app.services.screening.aliases import ALIAS_TABLE_VERSION, ALIASES, DISTINCT_SKILLS
from app.services.screening.normalize import MAX_SKILL_CHARS, canonical_skill, normalize_skill


def canon(raw):
    result = canonical_skill(raw)
    return None if result is None else result[0]


class TestNormalisation:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("Python", "python"),
            ("  PYTHON  ", "python"),
            ("Machine   Learning", "machine learning"),
            ("machine\tlearning\n", "machine learning"),
            ("C++", "c++"),
            ("C#", "c#"),
            ("C", "c"),
            (".NET", ".net"),
            ("Node.js", "node.js"),
            ("ASP.NET", "asp.net"),
            ("F#", "f#"),
            ("Objective-C", "objective-c"),
            ("CI / CD", "ci/cd"),
            ("CI/CD", "ci/cd"),
            ("scikit-learn", "scikit-learn"),
            ("Python.", "python"),
            ("Python,", "python"),
            ("C++;", "c++"),
            ("C#.", "c#"),
            ('"Python"', "python"),
            ("'SQL'", "sql"),
            ("“React”", "react"),
            ("• Python", "python"),
            ("- Python", "python"),
            ("* SQL", "sql"),
            ("– Docker", "docker"),
            ("C＋＋", "c++"),  # full-width plus signs fold to the real thing
            ("Ｊａｖａ", "java"),  # full-width letters
            ("Pyth​on", "python"),  # a hidden zero-width character is debris, not a separator
            ("Py\x00thon", "py thon"),  # a real control character does separate
            ("﻿Python", "python"),
            ("Café", "café"),
        ],
    )
    def test_table(self, raw, expected):
        assert normalize_skill(raw) == expected

    @pytest.mark.parametrize("raw", [None, 5, 5.5, [], {}, b"python", True])
    def test_non_text_is_unusable(self, raw):
        assert normalize_skill(raw) is None
        assert canonical_skill(raw) is None

    @pytest.mark.parametrize("raw", ["", " ", "\n\t", "...", "++", "#", "-", "--- ", "•", "​"])
    def test_nothing_skill_like_is_unusable(self, raw):
        assert normalize_skill(raw) is None

    def test_length_limit(self):
        assert normalize_skill("a" * MAX_SKILL_CHARS) == "a" * MAX_SKILL_CHARS
        assert normalize_skill("a" * (MAX_SKILL_CHARS + 1)) is None

    def test_a_leading_dot_is_never_stripped(self):
        assert normalize_skill(".NET") == ".net"
        assert normalize_skill(".NET.") == ".net"
        assert normalize_skill(".net") != normalize_skill("net")

    def test_trailing_plus_and_hash_are_never_stripped(self):
        assert normalize_skill("C++") == "c++"
        assert normalize_skill("C#") == "c#"
        assert normalize_skill("C++++") == "c++++"  # not silently shortened to something real

    def test_idempotent(self):
        rng = random.Random(1234)
        alphabet = string.ascii_letters + string.digits + " .+#-/_,;:'\"•"
        for _ in range(3000):
            raw = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 25)))
            once = normalize_skill(raw)
            if once is not None:
                assert normalize_skill(once) == once, repr(raw)

    def test_never_raises_on_arbitrary_text(self):
        rng = random.Random(99)
        for _ in range(3000):
            raw = "".join(chr(rng.randint(0, 0x2FFF)) for _ in range(rng.randint(0, 30)))
            canonical_skill(raw)  # must not raise


class TestSymbolsAndLookAlikesStayDistinct:
    """The regression cases that motivated the normalisation rules."""

    def test_c_cpp_and_csharp_are_three_different_skills(self):
        assert len({canon("C"), canon("C++"), canon("C#")}) == 3

    def test_spelled_out_forms_resolve_to_the_right_language(self):
        assert canon("C sharp") == canon("C#") == "c#"
        assert canon("CSharp") == "c#"
        assert canon("cpp") == canon("C++") == "c++"
        assert canon("C plus plus") == "c++"
        assert canon("c") == "c"  # plain C is never absorbed by either

    def test_dotnet_stays_dotnet(self):
        assert canon(".NET") == ".net"
        assert canon("dotnet") == ".net"
        assert canon("dot net") == ".net"
        assert canon(".NET") != canon("net")
        assert canon("ASP.NET") != canon(".NET")
        assert canon("VB.NET") != canon(".NET")

    def test_java_never_matches_javascript(self):
        assert canon("Java") != canon("JavaScript")
        assert canon("Java") != canon("JS")
        assert canon("java script") != canon("java")  # "java script" is not an alias either
        assert canon("JS") == canon("JavaScript") == "javascript"

    def test_postgres_and_postgresql_are_aliases(self):
        assert canon("Postgres") == canon("PostgreSQL") == "postgresql"
        assert canon("postgre sql") == "postgresql"
        assert canon("SQL") != canon("PostgreSQL")
        assert canon("SQL") != canon("MySQL")

    def test_node_variants(self):
        assert {canon(x) for x in ("Node", "NodeJS", "node.js", "Node JS", "NODE.JS")} == {"node.js"}
        assert canon("Node.js") != canon("JavaScript")

    def test_react_is_not_react_native_and_angular_is_not_angularjs(self):
        assert canon("React") != canon("React Native")
        assert canon("ReactJS") == canon("React.js") == canon("React")
        assert canon("Angular") != canon("AngularJS")

    def test_go_and_golang(self):
        assert canon("Golang") == canon("Go") == "go"

    def test_case_and_spacing_do_not_matter_but_words_do(self):
        assert canon("machine learning") == canon("Machine  Learning")
        assert canon("machine learning") != canon("machinelearning")
        assert canon("deep learning") != canon("machine learning")

    @pytest.mark.parametrize("a,b", DISTINCT_SKILLS)
    def test_declared_distinct_pairs_stay_distinct(self, a, b):
        assert canon(a) != canon(b)


class TestAliasTableInvariants:
    def test_it_is_small_and_versioned(self):
        assert ALIAS_TABLE_VERSION.startswith("aliases-")
        assert 10 <= len(ALIASES) <= 80  # curated by hand, not a growing dump

    def test_every_alias_key_is_already_normalised(self):
        for alias in ALIASES:
            assert normalize_skill(alias) == alias, alias

    def test_every_canonical_target_is_already_normalised(self):
        for target in ALIASES.values():
            assert normalize_skill(target) == target, target

    def test_a_canonical_name_is_never_itself_an_alias(self):
        assert not set(ALIASES.values()) & set(ALIASES), "alias chains are not allowed"

    def test_an_alias_never_maps_to_itself(self):
        assert all(alias != target for alias, target in ALIASES.items())

    def test_every_alias_resolves_in_one_step(self):
        for alias, target in ALIASES.items():
            assert canonical_skill(alias) == (target, True)
            assert canonical_skill(target) == (target, False)

    def test_aliases_never_merge_the_c_family_or_look_alikes(self):
        merged = set(ALIASES) | set(ALIASES.values())
        for protected in ("c", "c++", "c#", "java", "net", "sql", "react native", "angularjs"):
            assert ALIASES.get(protected) is None, protected
        assert "java" not in {t for t in ALIASES.values()}
        assert "net" not in merged

    def test_no_two_distinct_skills_in_the_declared_list_share_a_canonical_form(self):
        for a, b in DISTINCT_SKILLS:
            assert canon(a) != canon(b), (a, b)
