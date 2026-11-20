# LBRCE AI — remaining issues

These are incomplete. They are not hidden behind a passing summary.

1. **Public web and Google photographs do not work here.** `publicCollegePhotos` calls DuckDuckGo’s image endpoint. In this run it returned no images and no token. The chat did not invent URLs. Official gallery photographs do work.

2. **Calendar OCR is real and incomplete.** The 2026-27 PDF has almost no text layer. Tesseract read “Commencement of Class Work 10-08-2026” and also emitted garbage such as “Dasara Holidays iot0206”. The file contains both R26 and R23. Asking for R26 does not yet return only the R26 section. Misread lines are not verified dates.

3. **Timetable grids are still not read.** The earlier live CSE semester 7 section C JPEG was the right file and produced zero period cells. That was not fixed or re-tested. Empty cells are not filled in.

4. **The CSE department summary was not verified.** The follow-up faculty table was CSE-only and came from the index. The long department paragraph before it was not checked figure by figure against the live page.

5. **An unknown question that contains the word “fee” dumps official fee amounts** and then says it will not guess. That is still a bad answer.

6. **The research agent is not the path for the corrected questions.** Express handles placement, gallery, calendar, and comparison directly. The Python process on port 4100 was not restarted, so it is still running the previous discovery code.

7. **Image OCR of a JPEG timetable, thumbnail generation, and a full document lifecycle** (`discovered → downloaded → extracted → published`) were not rebuilt. Failed extraction can still sit in older indexed rows.

8. **Admin retrieval inspection** (intent, rejected sources, OCR text, citation check) was not added to the admin console.

9. **PaddleOCR is not installed.** One Python tool still imports it and will fail if called.

10. **OCR is limited to the first two PDF pages** so a calendar request stays bounded. Later pages are not read.
