"""A deterministic, conservative resume parser (English). No AI, no guessing.

Principles:
  * A field that cannot be found is None / empty. Nothing is ever invented or "filled in".
  * Every field carries a confidence: "high" (clear, unambiguous), "medium" (likely) or "low"
    (found, but the layout was ambiguous). A person must review the result before using it.
  * The output is a plain dict (JSON-safe) so it can be stored, reviewed and later fed to a
    screening step. Nothing here ranks, scores or decides anything about a candidate.
"""

import re
from collections.abc import Iterable
from datetime import date

PARSER_VERSION = 1

# ---- patterns -----------------------------------------------------------------------------------

EMAIL_RE = re.compile(
    r"[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,5}\.[A-Za-z]{2,24}"
)
# No real resume line is longer than this; cutting longer ones keeps every regex cheap on
# hostile text.
MAX_LINE_CHARS = 600
PHONE_RE = re.compile(r"(?<![\w/])(\+?\(?\d[\d\s().-]{7,}\d)(?![\w/])")
_MONTH = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|"
    r"sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)
_DATE = (
    rf"(?:{_MONTH}\.?,?\s+(?:19|20)\d{{2}}|\d{{1,2}}/(?:19|20)\d{{2}}|"
    r"(?:19|20)\d{2}-(?:0[1-9]|1[0-2])(?!\d)|(?:19|20)\d{2})"
)
_END = rf"(?:{_DATE}|present|current|now|ongoing|till date|to date|today)"
RANGE_RE = re.compile(
    rf"(?P<start>{_DATE})\s*(?:-|–|—|to|until)\s*(?P<end>{_END})(?![\w/])", re.IGNORECASE
)
_MONTHS = {
    m: i
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1
    )
}
YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")

SECTION_WORDS = {
    "skills": {
        "skills",
        "technical skills",
        "key skills",
        "core skills",
        "core competencies",
        "skills & tools",
        "skills and tools",
        "competencies",
        "technologies",
        "tech stack",
    },
    "experience": {
        "experience",
        "work experience",
        "professional experience",
        "employment",
        "employment history",
        "work history",
        "career history",
        "relevant experience",
        "professional background",
    },
    "education": {
        "education",
        "academic background",
        "academic qualifications",
        "qualifications",
        "education and training",
        "education & training",
        "academics",
    },
    "other": {
        "summary",
        "professional summary",
        "profile",
        "objective",
        "career objective",
        "projects",
        "certifications",
        "certificates",
        "languages",
        "interests",
        "hobbies",
        "references",
        "awards",
        "publications",
        "achievements",
        "volunteering",
        "personal details",
        "contact",
        "personal information",
        "courses",
        "training",
    },
}
_HEADING_LOOKUP = {w: k for k, ws in SECTION_WORDS.items() for w in ws}

TITLE_WORDS = {
    "engineer",
    "developer",
    "manager",
    "analyst",
    "designer",
    "intern",
    "lead",
    "director",
    "consultant",
    "officer",
    "specialist",
    "architect",
    "administrator",
    "accountant",
    "assistant",
    "executive",
    "associate",
    "head",
    "coordinator",
    "scientist",
    "technician",
    "supervisor",
    "teacher",
    "lecturer",
    "trainee",
    "programmer",
    "tester",
    "qa",
    "recruiter",
    "representative",
    "agent",
    "writer",
    "editor",
    "nurse",
    "founder",
    "cto",
    "ceo",
    "cfo",
    "president",
    "vp",
    "partner",
    "auditor",
    "strategist",
    "planner",
    "operator",
    "clerk",
    "advisor",
    "adviser",
    "researcher",
    "generalist",
    "devops",
    "sre",
}
COMPANY_WORDS = {
    "ltd",
    "limited",
    "inc",
    "llc",
    "corp",
    "corporation",
    "company",
    "co",
    "technologies",
    "systems",
    "solutions",
    "pvt",
    "gmbh",
    "bank",
    "group",
    "labs",
    "software",
    "services",
    "enterprises",
    "consulting",
    "studio",
    "agency",
    "holdings",
    "plc",
    "university",
    "institute",
}
DEGREE_RE = re.compile(
    r"\b(bachelor(?:'?s)?|master(?:'?s)?|doctorate|ph\.?\s?d\.?|mba|bba|bca|mca|mbbs|llb|llm|"
    r"b\.?com|m\.?com|m\.?sc\.?|b\.?sc\.?|"
    r"b\.?tech|m\.?tech|b\.?e\.?|m\.?e\.?|b\.?a\.?|m\.?a\.?|b\.?s\.?|m\.?s\.?|"
    r"associate(?:'?s)?\s+degree|diploma|a-levels?|o-levels?|intermediate|matriculation|"
    r"high school|secondary school)\b",
    re.IGNORECASE,
)
INSTITUTION_RE = re.compile(
    r"\b(university|college|institute|school|academy|polytechnic|universit[àáéy]|"
    r"universidad|università|faculty)\b",
    re.IGNORECASE,
)
_SEPARATORS = re.compile(r"\s+(?:at|@)\s+|\s*[|•·]\s*|\s+[-–—]\s+|\s*,\s*")
_BULLET = re.compile(r"^\s*(?:[-•·*▪●◦►>]|\d+[.)])\s+")
_NAME_TOKEN = re.compile(r"^[^\W\d_]+(?:[-'’.][^\W\d_]+)*\.?$", re.UNICODE)
_NOT_NAMES = {
    "resume",
    "curriculum",
    "vitae",
    "cv",
    "profile",
    "summary",
    "contact",
    "objective",
    "page",
    "curriculum-vitae",
    "personal",
    "details",
    "information",
    "address",
    "phone",
    "email",
    "skills",
    "education",
    "experience",
    "references",
}

SKILL_VOCABULARY = [
    "Python",
    "Java",
    "JavaScript",
    "TypeScript",
    "C++",
    "C#",
    "Go",
    "Rust",
    "Ruby",
    "PHP",
    "Kotlin",
    "Swift",
    "Scala",
    "SQL",
    "PostgreSQL",
    "MySQL",
    "MongoDB",
    "Redis",
    "React",
    "Angular",
    "Vue",
    "Node.js",
    "Django",
    "Flask",
    "FastAPI",
    "Spring",
    ".NET",
    "HTML",
    "CSS",
    "Tailwind",
    "Docker",
    "Kubernetes",
    "AWS",
    "Azure",
    "GCP",
    "Terraform",
    "Linux",
    "Git",
    "CI/CD",
    "REST",
    "GraphQL",
    "Machine Learning",
    "Data Analysis",
    "Excel",
    "Power BI",
    "Tableau",
    "Figma",
    "Jira",
    "Scrum",
    "Agile",
    "Project Management",
    "Accounting",
    "Payroll",
    "Recruitment",
    "Customer Service",
    "Sales",
    "Marketing",
    "SEO",
    "Content Writing",
    "Photoshop",
    "Illustrator",
]

# ---- helpers ------------------------------------------------------------------------------------


def _field(value: str | None, confidence: str | None) -> dict:
    return {"value": value, "confidence": confidence if value else None}


def _words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z][A-Za-z+#.]*", text)


def _heading(line: str) -> str | None:
    clean = line.strip().rstrip(":").strip().lower()
    if not clean or len(clean) > 40:
        return None
    clean = re.sub(r"[^a-z &]", "", clean).strip()
    return _HEADING_LOOKUP.get(clean)


def split_sections(lines: list[str]) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in lines:
        h = _heading(line)
        if h is not None:
            current = h if h != "other" else "other"
            sections.setdefault(current, [])
            continue
        if current is not None:
            sections[current].append(line)
    return sections


def _parse_date(token: str, today: date) -> tuple[int, int | None]:
    t = token.strip().lower().rstrip(".,")
    if t in {"present", "current", "now", "ongoing", "till date", "to date", "today"}:
        return today.year, today.month
    m = re.match(rf"^({_MONTH})\.?,?\s+((?:19|20)\d{{2}})$", t)
    if m:
        return int(m.group(2)), _MONTHS[m.group(1)[:3]]
    m = re.match(r"^(\d{1,2})/((?:19|20)\d{2})$", t)
    if m and 1 <= int(m.group(1)) <= 12:
        return int(m.group(2)), int(m.group(1))
    m = re.match(r"^((?:19|20)\d{2})-(0[1-9]|1[0-2])$", t)
    if m:
        return int(m.group(1)), int(m.group(2))
    return int(t[:4]), None  # a bare year


def _fmt(year: int, month: int | None) -> str:
    return f"{year:04d}-{month:02d}" if month else f"{year:04d}"


def _classify(part: str) -> str | None:
    words = {w.lower().strip(".") for w in _words(part)}
    if words & TITLE_WORDS:
        return "title"
    if words & COMPANY_WORDS:
        return "company"
    return None


def _looks_like_name_line(line: str) -> bool:
    return (
        0 < len(line) <= 70
        and len(line.split()) <= 9
        and not _BULLET.match(line)
        and not RANGE_RE.search(line)
        and not line.rstrip().endswith((".", ";"))
        and _heading(line) is None
    )


# ---- personal details ---------------------------------------------------------------------------


def parse_email(text: str) -> tuple[dict, list[str]]:
    found = []
    for m in EMAIL_RE.finditer(text):
        e = m.group(0).lower().rstrip(".")
        if e not in found:
            found.append(e)
    warnings = ["multiple_emails"] if len(found) > 1 else []
    return _field(found[0] if found else None, "high"), warnings


def parse_phone(text: str) -> dict:
    for m in PHONE_RE.finditer(text):
        raw = m.group(1).strip()
        digits = re.sub(r"\D", "", raw)
        if not 9 <= len(digits) <= 15:
            continue
        if RANGE_RE.search(raw) or re.fullmatch(r"(?:19|20)\d{2}\D+(?:19|20)\d{2}", raw):
            continue  # a date range, not a phone number
        return _field(re.sub(r"\s+", " ", raw), "high" if raw.startswith("+") else "medium")
    return _field(None, None)


def parse_name(lines: list[str]) -> dict:
    for index, line in enumerate(lines[:6]):
        if "@" in line or re.search(r"\d|http|www\.", line, re.IGNORECASE):
            continue
        tokens = line.split()
        if not 2 <= len(tokens) <= 4:
            continue
        if any(t.lower().strip(".,:") in _NOT_NAMES for t in tokens):
            continue
        if not all(_NAME_TOKEN.match(t) and t[0].isupper() for t in tokens):
            continue
        if _heading(line) is not None or _classify(line) == "title":
            continue
        return _field(" ".join(tokens), "high" if index == 0 else "medium")
    return _field(None, None)


# ---- skills -------------------------------------------------------------------------------------


def parse_skills(text: str, section: list[str] | None) -> dict:
    if section:
        items: list[str] = []
        for line in section:
            line = _BULLET.sub("", line)
            if ":" in line and len(line.split(":", 1)[0]) <= 30:
                line = line.split(":", 1)[1]  # "Languages: Python, Go" -> "Python, Go"
            for raw in re.split(r"[,;|•·•]", line):
                item = raw.strip(" .-–—\t")
                if 1 <= len(item) <= 40 and len(item.split()) <= 4 and not item.endswith("."):
                    if item.lower() not in {s.lower() for s in items}:
                        items.append(item)
        if items:
            return {"values": items[:60], "confidence": "high", "source": "skills_section"}
    found = [
        s
        for s in SKILL_VOCABULARY
        if re.search(rf"(?<![\w+#.]){re.escape(s)}(?![\w+#])", text, re.IGNORECASE)
    ]
    if found:
        return {"values": found, "confidence": "low", "source": "vocabulary_match"}
    return {"values": [], "confidence": None, "source": None}


# ---- education ----------------------------------------------------------------------------------


def parse_education(section: list[str]) -> list[dict]:
    entries: list[dict] = []
    used: set[int] = set()
    for i, line in enumerate(section):
        if i in used:
            continue
        deg = DEGREE_RE.search(line)
        inst_here = INSTITUTION_RE.search(line)
        if not deg and not inst_here:
            continue
        block = [(i, line)]
        for j in range(i + 1, min(i + 3, len(section))):
            nxt = section[j]
            has_inst = any(INSTITUTION_RE.search(t) for _, t in block)
            has_year = any(YEAR_RE.search(t) for _, t in block)
            if j in used or DEGREE_RE.search(nxt) or (has_inst and has_year):
                break  # the next line is another entry, or this one is already complete
            if not has_inst and not INSTITUTION_RE.search(nxt) and not YEAR_RE.search(nxt):
                break  # unrelated text
            if has_inst and not YEAR_RE.search(nxt):
                break  # only a dates line may follow an entry that already has its institution
            block.append((j, nxt))
        text = " ".join(t for _, t in block)
        degree = field = institution = None
        confidence = "medium"
        if deg:
            segment = re.split(r"\s+[|•·–—]\s+|\s*,\s*(?=[A-Z])", line)[0]
            m = re.match(r"^(.*?)(?:\s+(?:in|of)\s+(.+))?$", segment.strip(), re.IGNORECASE)
            degree_text = DEGREE_RE.search(segment)
            if degree_text and m:
                lead = segment[degree_text.start() :]
                parts = re.split(r"\s+in\s+", lead, maxsplit=1, flags=re.IGNORECASE)
                degree = re.sub(YEAR_RE, "", parts[0]).strip(" ,-–—()") or None
                if len(parts) == 2:
                    field = (
                        re.split(r"\s*[,(|–—-]\s*", re.sub(YEAR_RE, "", parts[1]))[0].strip()
                        or None
                    )
        for _, t in block:
            if INSTITUTION_RE.search(t):
                pieces = [p.strip() for p in re.split(r"\s+[|•·–—-]\s+|,\s*", t) if p.strip()]
                inst = next((p for p in pieces if INSTITUTION_RE.search(p)), None)
                if inst:
                    institution = YEAR_RE.sub("", inst).strip(" ,-–—()") or None
                    break
        years = [int(y) for y in YEAR_RE.findall(text)]
        start_year = min(years) if len(years) >= 2 else None
        end_year = max(years) if years else None
        if not (degree and institution):
            confidence = "low"
        elif start_year or end_year:
            confidence = "high"
        if degree or institution:
            entries.append(
                {
                    "degree": degree,
                    "field": field,
                    "institution": institution,
                    "start_year": start_year,
                    "end_year": end_year,
                    "confidence": confidence,
                }
            )
            used.update(idx for idx, _ in block)
    return entries


# ---- experience ---------------------------------------------------------------------------------


def _split_header(header: str) -> list[str]:
    return [p.strip(" ,|-–—•·") for p in _SEPARATORS.split(header) if p.strip(" ,|-–—•·")]


def _assign(parts: list[str]) -> tuple[str | None, str | None, str]:
    """(title, company, confidence) from the pieces of a header line."""
    if not parts:
        return None, None, "low"
    if len(parts) == 1:
        kind = _classify(parts[0])
        if kind == "title":
            return parts[0], None, "medium"
        if kind == "company":
            return None, parts[0], "medium"
        return None, None, "low"
    a, b = parts[0], parts[1]
    ka, kb = _classify(a), _classify(b)
    if ka == "title" and kb != "title":
        return a, b, "high" if kb == "company" or ka == "title" else "medium"
    if kb == "title" and ka != "title":
        return b, a, "high"
    if ka == "company" and kb is None:
        return b, a, "medium"
    return a, b, "low"  # ambiguous: keep the written order and say so


def _months_between(sy: int, sm: int | None, ey: int, em: int | None) -> tuple[int | None, str]:
    precise = sm is not None and em is not None
    s = sy * 12 + (sm or 1)
    e = ey * 12 + (em or 12)
    months = e - s + 1
    return (months if months > 0 else None), ("month" if precise else "year")


def parse_experience(section: list[str], today: date) -> list[dict]:
    entries: list[dict] = []
    used: set[int] = set()
    for i, line in enumerate(section):
        m = RANGE_RE.search(line)
        if not m or i in used:
            continue
        rest = (line[: m.start()] + " " + line[m.end() :]).strip(" ,|-–—•·()[]")
        used.add(i)

        def neighbour(start: int) -> tuple[int, str] | None:
            """The nearest earlier non-blank line before `start` that looks like a name/title."""
            j = start - 1
            while j >= 0 and not section[j].strip():
                j -= 1
            if j >= 0 and j not in used and _looks_like_name_line(section[j]):
                used.add(j)
                return j, section[j]
            return None

        if rest and len(rest) >= 3:
            parts = _split_header(rest)
            other = neighbour(i)
            if len(parts) == 1 and other:
                parts = (
                    [parts[0], other[1]] if _classify(parts[0]) == "title" else [other[1], parts[0]]
                )
        else:
            first = neighbour(i)
            parts = _split_header(first[1]) if first else []
            if len(parts) == 1 and first:
                second = neighbour(first[0])
                if second:
                    parts = [second[1], parts[0]]
        title, company, confidence = _assign(parts)
        (sy, sm), (ey, em) = (
            _parse_date(m.group("start"), today),
            _parse_date(m.group("end"), today),
        )
        current = m.group("end").strip().lower() in {
            "present",
            "current",
            "now",
            "ongoing",
            "till date",
            "to date",
            "today",
        }
        months, precision = _months_between(sy, sm, ey, em)
        if title is None and company is None:
            confidence = "low"
        entries.append(
            {
                "title": title,
                "company": company,
                "start": _fmt(sy, sm),
                "end": None if current else _fmt(ey, em),
                "current": current,
                "months": months,
                "date_precision": precision,
                "confidence": confidence,
            }
        )
    return entries


def total_experience(entries: Iterable[dict], today: date) -> tuple[int | None, str | None]:
    """Months covered by the listed jobs, counting overlapping periods once."""
    spans: list[tuple[int, int]] = []
    precise = True
    for e in entries:
        if not e.get("months"):
            continue
        sy, sm = int(e["start"][:4]), int(e["start"][5:7]) if len(e["start"]) > 4 else None
        end = e["end"] or _fmt(today.year, today.month)
        ey, em = int(end[:4]), int(end[5:7]) if len(end) > 4 else None
        precise &= e["date_precision"] == "month"
        spans.append((sy * 12 + (sm or 1), ey * 12 + (em or 12)))
    if not spans:
        return None, None
    spans.sort()
    total, (cur_s, cur_e) = 0, spans[0]
    for s, e in spans[1:]:
        if s <= cur_e + 1:
            cur_e = max(cur_e, e)
        else:
            total += cur_e - cur_s + 1
            cur_s, cur_e = s, e
    total += cur_e - cur_s + 1
    return total, "medium" if precise else "low"


# ---- entry point --------------------------------------------------------------------------------


def parse_resume(text: str, *, truncated: bool = False, today: date | None = None) -> dict:
    today = today or date.today()
    lines = [ln.strip()[:MAX_LINE_CHARS] for ln in text.split("\n")]
    text = "\n".join(lines)
    nonblank = [ln for ln in lines if ln]
    sections = split_sections(lines)
    warnings: list[str] = []

    email, email_warn = parse_email(text)
    warnings += email_warn
    phone = parse_phone(text)
    name = parse_name(nonblank)
    skills = parse_skills(text, sections.get("skills"))
    education = parse_education(sections.get("education", []))
    experience = parse_experience(sections.get("experience", []), today)
    months, months_conf = total_experience(experience, today)

    for key, value in (
        ("no_name", name["value"]),
        ("no_email", email["value"]),
        ("no_phone", phone["value"]),
    ):
        if not value:
            warnings.append(key)
    if "skills" not in sections:
        warnings.append("no_skills_section")
    if "education" not in sections:
        warnings.append("no_education_section")
    if "experience" not in sections:
        warnings.append("no_experience_section")
    if truncated:
        warnings.append("text_truncated")

    return {
        "parser_version": PARSER_VERSION,
        "name": name,
        "email": email,
        "phone": phone,
        "skills": skills,
        "education": education,
        "experience": experience,
        "total_experience_months": months,
        "total_experience_confidence": months_conf,
        "sections_found": sorted(k for k in sections if k != "other"),
        "warnings": warnings,
    }
