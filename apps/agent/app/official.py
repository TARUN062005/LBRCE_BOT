import re

SITE = "https://www.lbrce.ac.in"

TARGETS: dict[str, list[tuple[str, str]]] = {
    "examination": [
        ("/examsection_pages/examtables.php", "Examination timetables"),
        ("/examsection_pages/examnotific.php", "Examination notifications"),
    ],
    "attendance": [("/academic_pages/acadregulations.php", "Academic regulations")],
    "scholarship": [
        ("/admission_pages/admissions.php", "Admissions"),
        ("/academic_pages/acadregulations.php", "Academic regulations"),
    ],
    "hostel": [("/studentcorner_pages/hostels.php", "Hostels")],
    "administration": [("/administration_pages/principal.php", "Principal")],
    "contact": [("/quicklinks_pages/contact.php", "Contact")],
    "fee": [
        ("/admission_pages/feestructure.php", "Fee structure"),
        ("/feestructure.php", "Fee structure"),
    ],
    "placement": [
        ("/placements/placementcontact.php", "Placements team"),
        ("/placements/stat2526.php", "Placement statistics"),
        ("/placements/index.php", "Placements"),
    ],
    "admission": [("/admission_pages/admissions.php", "Admissions")],
    "department": [("/admission_pages/courses.php", "Courses")],
    "notice": [("/examsection_pages/examnotific.php", "Examination notifications")],
    "calendar": [("/academic_pages/aycalender.php", "Academic calendars")],
    "timetable": [("/examsection_pages/examtables.php", "Examination timetables")],
}


def classify_intent(message: str) -> str:
    text = message.lower()
    if "exam" in text and any(word in text for word in ("timetable", "schedule")):
        return "examination"
    if any(word in text for word in ("hod", "faculty", "professor", "principal")):
        return "administration" if "principal" in text else "faculty"
    if "scholarship" in text:
        return "scholarship"
    if "attendance" in text:
        return "attendance"
    if "hostel" in text:
        return "hostel"
    if any(word in text for word in ("contact", "phone", "email")):
        return "contact"
    if "timetable" in text or "time table" in text:
        return "timetable"
    if "department" in text or "courses" in text:
        return "department"
    if "calendar" in text or "calender" in text:
        return "calendar"
    if "notice" in text or "circular" in text:
        return "notice"
    if "admission" in text:
        return "admission"
    if "fee" in text:
        return "fee"
    if "placement" in text or "companies" in text:
        return "placement"
    return "general"


DEPARTMENT_PAGES: dict[str, list[str]] = {
    "CSE": ["/cse/index.php", "/cse/csefaculty.php"],
    "CSE (AI&ML)": ["/csm/index.php", "/csm/csmfaculty.php"],
    "ECE": ["/ece/index.php", "/ece/ecefaculty.php"],
    "EEE": ["/eee/index.php"],
    "IT": ["/it/index.php"],
    "CE": ["/civil/index.php"],
    "ME": ["/mech/index.php"],
    "ASE": ["/ase/index.php"],
    "AI&DS": ["/ai/index.php"],
    "MBA": ["/mba/index.php"],
}

TARGETS["faculty"] = [("/quicklinks_pages/faculty.php", "Faculty")]
TARGETS["facilities"] = [("/gallery_pages/galleryindex.php", "Campus photographs")]
TARGETS["department"] = [("/admission_pages/courses.php", "Courses")]


def official_urls(intent: str) -> list[str]:
    return [f"{SITE}{path}" for path, _title in TARGETS.get(intent, [])]


def topics_in(message: str) -> list[str]:
    text = message.lower()
    found: list[str] = []

    def add(topic: str, matched: bool) -> None:
        if matched and topic not in found:
            found.append(topic)

    add("examination", "exam" in text and any(word in text for word in ("timetable", "schedule")))
    add("faculty", any(word in text for word in ("hod", "faculty", "professor")))
    add("administration", "principal" in text)
    add("scholarship", "scholarship" in text)
    add("attendance", "attendance" in text)
    add("hostel", "hostel" in text)
    add("contact", any(word in text for word in ("contact", "phone", "email")))
    add("timetable", "timetable" in text or "time table" in text)
    add("department", "department" in text or "courses" in text or bool(department_codes(message)))
    add("calendar", "calendar" in text or "calender" in text)
    add("notice", any(word in text for word in ("notice", "circular", "announcement", "recently")))
    add("admission", "admission" in text)
    add("fee", "fee" in text)
    add("placement", "placement" in text or "companies" in text or "tp cell" in text or "t&p" in text or "t & p" in text)
    add("facilities", any(word in text for word in ("facilit", "campus", "laboratory", "laboratories", "infrastructure", "photograph", "photo", "picture")))
    return found


def department_codes(message: str) -> list[str]:
    text = message.lower()
    found: list[str] = []

    def add(code: str, pattern: str) -> None:
        if re.search(pattern, text) and code not in found:
            found.append(code)

    add("CSE (AI&ML)", r"cse\s*\(?\s*ai\s*&?\s*ml|\bcsm\b|machine learning")
    add("AI&DS", r"ai\s*&\s*ds|data science")
    add("CSE", r"\bcse\b|computer science")
    add("ECE", r"\bece\b|electronics and communication")
    add("EEE", r"\beee\b|electrical and electronics")
    add("EIE", r"\beie\b|instrumentation")
    add("CE", r"\bcivil\b")
    add("ME", r"\bmechanical\b|\bmech\b")
    add("ASE", r"\baerospace\b|\base\b")
    add("MBA", r"\bmba\b|business administration")
    add("MCA", r"\bmca\b|computer applications")
    add("IT", r"information technology|\bit department\b|\bdepartment of it\b|\bdept of it\b|(?:\b(?:compare|versus|vs|and)\b.{0,40})\bit\b")
    if "CSE" in found and "CSE (AI&ML)" in found and not re.search(r"\bcse\b(?!\s*\(?\s*ai)", text):
        found.remove("CSE")
    return found


def department_urls(message: str) -> list[str]:
    urls: list[str] = []
    for code in department_codes(message):
        for path in DEPARTMENT_PAGES.get(code, []):
            urls.append(f"{SITE}{path}")
    return urls
