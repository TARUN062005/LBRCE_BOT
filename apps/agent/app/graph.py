from contextvars import ContextVar
import time
from typing import TypedDict

from langgraph.graph import END, StateGraph

import re

from .official import classify_intent
from .planner import build_plan
from .security import refuses_outside, sanitize
from .tools import AgentTools, DownloadFailed
from .verify import conflicting_amounts, evidence_supports_role, is_navigation, usable_text

BUDGET_SECONDS = 75


class AgentState(TypedDict, total=False):
    message: str
    intent: str
    history: list[dict]
    question: str
    memory: str
    comparison: bool
    subjects: list[str]
    needsImages: bool
    evidence: list[dict]
    page_urls: list[str]
    pdf_urls: list[str]
    pdf_url: str
    download_failed: bool
    activity: list[str]
    attempts: list[dict]
    answer: str
    status: str
    route: str
    started: float
    indexed: int
    conflicts: list[str]


def build_graph():
    graph = StateGraph(AgentState)
    for name, node in (
        ("classify", classify),
        ("plan", plan),
        ("retrieve", retrieve),
        ("discover", discover),
        ("fetch", fetch),
        ("process_pdf", process_pdf),
        ("ocr", ocr),
        ("vision", vision),
        ("browse", browse),
        ("verify", verify),
        ("generate", generate),
        ("index_knowledge", index_knowledge),
        ("refuse", refuse),
    ):
        graph.add_node(name, node)
    graph.set_entry_point("classify")
    graph.add_conditional_edges("classify", _route, {"plan": "plan", "refuse": "refuse"})
    graph.add_edge("plan", "retrieve")
    graph.add_conditional_edges("retrieve", _route, {"generate": "generate", "discover": "discover", "refuse": "refuse"})
    graph.add_edge("discover", "fetch")
    graph.add_conditional_edges("fetch", _route, {"process_pdf": "process_pdf", "browse": "browse", "verify": "verify", "refuse": "refuse"})
    graph.add_conditional_edges("process_pdf", _route, {"ocr": "ocr", "browse": "browse", "verify": "verify", "refuse": "refuse"})
    graph.add_conditional_edges("ocr", _route, {"vision": "vision", "verify": "verify", "refuse": "refuse"})
    graph.add_conditional_edges("vision", _route, {"browse": "browse", "verify": "verify", "refuse": "refuse"})
    graph.add_edge("browse", "verify")
    graph.add_conditional_edges("verify", _route, {"generate": "generate", "refuse": "refuse"})
    graph.add_edge("generate", "index_knowledge")
    graph.add_edge("index_knowledge", END)
    graph.add_edge("refuse", END)
    return graph.compile()


_compiled = None
_tools_var: ContextVar[AgentTools | None] = ContextVar("lbrce_agent_tools", default=None)


def run_agent(message: str, tools: AgentTools, history: list[dict] | None = None) -> dict:
    global _compiled
    if _compiled is None:
        _compiled = build_graph()
    token = _tools_var.set(tools)
    try:
        state = _compiled.invoke(
            {
                "message": message,
                "history": [item for item in (history or []) if isinstance(item, dict)][:8],
                "evidence": [],
                "activity": [],
                "attempts": [],
                "started": time.time(),
                "download_failed": False,
            },
            config={"recursion_limit": 20},
        )
    finally:
        _tools_var.reset(token)
    return _public_result(state)


def _tools() -> AgentTools:
    tools = _tools_var.get()
    if tools is None:
        raise RuntimeError("Agent tools were not bound")
    return tools


def _route(state: AgentState) -> str:
    return state.get("route") or "refuse"


def _expired(state: AgentState) -> bool:
    return time.time() - float(state.get("started") or time.time()) > BUDGET_SECONDS


def _with(state: AgentState, step: str, ok: bool, detail: str, route: str, **extra) -> AgentState:
    attempts = [*state.get("attempts", []), {"step": step, "ok": ok, "detail": detail[:180]}]
    activity = [*state.get("activity", []), step.replace("_", " ")]
    if _expired(state) and route not in {"refuse", "generate"}:
        route = "refuse"
        attempts.append({"step": "limit", "ok": False, "detail": "The retrieval time limit was reached"})
    return {**state, **extra, "attempts": attempts, "activity": activity, "route": route}


def classify(state: AgentState) -> AgentState:
    if refuses_outside(state["message"]):
        return _with(state, "classify", True, "outside college", "refuse", intent="general", status="refused")
    intent = classify_intent(state["message"])
    return _with(state, "classify", True, intent, "plan", intent=intent)


def plan(state: AgentState) -> AgentState:
    _tools().status("Planning the college research")
    draft = build_plan(state["message"], state.get("history") or [])
    refine = getattr(_tools(), "plan_research", None)
    chosen = draft
    if callable(refine):
        try:
            refined = refine(draft)
            if isinstance(refined, dict) and refined.get("question"):
                chosen = refined
        except Exception:
            chosen = draft
    topics = chosen.get("topics") or ["general"]
    return _with(
        state,
        "plan",
        True,
        "research plan ready",
        "retrieve",
        question=str(chosen.get("question") or state["message"]),
        memory=str(chosen.get("memory") or ""),
        intent=str(topics[0]),
        comparison=bool(chosen.get("comparison")),
        subjects=list(chosen.get("subjects") or []),
        needsImages=bool(chosen.get("needsImages")),
    )


def retrieve(state: AgentState) -> AgentState:
    question = state.get("question") or state["message"]
    rows = _tools().search(question)
    evidence = [*state.get("evidence", []), *rows]
    route = "generate" if _enough(state, question, evidence) else "discover"
    return _with(state, "retrieve", bool(rows), f"{len(rows)} indexed records", route, evidence=evidence)


def discover(state: AgentState) -> AgentState:
    urls = _tools().discover(state.get("question") or state["message"], state.get("intent") or "general")
    return _with(state, "discover", bool(urls), ", ".join(urls[:3]) or "no official link", "fetch", page_urls=urls)


def fetch(state: AgentState) -> AgentState:
    urls = state.get("page_urls") or ["https://www.lbrce.ac.in/"]
    pages = _tools().fetch(urls)
    evidence = [*state.get("evidence", [])]
    pdfs: list[str] = []
    for page in pages:
        pdfs.extend(page.get("pdfs") or [])
        evidence.extend(page.get("images") or [])
        if page.get("sourceType") == "pdf":
            pdfs.append(page["sourceUrl"])
        elif page.get("sourceType") == "image" and page.get("extractedText"):
            evidence.append(page)
        elif page.get("extractedText"):
            evidence.append(page)
    unique = []
    for url in pdfs:
        if url not in unique:
            unique.append(url)
    if state.get("needsImages") and _image_items(evidence):
        route = "verify"
    elif unique:
        route = "process_pdf"
    elif _enough(state, state.get("question") or state["message"], evidence):
        route = "verify"
    else:
        route = "browse"
    return _with(state, "fetch", bool(pages), f"{len(pages)} pages, {len(unique)} pdfs", route, evidence=evidence, pdf_urls=unique[:2], page_urls=urls)


def process_pdf(state: AgentState) -> AgentState:
    url = (state.get("pdf_urls") or [""])[0]
    try:
        extracted = _tools().read_pdf(url)
    except DownloadFailed as error:
        return _with(state, "process_pdf", False, str(error), "browse", download_failed=True, pdf_url=url)
    item = {
        "sourceUrl": url,
        "sourceType": "pdf",
        "documentTitle": url.rsplit("/", 1)[-1],
        "extractedText": extracted["text"],
        "capturedAt": state.get("evidence", [{}])[-1].get("capturedAt") if state.get("evidence") else "",
        "verificationStatus": "partial",
        "origin": "fetched",
        "pageNumber": 1,
    }
    from datetime import datetime, timezone

    item["capturedAt"] = datetime.now(timezone.utc).isoformat()
    evidence = [*state.get("evidence", []), item] if extracted["text"] else state.get("evidence", [])
    detail = f"{extracted['pages']} pages, {extracted['tables']} tables, {extracted['images']} images"
    route = "ocr" if extracted["scanned"] else "verify"
    return _with(state, "process_pdf", not extracted["scanned"], detail, route, evidence=evidence, pdf_url=url)


def ocr(state: AgentState) -> AgentState:
    text = _tools().ocr(state.get("pdf_url") or "")
    evidence = state.get("evidence", [])
    if len(text) >= 80:
        evidence = [*evidence, _page(state, text, "pdf")]
        return _with(state, "ocr", True, "text recovered from the rendered page", "verify", evidence=evidence)
    return _with(state, "ocr", False, "rendered page did not produce enough text", "vision")


def vision(state: AgentState) -> AgentState:
    text = _tools().vision(state.get("pdf_url") or "", state["message"])
    if len(text) >= 80:
        return _with(state, "vision", True, "vision read the rendered page", "verify", evidence=[*state.get("evidence", []), _page(state, text, "image")])
    route = "browse" if state.get("download_failed") else "verify"
    return _with(state, "vision", False, "vision did not recover the page", route)


def browse(state: AgentState) -> AgentState:
    url = state.get("pdf_url") or (state.get("page_urls") or ["https://www.lbrce.ac.in/"])[0]
    try:
        item = _tools().browse(url)
    except DownloadFailed as error:
        return _with(state, "browse", False, str(error), "verify", download_failed=True)
    return _with(state, "browse", True, "screenshot text captured", "verify", evidence=[*state.get("evidence", []), item])


def verify(state: AgentState) -> AgentState:
    _tools().status("Verifying the retrieved text")
    cleaned = []
    for item in state.get("evidence", []):
        copy = dict(item)
        copy["extractedText"] = sanitize(str(item.get("extractedText") or ""))
        cleaned.append(copy)
    conflicts = conflicting_amounts([str(item.get("extractedText") or "") for item in cleaned])
    question = state.get("question") or state["message"]
    route = "generate" if _accepted(state, question, cleaned) else "refuse"
    return _with(state, "verify", route == "generate", "evidence accepted" if route == "generate" else "evidence does not establish the answer", route, evidence=cleaned, conflicts=conflicts)


def generate(state: AgentState) -> AgentState:
    question = state.get("question") or state["message"]
    memory = state.get("memory") or ""
    prompt = question if not memory else f"{question}\n\nEarlier conversation, for context only:\n{memory}"
    answer = _tools().generate(prompt, [item for item in state.get("evidence", []) if item.get("extractedText")])
    status = "answered" if answer else "refused"
    return _with(state, "generate", status == "answered", status, "index", answer=answer, status=status)


def index_knowledge(state: AgentState) -> AgentState:
    from .verify import is_navigation

    fresh = [
        item
        for item in state.get("evidence", [])
        if item.get("origin") != "index" and not is_navigation(str(item.get("extractedText") or ""))
    ]
    stored = _tools().index(fresh)
    return _with(state, "index", True, f"{stored} new extracts stored", "done", indexed=stored, status=state.get("status") or "answered")


def refuse(state: AgentState) -> AgentState:
    if refuses_outside(state["message"]):
        answer = "I can only provide verified information about Lakireddy Bali Reddy College of Engineering."
    else:
        answer = "The requested fact could not be verified from the official college sources. I will not guess it."
    return {**state, "answer": answer, "status": "refused", "route": "done"}


def _image_items(evidence: list[dict]) -> bool:
    return any(item.get("sourceType") == "image" and str(item.get("sourceUrl") or "").startswith("https://") for item in evidence)


def _enough(state: AgentState, question: str, evidence: list[dict]) -> bool:
    if not evidence_supports_role(question, evidence):
        return False
    if state.get("needsImages") and _image_items(evidence):
        return True
    if not usable_text(question, evidence):
        return False
    if state.get("comparison") and not _covers(state.get("subjects") or [], evidence):
        return False
    return True


def _accepted(state: AgentState, question: str, evidence: list[dict]) -> bool:
    substantive = [
        item
        for item in evidence
        if len(str(item.get("extractedText") or "")) > 40 and not is_navigation(str(item.get("extractedText") or ""))
    ]
    if not evidence_supports_role(question, evidence):
        return False
    if state.get("needsImages") and _image_items(evidence):
        return True
    if state.get("comparison"):
        return bool(substantive)
    return bool(usable_text(question, evidence))


def _covers(subjects: list[str], evidence: list[dict]) -> bool:
    if len(subjects) < 2:
        return True
    blob = "\n".join(str(item.get("extractedText") or "") for item in evidence)
    return all(any(re.search(marker, blob, re.I) for marker in _markers(subject)) for subject in subjects)


def _markers(subject: str) -> tuple[str, ...]:
    known = {
        "CSE": (r"\bcse\b", r"computer science"),
        "CSE (AI&ML)": (r"\bcsm\b", r"machine learning"),
        "AI&DS": (r"data science",),
        "ECE": (r"\bece\b", r"electronics and communication"),
        "EEE": (r"\beee\b", r"electrical"),
        "EIE": (r"\beie\b", r"instrumentation"),
        "IT": (r"information technology", r"\bit department\b", r"\bdepartment of it\b"),
        "CE": (r"\bcivil\b",),
        "ME": (r"\bmechanical\b", r"\bmech\b"),
        "ASE": (r"\baerospace\b",),
        "MBA": (r"\bmba\b",),
        "MCA": (r"\bmca\b",),
        "FED": (r"\bfreshman\b",),
        "fee": (r"\bfee",),
        "hostel": (r"\bhostel",),
        "placement": (r"\bplacement",),
        "faculty": (r"\bfaculty\b", r"\bprofessor\b"),
        "calendar": (r"\bcalendar\b", r"\bcalender\b"),
        "admission": (r"\badmission",),
    }
    return known.get(subject, (rf"\b{re.escape(subject)}\b",))


def _page(state: AgentState, text: str, source_type: str) -> dict:
    from datetime import datetime, timezone

    return {
        "sourceUrl": state.get("pdf_url") or "",
        "sourceType": source_type,
        "documentTitle": (state.get("pdf_url") or "Official document").rsplit("/", 1)[-1],
        "pageNumber": 1,
        "extractedText": text,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "verificationStatus": "partial",
        "origin": "fetched",
    }


def _public_result(state: AgentState) -> dict:
    evidence = [item for item in state.get("evidence", []) if item.get("extractedText")]
    return {
        "answer": state.get("answer") or "",
        "evidence": evidence,
        "citations": [
            {
                "title": item.get("documentTitle") or item.get("sourceUrl"),
                "url": item.get("sourceUrl"),
                "pageNumber": item.get("pageNumber"),
                "sourceType": item.get("sourceType"),
            }
            for item in evidence
            if item.get("sourceUrl")
        ],
        "documents": [
            {"title": item.get("documentTitle"), "url": item.get("sourceUrl"), "pageNumber": item.get("pageNumber")}
            for item in evidence
            if item.get("sourceType") in {"pdf", "image", "screenshot"}
        ],
        "images": [item for item in evidence if item.get("sourceType") in {"image", "screenshot"}],
        "activity": state.get("activity", []),
        "attempts": state.get("attempts", []),
        "status": state.get("status") or "refused",
        "intent": state.get("intent") or "general",
        "indexed": state.get("indexed") or 0,
        "conflicts": state.get("conflicts") or [],
    }
