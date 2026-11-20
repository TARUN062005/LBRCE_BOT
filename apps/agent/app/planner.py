"""Bounded research plan.

The plan names official topics and search queries. It does not choose arbitrary
URLs or tools. A model may rewrite a follow-up, and any field it returns is
checked against this allowlist before the graph uses it.
"""

import json
import re

from .official import department_codes, topics_in
from .security import sanitize

ALLOWED_TOPICS = {
    "examination",
    "faculty",
    "administration",
    "scholarship",
    "attendance",
    "hostel",
    "contact",
    "timetable",
    "department",
    "calendar",
    "notice",
    "admission",
    "fee",
    "placement",
    "facilities",
    "general",
}
FOLLOW_UP = re.compile(r"\b(it|its|their|that|those|this|them|there|above|previous|same)\b|\bwhat about\b|\bhow about\b", re.I)
COMPARE = re.compile(r"\b(compare|comparison|versus|vs\.?|difference between)\b", re.I)


def build_plan(message: str, history: list[dict] | None = None) -> dict:
    turns = _turns(history or [])
    question = _standalone(message, turns)
    topics = topics_in(question) or ["general"]
    subjects = department_codes(question)
    comparison = bool(COMPARE.search(question)) or len(subjects) >= 2
    if comparison and len(subjects) < 2:
        subjects = [topic for topic in topics if topic != "general"]
    queries = _queries(question, subjects, comparison)
    return {
        "question": question,
        "memory": "\n".join(turns[-6:]),
        "topics": topics[:6],
        "queries": queries,
        "comparison": comparison and len(subjects) >= 2,
        "subjects": subjects[:4],
        "needsDocument": any(topic in topics for topic in ("calendar", "timetable", "notice", "examination")),
        "needsImages": "facilities" in topics or bool(re.search(r"\b(image|photo|photograph|picture)s?\b", question, re.I)),
    }


def accept_model_plan(draft: dict, raw: str) -> dict:
    parsed = _json_object(raw)
    if not parsed:
        return draft
    question = sanitize(str(parsed.get("standaloneQuestion") or ""), 500)
    topics = [topic for topic in parsed.get("topics") or [] if topic in ALLOWED_TOPICS][:6]
    queries = []
    for query in parsed.get("queries") or []:
        cleaned = sanitize(str(query), 160)
        if cleaned and "http" not in cleaned.lower() and cleaned not in queries:
            queries.append(cleaned)
    if not question or "http" in question.lower() or question.startswith("[removed untrusted instruction]"):
        question = draft["question"]
    merged = {
        **draft,
        "question": question,
        "topics": topics or draft["topics"],
        "queries": (queries or draft["queries"])[:4],
        "comparison": bool(draft.get("comparison") or parsed.get("comparison")),
        "needsDocument": bool(parsed.get("needsDocument")),
        "needsImages": bool(parsed.get("needsImages")),
    }
    if merged["comparison"] and not merged["subjects"]:
        merged["subjects"] = [topic for topic in merged["topics"] if topic != "general"][:4]
        merged["comparison"] = len(merged["subjects"]) >= 2
    return merged


def _standalone(message: str, turns: list[str]) -> str:
    text = " ".join(message.split())
    if not turns or not FOLLOW_UP.search(text):
        return text
    prior = next((turn[6:] for turn in reversed(turns) if turn.startswith("user: ")), "")
    if not prior:
        return text
    return f"{text} This follows the earlier question: {prior[:400]}"


def _turns(history: list[dict]) -> list[str]:
    turns: list[str] = []
    for item in history[-8:]:
        role = str(item.get("role") or "")
        content = sanitize(str(item.get("content") or ""), 400)
        if role in {"user", "assistant"} and content:
            turns.append(f"{role}: {content}")
    return turns


def _queries(question: str, subjects: list[str], comparison: bool) -> list[str]:
    if comparison and len(subjects) >= 2:
        return [f"{subject} faculty laboratories infrastructure placements at LBRCE"[:160] for subject in subjects[:4]]
    compact = " ".join(question.split())[:160]
    return [compact] if compact else []


def _json_object(raw: str) -> dict | None:
    text = (raw or "").strip()
    if not text:
        return None
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None
