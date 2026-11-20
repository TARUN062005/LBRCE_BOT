# LBRCE AI — system audit

This audit records the defects found in the running chat path before this overhaul. A function existing in the repo was not treated as proof that the live API used it.

## Runtime path

1. The browser posts to the Express API (`POST /api/chat`).
2. `answerQuestion` in `apps/api/src/services/chat.service.ts` stores the user message, classifies it, and searches MongoDB.
3. The Python agent on port 4100 is called only when the index does not already answer and the turn is not a structured faculty, timetable, roster, or rate-limited request. Calendar, photo, placement, and comparison turns were often spending their time in that agent or in Gemini even when a dedicated official page existed.
4. Local PDF OCR (`ocrPdf`) caught a missing canvas import and returned an empty string. The health endpoint reported `ocr: false`.
5. The model then wrote from whatever indexed chunks or web search came back. Grounding removed some unsupported numbers. It did not check that the source was the right page for the role, department, or document.

## Defects and root causes

| Defect | Root cause | Where |
| --- | --- | --- |
| Placement questions named a faculty-list Placement Officer or refused, and missed the placements team | Role lookup fetched `faculty.php` first. `placementcontact.php` was not a target. “Training and Placement Officer” and “Placement Officer” shared one matcher. | `roles.ts`, `chat.service.ts`, `official.py`, `official-pages.ts` |
| Photo requests showed homepage banners and a sentence that said no image URLs existed | Indexed slider images were attached. The gallery page was not required. The word “photos” did not match a `\bphoto\b` check, so the gallery fetch never ran. | `search.ts`, `chat.service.ts` |
| “What about its faculty?” after a campus question returned Civil Engineering and hostel labels | Follow-up carried a department only when the previous message had one. Faculty search did not drop hostel names. | `conversation.ts`, `search.ts` |
| “Compare CSE and ECE” was refused | The agent found no single chunk that answered the comparison and the refusal replaced both department pages. | `chat.service.ts` |
| Academic calendar was displayed and not read | The year reply returned the PDF URL for the browser viewer. Native text extraction of that PDF is 7 characters. OCR returned empty because `renderPageAsImage` was called without `canvasImport`, and `@napi-rs/canvas` was not installed. `OCR_ENABLED` was false. | `calendar-source.ts`, `extract.ts`, API `.env` |
| One calendar file prints more than one regulation | The listing has one PDF per year. R26 and R23 are inside that file. Choosing a year without asking the regulation returned every regulation in the file. | `chat.service.ts` |
| Timetable image was shown with zero period cells | The JPEG is real. Coordinate OCR was not producing a grid, and empty cells were correctly not invented. That failure remained. | `timetable/resolve.ts`, Python `documents.py` |
| `AgentRun` import crashed the API on reload | The schema existed in `models/index.ts` and was not exported. | `models/index.ts` |

## What was already real

- Official-domain fetch checks and the image download allowlist.
- Roster refusal for a complete identifiable student list.
- Faculty designation checks that do not treat a department HOD as Head of TP Cell.
- Python RapidOCR code for a scanned PDF when the agent actually downloads one. PaddleOCR is imported in one tool and is not installed. That import is a dead path.
