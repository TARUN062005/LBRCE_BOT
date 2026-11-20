# LBRCE AI — implementation report

## What changed

The live Express chat path now resolves the questions below before the general model:

- Placement-team questions download `https://www.lbrce.ac.in/placements/placementcontact.php` and answer from the printed name and designation. A malformed or obfuscated email line is quoted and not corrected.
- Photo questions download the official gallery index and return those image URLs. Homepage banners are excluded.
- “Show the academic calendar” asks for the year. If the downloaded file’s OCR text contains more than one regulation code, the chat asks which one. The PDF is then shown and the OCR lines are returned with the file URL.
- “Compare CSE and ECE” downloads the two official department homepages and builds a table. A field that is not printed is “Not stated on the official page.”
- “What about its faculty?” keeps the department from the previous user message and lists indexed faculty for that department. Hostel and canteen names are dropped.

## OCR

- `@napi-rs/canvas` was installed in the API workspace.
- `OCR_ENABLED=true` was set in `apps/api/.env`. The running health check returned `ocr: true`.
- `ocrPdf` now passes `canvasImport` to `unpdf` `renderPageAsImage` and OCRs the first two pages with Tesseract.
- A direct run on `Academic_Calendars_2026-27.pdf` produced 2,524 characters in 21.9 seconds, including `Regulations: R26` and `Commencement of Class Work 10-08-2026`. Native text extraction of the same file is 7 characters, so this file is image-based.

## Files

- `apps/api/src/retrieval/placements.ts` and `placements.test.ts`
- `apps/api/src/retrieval/gallery.ts`
- `apps/api/src/retrieval/web-images.ts` (public image search; it returned no results in this environment)
- `apps/api/src/retrieval/compare.ts`
- `apps/api/src/services/chat.service.ts`
- `apps/api/src/ingestion/extract.ts`
- `apps/api/src/retrieval/search.ts`
- `apps/api/src/retrieval/assemble.ts` (optional faculty note)
- `apps/api/src/integrations/official-pages.ts`
- `apps/api/src/models/index.ts` (`AgentRun` export)
- `apps/agent/app/official.py` and `apps/agent/app/tools.py` (placements contact page is discovered first)
- `apps/web/src/pages/ChatPage.tsx` (source link on the answer is shown)

## Not changed

- No answers were hardcoded for the test questions.
- Student-roster refusal was not weakened.
- The Python process that was already listening on port 4100 was not restarted, so its new discovery order is on disk and not in that process. The live placement, gallery, calendar, and comparison results came from Express, which reads the new code.
- Indexed faculty and timetable collections were not rebuilt.
- No admin retrieval-debug screen was added.
