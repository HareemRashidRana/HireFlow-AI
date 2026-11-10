"""Turning a skill string into a comparable key, WITHOUT destroying meaningful symbols.

What is done: Unicode compatibility folding (so "C＋＋" equals "C++"), case folding, whitespace
collapsing, and removal of decoration that is not part of a skill's name (list bullets, surrounding
quotes, trailing sentence punctuation).

What is NOT done, on purpose: punctuation inside or at the end of a name is kept when it carries
meaning. "c++", "c#" and "c" stay three different keys; ".net" keeps its leading dot and never
becomes "net"; "node.js" keeps its dot. There is no stemming, no stop-word removal and no fuzzy
matching: "java" and "javascript" can never match.
"""

import re
import unicodedata

from app.services.screening.aliases import ALIASES

MAX_SKILL_CHARS = 100

# Invisible formatting characters (zero-width spaces, direction marks, BOM) are copy-paste debris:
# they are deleted, so "Pyth<ZWSP>on" is still Python. Other control characters become spaces.
_INVISIBLE = re.compile(r"[​-‏‪-‮⁠﻿]")
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f  ]")
_SPACES = re.compile(r"\s+")
_AROUND_SLASH = re.compile(r"\s*/\s*")
_LEADING_BULLET = re.compile(r"^[•·●▪*–—-]+\s+")
_WRAPPERS = "\"'`‘’“”"
_TRAILING_SENTENCE_PUNCTUATION = ",;:!?."


def normalize_skill(raw: object) -> str | None:
    """The comparison key for one skill, or None if it is not a usable skill string."""
    if not isinstance(raw, str):
        return None
    text = unicodedata.normalize("NFKC", raw)
    text = _CONTROL.sub(" ", _INVISIBLE.sub("", text)).casefold()
    text = _SPACES.sub(" ", text).strip()
    text = _LEADING_BULLET.sub("", text)
    text = text.strip(_WRAPPERS + " ")
    text = _AROUND_SLASH.sub("/", text)
    while text and text[-1] in _TRAILING_SENTENCE_PUNCTUATION + " ":
        text = text[:-1]
    text = text.strip(_WRAPPERS + " ")
    if not text or len(text) > MAX_SKILL_CHARS or not any(ch.isalnum() for ch in text):
        return None
    return text


def canonical_skill(raw: object) -> tuple[str, bool] | None:
    """(canonical key, whether an alias was needed to get there), or None for an unusable string."""
    key = normalize_skill(raw)
    if key is None:
        return None
    canonical = ALIASES.get(key)
    return (canonical, True) if canonical is not None else (key, False)
