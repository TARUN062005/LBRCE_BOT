import unittest
from io import BytesIO
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw, ImageFont

from app.browser_capture import CaptureError, capture_official
from app.documents import calendar_conflicts, calendar_from_text, choose_calendar, inspect_pdf, ocr_pages, ocr_png, timetable_from_words
from app.images import matching_images


def _line_pdf(pages: list[list[str]]) -> bytes:
    document = pymupdf.open()
    for lines in pages:
        page = document.new_page()
        y = 72
        for line in lines:
            page.insert_text((72, y), line)
            y += 22
    data = document.tobytes()
    document.close()
    return data


def _timetable_pdf() -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=900, height=500)
    page.insert_text((40, 40), "Department CSE Year III Semester I Section A 2026-27")
    page.insert_text((40, 90), "Period")
    page.insert_text((150, 90), "Monday")
    page.insert_text((620, 90), "Tuesday")
    page.insert_text((40, 130), "1")
    page.insert_text((150, 130), "09:00-10:00 Algorithms CS301 Dr Rao R101")
    data = document.tobytes()
    document.close()
    return data


def _scanned_pdf() -> bytes:
    image = Image.new("RGB", (900, 220), "white")
    font = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 52)
    ImageDraw.Draw(image).text((30, 70), "CSE MONDAY", font=font, fill="black")
    encoded = BytesIO()
    image.save(encoded, format="PNG")
    document = pymupdf.open()
    page = document.new_page()
    page.insert_image(pymupdf.Rect(40, 40, 520, 180), stream=encoded.getvalue())
    data = document.tobytes()
    document.close()
    return data


class DocumentTests(unittest.TestCase):
    def test_text_pdf_keeps_a_timetable_grid_and_an_empty_cell(self) -> None:
        read = inspect_pdf(_timetable_pdf())
        self.assertFalse(read.scanned)
        self.assertIsNone(read.pages[0].image_path)
        grid = timetable_from_words([word for page in read.pages for word in page.words], read.text_layer)
        monday = next(cell for cell in grid.periods if cell.day == "monday")
        tuesday = next(cell for cell in grid.periods if cell.day == "tuesday")
        self.assertEqual(grid.department, "CSE")
        self.assertEqual(grid.academicYear.replace(" ", ""), "2026-27")
        self.assertEqual(monday.subject, "Algorithms")
        self.assertEqual(monday.subjectCode, "CS301")
        self.assertEqual(monday.startTime, "09:00")
        self.assertEqual(monday.endTime, "10:00")
        self.assertEqual(monday.faculty, "Dr Rao")
        self.assertEqual(monday.room, "R101")
        self.assertFalse(monday.uncertain)
        self.assertIsNone(tuesday.subject)
        self.assertTrue(tuesday.uncertain)

    def test_scanned_pdf_is_rendered_and_not_treated_as_empty(self) -> None:
        read = inspect_pdf(_scanned_pdf())
        self.assertTrue(read.scanned)
        self.assertLess(len(read.text_layer), 80)
        self.assertTrue(Path(read.pages[0].image_path).is_file())
        recognized = ocr_pages(read.pages)
        words, confidence, error = ocr_png(Path(read.pages[0].image_path).read_bytes())
        if error:
            self.assertEqual(recognized[0].text, "")
            self.assertEqual(confidence, 0.0)
        else:
            self.assertGreater(confidence, 0)
            self.assertTrue(any("CSE" in word.text.upper() or "MONDAY" in word.text.upper() for word in words))

    def test_unreadable_page_does_not_invent_a_subject(self) -> None:
        grid = timetable_from_words([], "Department CSE")
        self.assertTrue(grid.unreadable)
        self.assertEqual(grid.periods, [])

    def test_multi_page_calendars_prefer_the_named_year_and_report_conflicts(self) -> None:
        data = _line_pdf(
            [
                ["Academic year 2023-24 Semester I", "Registration 01-07-2023 05-07-2023", "Sankranti holiday 14-01-2023 15-01-2023"],
                ["Academic year 2026-27 Semester I", "Registration 01-07-2026 04-07-2026", "Examinations 20-04-2026 30-04-2026"],
            ]
        )
        read = inspect_pdf(data)
        self.assertGreaterEqual(len(read.pages), 2)
        groups = []
        for page in read.pages:
            events = calendar_from_text(page.text)
            groups.append((events[0].academicYear if events else None, events))
        _label, older = choose_calendar("Explain the 2023-24 academic calendar", groups)
        self.assertEqual(older[0].start, "01-07-2023")
        _latest, current = choose_calendar("Explain the latest academic calendar", groups)
        self.assertEqual(current[0].academicYear.replace(" ", ""), "2026-27")
        conflicted = groups + [("2026-27", calendar_from_text("Academic year 2026-27\nRegistration 02-07-2026 06-07-2026"))]
        self.assertTrue(calendar_conflicts(conflicted))

    def test_failed_ocr_keeps_the_page_image_and_no_invented_text(self) -> None:
        read = inspect_pdf(_scanned_pdf())
        original = ocr_png
        try:
            import app.documents as documents

            documents.ocr_png = lambda _png: ([], 0.0, "OCR failed")
            recognized = documents.ocr_pages(read.pages)
        finally:
            import app.documents as documents

            documents.ocr_png = original
        self.assertEqual(recognized[0].text, "")
        self.assertEqual(recognized[0].confidence, 0.0)
        self.assertTrue(Path(recognized[0].image_path).is_file())


class ImageTests(unittest.TestCase):
    def test_image_search_uses_ocr_text_and_hides_private_records(self) -> None:
        records = [
            {"title": "CSE timetable", "department": "CSE", "academicYear": "2026-27", "pageNumber": 2, "ocrText": "Monday Algorithms", "sourceUrl": "https://www.lbrce.ac.in/cse.png"},
            {"title": "Campus", "description": "Front lawn", "sourceUrl": "https://www.lbrce.ac.in/lawn.jpg"},
            {"title": "CSE list", "context": "student roster", "sourceUrl": "https://www.lbrce.ac.in/private.png"},
        ]
        found = matching_images(records, "CSE Monday")
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["academicYear"], "2026-27")


class BrowserTests(unittest.TestCase):
    def test_real_navigation_returns_a_png_and_viewer_text(self) -> None:
        def prepare(page) -> None:
            def handle(route) -> None:
                if "viewer.html" in route.request.url:
                    route.fulfill(content_type="text/html", body="<html><body><p>Embedded timetable Algorithms period 1</p></body></html>")
                else:
                    route.fulfill(
                        content_type="text/html",
                        body="<!doctype html><html><body style='height:2400px'><p>This academic calendar explains the CSE semester for 2026-27.</p><iframe src='https://www.lbrce.ac.in/viewer.html'></iframe></body></html>",
                    )

            page.route("**/*", handle)

        result = capture_official("https://www.lbrce.ac.in/academic_pages/aycalender.php", resolver=lambda _host: ["1.1.1.1"], prepare=prepare)
        self.assertTrue(result["screenshot"])
        self.assertIn("academic calendar", result["extractedText"].lower())
        self.assertIn("Algorithms", result["extractedText"])

    def test_redirect_off_domain_is_blocked(self) -> None:
        def prepare(page) -> None:
            def handle(route) -> None:
                if route.request.url.startswith("https://www.lbrce.ac.in"):
                    route.fulfill(status=302, headers={"location": "https://example.com/out"})
                else:
                    route.fulfill(content_type="text/html", body="<html><body>outside</body></html>")

            page.route("**/*", handle)

        with self.assertRaises(CaptureError) as caught:
            capture_official("https://www.lbrce.ac.in/academic_pages/aycalender.php", resolver=lambda _host: ["1.1.1.1"], prepare=prepare)
        self.assertRegex(str(caught.exception), "allowlist|official|Login|HTTPS")

    def test_missing_chromium_and_failed_screenshot(self) -> None:
        with self.assertRaises(CaptureError) as missing:
            capture_official(
                "https://www.lbrce.ac.in/academic_pages/aycalender.php",
                resolver=lambda _host: ["1.1.1.1"],
                executable_path=r"C:\lbrce-missing-chromium\chrome.exe",
            )
        self.assertIn("not installed", str(missing.exception).lower())

        def prepare(page) -> None:
            page.route("**/*", lambda route: route.fulfill(content_type="text/html", body="<html><body><p>Academic calendar 2026-27</p></body></html>"))

        with self.assertRaises(CaptureError) as failed:
            capture_official(
                "https://www.lbrce.ac.in/academic_pages/aycalender.php",
                resolver=lambda _host: ["1.1.1.1"],
                prepare=prepare,
                capture=lambda _page: b"not-a-png",
            )
        self.assertIn("screenshot", str(failed.exception).lower())


if __name__ == "__main__":
    unittest.main()
