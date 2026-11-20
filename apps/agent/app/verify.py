import re

from .security import sanitize

GENERIC = set(
    "what when where which who whom whose why how does did the and for with from that this about lbrce lakireddy mylavaram college please show tell can you latest current official available information requirement facilities procedure structure visited companies company membership year today announcement notice explain".split()
)
CATEGORY = set(
    "fee fees tuition hostel hostels principal contact phone email exam examination timetable schedule scholarship scholarships attendance placement placements admission admissions department departments calendar calendars".split()
)
NAV = (
    "home administration",
    "student corner",
    "call us:",
    "all rights reserved",
    "quick links",
    "webmail",
    "major recruiters",
    "important links",
    "total visitors",
)


def is_navigation(text: str) -> bool:
    value = text.lower()
    return sum(1 for marker in NAV if marker in value) >= 2


def answers_question(question: str, text: str) -> bool:
    tokens = [token for token in re.findall(r"\b[a-z0-9]{4,}\b", question.lower()) if token not in GENERIC]
    if not tokens:
        return True
    haystack = text.lower()
    specific = [token for token in tokens if token not in CATEGORY]
    if not specific:
        return any(token in haystack for token in tokens)
    hits = sum(1 for token in specific if token in haystack)
    return hits >= min(2, len(specific))


ROLE = re.compile(
    r"training\s*(?:and|&)\s*placement|t\s*&\s*p|\btp\s+cell\b|placement\s+(?:dean|officer|cell|coordinator)|dean\s+of\s+training",
    re.I,
)
DEAN = re.compile(
    r"(?:\bdean\b.{0,40}(?:training\s*(?:and|&)\s*placement|t\s*&\s*p))|(?:(?:training\s*(?:and|&)\s*placement|t\s*&\s*p).{0,40}\bdean\b)|(?:\bplacement\s+dean\b)",
    re.I,
)
HEAD = re.compile(
    r"\bhead(?:\s*,|\s+of(?:\s+the)?)?\s+(?:tp\s+cell|t\s*&\s*p(?:\s+cell)?|training\s*(?:and|&)\s*placement(?:\s+cell)?|placement\s+cell)\b",
    re.I,
)
OFFICER = re.compile(
    r"\b(?:placement\s+officer|training\s*(?:and|&)\s*placement\s+(?:officer|coordinator)|t\s*&\s*p\s+(?:officer|coordinator)|placement\s+coordinator)\b",
    re.I,
)


def asks_for_role(question: str) -> bool:
    return bool(ROLE.search(question or ""))


def _role_pattern(question: str) -> re.Pattern[str] | None:
    text = (question or "").lower()
    if not asks_for_role(question):
        return None
    if re.search(r"\bdean\b", text):
        return DEAN
    if re.search(r"\b(head|hod)\b", text):
        return HEAD
    if re.search(r"\b(officer|coordinator)\b", text):
        return OFFICER
    return ROLE


def evidence_supports_role(question: str, evidence: list[dict]) -> bool:
    pattern = _role_pattern(question)
    if pattern is None:
        return True
    blob = "\n".join(str(item.get("extractedText") or "") for item in evidence)
    return bool(pattern.search(blob))


def usable_text(question: str, evidence: list[dict]) -> str:
    parts: list[str] = []
    for item in evidence:
        text = sanitize(str(item.get("extractedText") or ""))
        if len(text) > 40 and not is_navigation(text):
            parts.append(text)
    blob = "\n".join(parts)
    if not blob or not answers_question(question, blob) or not evidence_supports_role(question, evidence):
        return ""
    return blob


def conflicting_amounts(texts: list[str]) -> list[str]:
    amounts: set[str] = set()
    for text in texts:
        for match in re.findall(r"(?:₹|rs\.?)\s*[\d,]+", text, flags=re.I):
            digits = re.sub(r"\D", "", match)
            if len(digits) >= 4:
                amounts.add(digits)
    if len(amounts) < 2:
        return []
    return [f"The official extracts mention different amounts: {', '.join(sorted(amounts))}."]
