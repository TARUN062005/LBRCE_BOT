"""Local PDF rendering, OCR, timetable grids, and calendar extraction.

PyMuPDF renders pages and reads a text layer with coordinates. RapidOCR reads a
rendered page when that text layer is missing. A missing text layer is not an
empty document.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PAGE_DIR = ROOT / "uploads" / "agent-pages"
DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday")
YEAR = re.compile(r"\b(20\d{2}\s*[-/]\s*\d{2,4})\b", re.I)
DATE = re.compile(
    r"\b(\d{1,2}[/-]\d{1,2}[/-]20\d{2}|20\d{2}-\d{2}-\d{2}|\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2})\b",
    re.I,
)


@dataclass
class Word:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    confidence: float = 1.0


@dataclass
class PeriodCell:
    day: str | None
    period: int | None
    startTime: str | None
    endTime: str | None
    subject: str | None
    subjectCode: str | None
    faculty: str | None
    room: str | None
    uncertain: bool


@dataclass
class TimetableGrid:
    department: str | None = None
    year: str | None = None
    semester: str | None = None
    section: str | None = None
    academicYear: str | None = None
    periods: list[PeriodCell] = field(default_factory=list)
    unreadable: bool = False


@dataclass
class CalendarEvent:
    academicYear: str | None
    semester: str | None
    event: str
    start: str | None
    end: str | None
    kind: str


@dataclass
class PageRead:
    number: int
    text: str
    words: list[Word]
    image_path: str | None
    confidence: float
    table_regions: list[dict]


@dataclass
class PdfRead:
    text_layer: str
    pages: list[PageRead]
    tables: int
    scanned: bool


def inspect_pdf(data: bytes, limit: int = 4) -> PdfRead:
    import pymupdf

    document = pymupdf.open(stream=data, filetype="pdf")
    pages: list[PageRead] = []
    tables = 0
    try:
        count = min(document.page_count, limit)
        for index in range(count):
            page = document[index]
            words = [
                Word(text=str(item[4]), x0=float(item[0]), y0=float(item[1]), x1=float(item[2]), y1=float(item[3]))
                for item in page.get_text("words")
            ]
            layer = page.get_text("text") or ""
            regions: list[dict] = []
            if not regions and words:
                regions.append({"page": index + 1, "bbox": _bounds(words), "source": "word-cluster"})
            image_path = None
            if len(layer.strip()) < 40:
                pixmap = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
                image_path = _retain(pixmap.tobytes("png"), index + 1)
            pages.append(PageRead(index + 1, layer.strip(), words, image_path, 1.0 if layer.strip() else 0.0, regions))
        return PdfRead("\n".join(page.text for page in pages).strip(), pages, tables, len("".join(page.text for page in pages)) < 80)
    finally:
        document.close()


def ocr_pages(pages: list[PageRead]) -> list[PageRead]:
    read: list[PageRead] = []
    for page in pages:
        if len(page.text) >= 40 and page.words:
            read.append(page)
            continue
        if not page.image_path:
            read.append(page)
            continue
        png = Path(page.image_path).read_bytes()
        words, confidence, error = ocr_png(png)
        text = " ".join(word.text for word in words).strip()
        read.append(PageRead(page.number, text, words, page.image_path, confidence if not error else 0.0, page.table_regions))
    return read


def ocr_png(png: bytes) -> tuple[list[Word], float, str]:
    prepared = _preprocess(png)
    try:
        from rapidocr_onnxruntime import RapidOCR
    except Exception:
        return [], 0.0, "OCR engine is not installed"
    try:
        engine = RapidOCR()
        result, _elapsed = engine(prepared)
    except Exception as error:
        return [], 0.0, str(error)[:180]
    words: list[Word] = []
    scores: list[float] = []
    for row in result or []:
        if len(row) < 3:
            continue
        box, text, score = row[0], str(row[1]).strip(), float(row[2])
        if not text:
            continue
        xs = [point[0] for point in box]
        ys = [point[1] for point in box]
        words.append(Word(text, min(xs), min(ys), max(xs), max(ys), score))
        scores.append(score)
    confidence = sum(scores) / len(scores) if scores else 0.0
    return words, confidence, ""


def timetable_from_words(words: list[Word], heading: str = "") -> TimetableGrid:
    grid = TimetableGrid(
        department=_field(heading, r"department\s+([A-Za-z&]+)"),
        year=_field(heading, r"\byear\s+([IVX0-9]+)"),
        semester=_field(heading, r"\bsemester\s+([IVX0-9]+)"),
        section=_field(heading, r"\bsection\s+([A-Z0-9]+)"),
        academicYear=(YEAR.search(heading).group(1) if YEAR.search(heading) else None),
    )
    rows = _rows(words)
    header = next((row for row in rows if any(word.text.lower() in DAYS for word in row)), None)
    if not header:
        grid.unreadable = True
        return grid
    columns = [(word.text.lower(), (word.x0 + word.x1) / 2) for word in header if word.text.lower() in DAYS]
    columns.sort(key=lambda item: item[1])
    boundaries = [item[1] for item in columns]
    header_y = sum((word.y0 + word.y1) / 2 for word in header) / len(header)
    for row in rows:
        row_y = sum((word.y0 + word.y1) / 2 for word in row) / len(row)
        if row_y <= header_y + 4:
            continue
        period_word = next((word for word in row if re.fullmatch(r"\d{1,2}", word.text)), None)
        period = int(period_word.text) if period_word else None
        for index, (day, center) in enumerate(columns):
            left = boundaries[index - 1] + (center - boundaries[index - 1]) / 2 if index else center - 80
            right = boundaries[index + 1] - (boundaries[index + 1] - center) / 2 if index + 1 < len(boundaries) else center + 80
            cell_words = [word for word in row if left <= (word.x0 + word.x1) / 2 < right and word is not period_word]
            grid.periods.append(_cell(day, period, cell_words))
    if not grid.periods:
        grid.unreadable = True
    return grid


def calendar_from_text(text: str) -> list[CalendarEvent]:
    events: list[CalendarEvent] = []
    year = None
    semester = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        found = YEAR.search(line)
        if found:
            year = re.sub(r"\s+", "", found.group(1))
        semester_match = re.search(r"\bsemester\s+([IVX0-9]+)\b", line, re.I)
        if semester_match:
            semester = semester_match.group(1)
        dates = DATE.findall(line)
        if not dates:
            continue
        label = DATE.sub(" ", line)
        label = YEAR.sub(" ", label)
        label = re.sub(r"\bsemester\s+[IVX0-9]+\b", " ", label, flags=re.I)
        label = re.sub(r"\s+", " ", label).strip(" :-")
        if len(label) < 3:
            continue
        kind = "examination" if re.search(r"exam", label, re.I) else "holiday" if re.search(r"holiday|sankranti|vacation", label, re.I) else "registration" if re.search(r"regist", label, re.I) else "working-days" if re.search(r"working day", label, re.I) else "event"
        events.append(CalendarEvent(year, semester, label, dates[0], dates[1] if len(dates) > 1 else None, kind))
    return events


def choose_calendar(question: str, groups: list[tuple[str | None, list[CalendarEvent]]]) -> tuple[str | None, list[CalendarEvent]]:
    requested = YEAR.search(question or "")
    if requested:
        key = _year_key(requested.group(1))
        chosen = [events for year, events in groups if _year_key(year) == key]
        return (requested.group(1), chosen[0] if chosen else [])
    dated = [(year, events) for year, events in groups if _year_key(year) is not None]
    if not dated:
        return None, []
    best = max(_year_key(year) or 0 for year, _events in dated)
    matched = [events for year, events in dated if _year_key(year) == best]
    label = next(year for year, events in dated if events is matched[0])
    return label, matched[0]


def describe_calendar(question: str, text: str) -> str:
    normalized = re.sub(r"[ \t]*\n[ \t]*", "\n", text or "")
    normalized = normalized.replace(". ", ".\n")
    events = calendar_from_text(normalized)
    if not events:
        return ""
    groups: dict[str | None, list[CalendarEvent]] = {}
    for event in events:
        groups.setdefault(event.academicYear, []).append(event)
    grouped = list(groups.items())
    year, chosen = choose_calendar(question, grouped)
    if not chosen:
        return ""
    lines = [f"Applicable academic calendar: {year or 'undated'}"]
    for event in chosen[:40]:
        end = f" to {event.end}" if event.end else ""
        lines.append(f"{event.kind}: {event.event} starts {event.start or 'unreadable'}{end}")
    lines.extend(calendar_conflicts(grouped))
    return "\n".join(lines)


def calendar_conflicts(groups: list[tuple[str | None, list[CalendarEvent]]]) -> list[str]:
    seen: dict[tuple[str, str], tuple[str | None, str | None]] = {}
    conflicts: list[str] = []
    for year, events in groups:
        for event in events:
            key = (str(_year_key(year)), event.event.lower())
            value = (event.start, event.end)
            if key in seen and seen[key] != value:
                conflicts.append(f"{event.event} for {year or 'an undated calendar'} has conflicting dates.")
            seen[key] = value
    return conflicts


def describe_timetable(grid: TimetableGrid) -> str:
    lines = []
    if grid.academicYear or grid.department:
        lines.append(
            " ".join(
                part
                for part in (
                    f"department {grid.department}" if grid.department else "",
                    f"year {grid.year}" if grid.year else "",
                    f"semester {grid.semester}" if grid.semester else "",
                    f"section {grid.section}" if grid.section else "",
                    grid.academicYear or "",
                )
                if part
            )
        )
    for cell in grid.periods:
        if cell.uncertain or not cell.subject:
            lines.append(f"{cell.day or 'day'} period {cell.period if cell.period is not None else 'unknown'} unreadable")
            continue
        timing = f"{cell.startTime or 'unknown'}-{cell.endTime or 'unknown'}"
        lines.append(
            " ".join(
                part
                for part in (
                    cell.day or "",
                    f"period {cell.period}" if cell.period is not None else "",
                    timing if cell.startTime or cell.endTime else "",
                    cell.subject,
                    cell.subjectCode or "",
                    cell.faculty or "",
                    cell.room or "",
                )
                if part
            )
        )
    return "\n".join(lines)


def confirmed_timetable(image_bytes: bytes) -> dict:
    """Read a timetable image and keep a cell only when a second OCR of that cell agrees."""
    png = _as_png(image_bytes)
    words, _confidence, error = ocr_png(png)
    if error or not words:
        return {"read": False, "periods": []}
    periods = _validated_periods(png, words)
    return {"read": bool(periods), "periods": periods}


def _validated_periods(png: bytes, words: list[Word]) -> list[dict]:
    day_labels = _day_labels(words)
    columns = _period_columns(png, words, day_labels)
    if len(day_labels) < 3 or len(columns) < 4:
        return []
    confirmed: list[dict] = []
    for index, day_word in enumerate(day_labels):
        next_day = day_labels[index + 1] if index + 1 < len(day_labels) else None
        top = day_word.y0 - 4
        bottom = next_day.y0 - 4 if next_day else day_word.y1 + (day_word.y1 - day_word.y0) * 2
        for column in columns:
            cell_words = [
                word
                for word in words
                if word is not day_word and top <= (word.y0 + word.y1) / 2 < bottom and column["left"] <= (word.x0 + word.x1) / 2 < column["right"]
            ]
            subject = _subject_text(cell_words)
            if not subject:
                continue
            crop_words, _, crop_error = ocr_png(_crop_png(png, [column["left"], top, column["right"], bottom]))
            if crop_error or not _text_confirmed(subject, " ".join(word.text for word in crop_words)):
                continue
            confirmed.append(
                {
                    "dayOfWeek": day_word.text.lower(),
                    "periodNumber": column["period"],
                    "startTime": column["startTime"],
                    "endTime": column["endTime"],
                    "subjectName": subject,
                    "subjectCode": None,
                    "faculty": None,
                    "room": None,
                }
            )
    return confirmed


def _day_labels(words: list[Word]) -> list[Word]:
    days = [word for word in words if word.text.strip().lower() in DAYS]
    if len(days) < 3:
        return []
    left = min((word.x0 + word.x1) / 2 for word in days)
    chosen: dict[str, Word] = {}
    for word in days:
        if abs((word.x0 + word.x1) / 2 - left) > 90:
            continue
        name = word.text.strip().lower()
        if name not in chosen or word.y0 < chosen[name].y0:
            chosen[name] = word
    ordered = sorted(chosen.values(), key=lambda word: word.y0)
    return ordered if len(ordered) >= 3 else []


def _period_columns(png: bytes, words: list[Word], day_labels: list[Word]) -> list[dict]:
    if not day_labels:
        return []
    first_day = min(word.y0 for word in day_labels)
    numbers = [word for word in words if re.fullmatch(r"[1-9]", word.text.strip()) and (word.y0 + word.y1) / 2 < first_day]
    band = _nearest_band(numbers, first_day)
    chosen: list[Word] = []
    for word in sorted(band, key=lambda item: item.x0):
        if any(abs(word.x0 - kept.x0) < 25 for kept in chosen):
            continue
        chosen.append(word)
    if len(chosen) < 4:
        return []
    centers = [(word.x0 + word.x1) / 2 for word in chosen]
    columns = []
    for index, word in enumerate(chosen):
        left = (centers[index - 1] + centers[index]) / 2 if index else centers[index] - (centers[1] - centers[0]) / 2
        right = (centers[index] + centers[index + 1]) / 2 if index + 1 < len(centers) else centers[index] + (centers[index] - centers[index - 1]) / 2
        start, end = _confirmed_header_time(png, words, word, first_day, left, right)
        columns.append({"period": int(word.text), "left": left, "right": right, "startTime": start, "endTime": end, "header": word})
    return columns


def _nearest_band(words: list[Word], anchor: float) -> list[Word]:
    bands: list[list[Word]] = []
    for word in sorted(words, key=lambda item: (item.y0 + item.y1) / 2):
        center = (word.y0 + word.y1) / 2
        if bands and abs(center - sum((item.y0 + item.y1) / 2 for item in bands[-1]) / len(bands[-1])) <= 18:
            bands[-1].append(word)
        else:
            bands.append([word])
    below = [band for band in bands if sum((item.y0 + item.y1) / 2 for item in band) / len(band) < anchor]
    if not below:
        return []
    return max(below, key=lambda band: (len(band), sum((item.y0 + item.y1) / 2 for item in band) / len(band)))


def _confirmed_header_time(png: bytes, words: list[Word], number: Word, first_day: float, left: float, right: float) -> tuple[str | None, str | None]:
    header_words = [
        word
        for word in words
        if word is not number and number.y1 <= (word.y0 + word.y1) / 2 < first_day and left <= (word.x0 + word.x1) / 2 < right
    ]
    times = re.findall(r"\d{1,2}:\d{2}", " ".join(word.text for word in header_words))
    if len(times) < 2 or not header_words:
        return None, None
    crop_words, _, error = ocr_png(_crop_png(png, _bounds(header_words)))
    if error:
        return None, None
    crop = " ".join(word.text for word in crop_words)
    if times[0] not in crop or times[1] not in crop:
        return None, None
    return times[0], times[1]


def _subject_text(words: list[Word]) -> str | None:
    text = re.sub(r"\s+", " ", " ".join(word.text for word in words)).strip(" -|")
    text = re.sub(r"[←→]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    tokens = [re.sub(r"[^A-Za-z0-9]", "", token) for token in re.split(r"[\s/]+", text)]
    if not any(len(token) >= 2 for token in tokens):
        return None
    return text or None


def _text_confirmed(subject: str, crop_text: str) -> bool:
    haystack = re.sub(r"[^a-z0-9]", "", crop_text.lower())
    tokens = [re.sub(r"[^a-z0-9]", "", token.lower()) for token in re.split(r"[\s/]+", subject)]
    tokens = [token for token in tokens if len(token) >= 2]
    return bool(tokens) and all(token in haystack for token in tokens)


def _as_png(data: bytes) -> bytes:
    if data.startswith(b"\x89PNG"):
        return data
    import pymupdf

    kind = "jpeg" if data.startswith(b"\xff\xd8") else "png"
    document = pymupdf.open(stream=data, filetype=kind)
    try:
        page = document[0]
        return page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False).tobytes("png")
    finally:
        document.close()


def _crop_png(png: bytes, box: list[float]) -> bytes:
    import pymupdf

    document = pymupdf.open(stream=png, filetype="png")
    try:
        page = document[0]
        pad = 6
        clip = pymupdf.Rect(max(0, box[0] - pad), max(0, box[1] - pad), box[2] + pad, box[3] + pad)
        return page.get_pixmap(matrix=pymupdf.Matrix(2, 2), clip=clip, alpha=False).tobytes("png")
    finally:
        document.close()


def _cell(day: str, period: int | None, words: list[Word]) -> PeriodCell:
    if not words:
        return PeriodCell(day, period, None, None, None, None, None, None, True)
    text = " ".join(word.text for word in words)
    confidence = min(word.confidence for word in words)
    times = re.findall(r"\d{1,2}:\d{2}", text)
    code = re.search(r"\b([A-Z]{2,5}\d{2,4})\b", text)
    room = re.search(r"\b((?:R|LAB)-?\d{2,4})\b", text, re.I)
    faculty = re.search(r"\b(?:Dr|Prof)\.?\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?", text)
    subject = re.sub(r"\d{1,2}:\d{2}\s*[-–to]+\s*\d{1,2}:\d{2}", " ", text)
    if code:
        subject = subject.replace(code.group(1), " ")
    if room:
        subject = subject.replace(room.group(1), " ")
    if faculty:
        subject = subject.replace(faculty.group(0), " ")
    subject = re.sub(r"\s+", " ", subject).strip(" -") or None
    uncertain = confidence < 0.45 or subject is None
    return PeriodCell(day, period, times[0] if times else None, times[1] if len(times) > 1 else None, subject, code.group(1) if code else None, faculty.group(0) if faculty else None, room.group(1) if room else None, uncertain)


def _rows(words: list[Word]) -> list[list[Word]]:
    rows: list[list[Word]] = []
    for word in sorted(words, key=lambda item: ((item.y0 + item.y1) / 2, item.x0)):
        center = (word.y0 + word.y1) / 2
        if rows and abs(center - sum((item.y0 + item.y1) / 2 for item in rows[-1]) / len(rows[-1])) <= 10:
            rows[-1].append(word)
        else:
            rows.append([word])
    return rows


def _field(text: str, pattern: str) -> str | None:
    match = re.search(pattern, text, re.I)
    return match.group(1) if match else None


def _bounds(words: list[Word]) -> list[float]:
    return [min(word.x0 for word in words), min(word.y0 for word in words), max(word.x1 for word in words), max(word.y1 for word in words)]


def _retain(png: bytes, page_number: int) -> str | None:
    if not png.startswith(b"\x89PNG"):
        return None
    PAGE_DIR.mkdir(parents=True, exist_ok=True)
    path = PAGE_DIR / f"page-{page_number}-{abs(hash(png))}.png"
    path.write_bytes(png)
    return str(path)


def _preprocess(png: bytes) -> bytes:
    try:
        from PIL import Image, ImageFilter, ImageOps
    except Exception:
        return png
    image = Image.open(BytesIO(png)).convert("L")
    image = ImageOps.autocontrast(image).filter(ImageFilter.SHARPEN)
    if max(image.size) < 1200:
        image = image.resize((image.width * 2, image.height * 2))
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _year_key(value: str | None) -> int | None:
    match = re.search(r"20\d{2}", value or "")
    return int(match.group(0)) if match else None
