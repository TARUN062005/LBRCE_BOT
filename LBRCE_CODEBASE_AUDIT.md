# LBRCE AI — Codebase Audit

Audit date: 20 November 2026. Read-only. No application code, dependencies, or behavior were changed.

This review classifies modules, then lists only the code that is unused, duplicated, or in conflict with the current bounded agent. Admin, crawling, PDF, OCR, timetable, image, and agent code are treated as in-scope unless a specific symbol has no runtime caller.

## 1. Architecture overview

The repository is a monorepo. The student talks only to the React app. The React app talks only to Express. Express keeps the session, chat history, faculty wizard, student-record limits, and the indexed answer. When the index does not already answer, Express asks the local Python agent. If that process is down, Express falls back to the older TypeScript agent and then to official-page fetch plus Gemini web search.

```text
Browser (apps/web, Vite, port 5173)
  cookie session, SSE chat, admin pages
        |
        v
Express (apps/api, port 4000)
  auth, history, faculty/roster/roll, retrieval, grounding
        |
        +-- index already answers --> Gemini or BharatCode, citations
        |
        +-- index does not answer, and not a test run
              |
              v
        FastAPI + LangGraph (apps/agent, 127.0.0.1:4100)
          classify → plan → retrieve → discover → fetch
          → PDF / OCR / vision / browser → verify → answer → index
              |
              +-- Python unreachable --> TypeScript agent
                    (apps/api/src/agent) then official pages / web search
        |
        v
MongoDB Atlas
  chunks, documents, crawled pages, faculty, timetables, images, jobs, agent runs
```

| Path | Role | Class |
| --- | --- | --- |
| `apps/web` | Chat, history delete, evidence blocks, admin screens | A for chat and admin UI; B for the API client |
| `apps/api` | HTTP, sessions, retrieval, ingestion, TypeScript fallback agent | A for chat/retrieval/admin; E for the fallback agent |
| `apps/agent` | Bounded LBRCE-only research agent | A |
| `packages/shared` | Zod contracts, seed paths, suggested questions | B |
| `apps/api/src/ingestion` | Crawl, upload, chunk, embed | B |
| `apps/api/src/retrieval` | Search, grounding, citations, public image filter | A |
| `apps/api/src/agent` | Fallback planner, PDF reader, Playwright | E, still required while Python can be absent |
| `docker-compose.yml` | Local MongoDB 7 for development | C |
| `README.md` | Operator overview | C, and currently stale |

Essential chat path: `ChatPage` streams `POST /api/chat/stream`. `chat.service.ts` answers from the index when the evidence is accepted, handles faculty steps and student lookups itself, and calls `askPythonAgent` only when the index is not enough, the turn is not one of those structured cases, the session is not rate-limited, and `NODE_ENV` is not `test`. Python refusals and answers are stored by Express. The browser never calls port 4100.

## 2. Unnecessary or conflicting behavior

Nothing in the tree is a second product. The items below are unnecessary only relative to the Python-first agent, or they conflict with the LBRCE-only rule.

| Item | Why it is unnecessary or conflicting |
| --- | --- |
| TypeScript agent in `apps/api/src/agent` | Repeats planning, PDF reading, browsing, timetable parsing, and verification. It remains the fallback when Python does not answer. |
| Gemini `googleSearch` plus DuckDuckGo in `apps/api/src/integrations` | Runs only after the Python agent does not handle the turn. Results are filtered to `lbrce.ac.in`, but the discovery step itself is not limited to the official site. |
| Node `ocrPdf` via `unpdf`, canvas, and optional `tesseract.js` | Admin ingestion still needs `unpdf`, Word, and Excel extraction. The canvas OCR branch returns an empty string when `@napi-rs/canvas` is absent, which is the current machine. Python PyMuPDF plus RapidOCR is the working OCR path. |
| Node `timetableFromText` | One period, with times left null when no clock is present. The Python grid parser keeps days, periods, and empty cells. |
| Python `calendar_from_text`, `choose_calendar`, `calendar_conflicts` | Correct year selection and conflict detection exist, and tests call them. `tools.read_pdf` does not. A live calendar answer still depends on raw text plus the model. |
| Python `images.py` | Same public-image idea as the Node matcher, but the graph never imports it. Live image answers use `apps/api/src/retrieval/images.ts`. |
| `acceptModelPlan` | Allowlist for a model-written tool plan. The live TypeScript orchestrator never asks the model to plan, and the Python graph is a fixed state machine. Only `agent.test.ts` calls it. |
| `listImagesPreview` | Exported controller with no route and no importer. |
| `_pymupdf` and `_paddle_or_blank` in `apps/agent/app/tools.py` | Older helpers. `inspect_pdf` and `ocr_png` replaced them. No caller remains. |
| Two official URL maps | `apps/api/src/integrations/official-pages.ts` and `apps/agent/app/official.py` list the same college paths and can drift. |
| `README.md` | Still describes the pre-agent flow and omits Python, BharatCode, and Playwright. |
| Root `dev:agent` | Runs system `python`, not `apps/agent/.venv`. Packages installed only in the virtualenv are invisible to that script. |
| `requirements.txt` | Does not pin `playwright` or `rapidocr-onnxruntime`, which are what the local agent actually uses. `requirements-document.txt` pins PaddleOCR and Docling, which are not installed and are not imported successfully on this machine. |

## 3. Dead-code candidates

A symbol is listed here only when search found a definition and no route, import, or dynamic caller. Public HTTP routes that the React app does not call are listed separately. They are reachable and several are covered by integration tests.

### Unreferenced

| Symbol | Path | Evidence |
| --- | --- | --- |
| `listImagesPreview` | `apps/api/src/controllers/public.controller.ts` | Exported. `app.ts` does not import it. No other file names it. |
| `_pymupdf` | `apps/agent/app/tools.py` | Defined only. `read_pdf` calls `inspect_pdf`. |
| `_paddle_or_blank` | `apps/agent/app/tools.py` | Defined only. `ocr` calls `ocr_pages`, which uses RapidOCR. |

### Implemented and tested, not on the live agent path

| Symbol | Path | What calls it |
| --- | --- | --- |
| `acceptModelPlan` | `apps/api/src/agent/policy.ts` | `apps/api/src/agent/agent.test.ts` only. `orchestrator.ts` uses `planTools`. |
| `calendar_from_text`, `choose_calendar`, `calendar_conflicts` | `apps/agent/app/documents.py` | `apps/agent/tests/test_documents.py` only. |
| `matching_images` | `apps/agent/app/images.py` | `apps/agent/tests/test_documents.py` only. |

`run_agent` accepts `history` and then discards it. The FastAPI models accept history as well. That is an unused input, not a dead module. Express still stores history itself.

### Registered HTTP, not called by the React UI

These stay. Tests call `POST /api/chat` and `GET /api/documents`. Removing them is an API change, not dead-code deletion.

| Method and path | Server use | UI |
| --- | --- | --- |
| `POST /api/chat` | Integration tests | Chat uses `/api/chat/stream` only |
| `GET /api/search` | Registered in `app.ts` | No caller in `apps/web` |
| `GET /api/sources/:id` | Registered, roster lines redacted | No caller in `apps/web` |
| `GET /api/documents`, `GET /api/documents/:id` | Registered; documents list is tested | No caller in `apps/web` |
| `GET /api/timetables`, `/search`, `/:id` | Registered | Admin uses `/api/admin/timetables` |
| `GET /api/images/search` | Registered; chat uses `imageSearch` internally | No caller in `apps/web` |
| `POST /api/admin/auth/logout`, `GET /api/admin/me` | Registered | Login is the only admin auth call in the UI |
| `GET /api/admin/documents/:id`, `POST .../reprocess` | Registered | List, upload, publish, and archive are used |
| `POST /api/admin/sources/refresh` | Alias of ingestion | No caller in `apps/web` |

`GET /api/health` is operational. It does not report whether the Python agent is up.

### Checked and not dead

Chat, sidebar, answer blocks, citations, tables, timetable view, image gallery, and markdown view are all imported. Admin dashboard, ingestion, documents, timetables, retrieval, and agent-run log are all called from `AdminPages.tsx`. Faculty, department, user, feedback, audit log, college source, ingestion job, and agent-run models are used. Seed, crawl report, hash, time, logger, SSRF, session cookie, and shared schemas are used. `crawl-report.ts` has a pre-existing TypeScript error on the mongoose lean union. That script is still the `npm run crawl` target.

## 4. Duplicate implementations

| Concern | Current path | Older or parallel path |
| --- | --- | --- |
| Research agent | `apps/agent/app/graph.py`, `tools.py` | `apps/api/src/agent/orchestrator.ts`, `plan.ts`, `pdf.ts` |
| Browser | `apps/agent/app/browser_capture.py` | `apps/api/src/agent/browser.ts` |
| Official targets | `apps/agent/app/official.py` | `apps/api/src/integrations/official-pages.ts` |
| PDF bytes | PyMuPDF `inspect_pdf` | `unpdf` in `apps/api/src/ingestion/extract.ts` and `apps/api/src/agent/pdf.ts` |
| OCR | RapidOCR in `documents.py` | Optional `tesseract.js` in `extract.ts`; PaddleOCR helper is dead |
| Timetable | `timetable_from_words` | `timetableFromText` in `policy.ts`; upload parser in `apps/api/src/timetable/parse.ts` |
| Calendar | `calendar_from_text` and `choose_calendar` (not wired) | `calendarEvents` in `policy.ts` (year tokens only) |
| Image match | `apps/api/src/retrieval/images.ts` | `apps/agent/app/images.py` |
| Verification | `apps/agent/app/verify.py` and Express `figuresSupported` | `apps/api/src/agent/policy.ts` |
| LLM answer | Python generate: Gemini, then BharatCode, then an extract | Node `FallbackProvider` for index answers and the TypeScript agent |

The upload timetable parser is not a duplicate of the PDF grid parser. It classifies files that an administrator uploads. Keep it.

Express still checks numbers in a Python answer against Python evidence. That second check is intentional and should stay.

## 5. Dependencies

| Package | Where declared | Verdict |
| --- | --- | --- |
| `react`, `vite`, `express`, `mongoose`, `zod`, `@google/genai` | workspaces | Used |
| `playwright` `^1.65.1` | `apps/api` | Used by the TypeScript fallback browser and its live test |
| `unpdf`, `mammoth`, `xlsx` | `apps/api` | Used by admin ingestion |
| `tesseract.js` | `apps/api` | Optional dynamic import. No effect until a page image exists and `OCR_ENABLED` is on. Not currently the working OCR |
| `@napi-rs/canvas` | not installed | `ocrPdf` looks for it and returns `''` when missing |
| `pino-pretty` | `apps/api` dependencies | Used only as the development log transport |
| `mongodb-memory-server`, `vitest`, testing libraries | devDependencies | Test only |
| FastAPI, LangGraph, PyMongo, google-genai, PyMuPDF, Pillow, httpx | `apps/agent/requirements.txt` | Used |
| `playwright`, `rapidocr-onnxruntime` | installed in `apps/agent/.venv`, not listed in `requirements.txt` | Used by the working agent |
| `paddlepaddle`, `paddleocr`, `docling`, `opencv-python-headless` | `requirements-document.txt` | Not installed. `_paddle_or_blank` is unused. Docling is attempted only when importable and text is shorter than 80 characters |
| `opencv-python` | pulled in by RapidOCR | Would duplicate `opencv-python-headless` if both requirement files were installed |

No package was found that exists only to support an unrelated feature. The unused surface is small: `pino-pretty` is a production-dependency classification mistake, and the document-stack file describes libraries this environment does not run.

### Vulnerabilities

A later `npm audit` completed with 19 vulnerabilities: 1 low, 10 moderate, 6 high, and 2 critical. Nothing was upgraded. The moderate findings are mostly in ESLint tooling. High and critical packages still need a separate review before any upgrade, especially Express, Mongoose, and Playwright.

## 6. Security and maintainability

| Issue | Severity | Notes |
| --- | --- | --- |
| Python port and token | Critical to keep | Bind is `127.0.0.1`. Production must set `AGENT_INTERNAL_TOKEN` and must not use the `local-dev` token. `/health` is unauthenticated and returns only status. |
| SSRF | Critical to keep | Node and Python allow only official college HTTPS, block private DNS, and block ERP login URLs. Browser redirects are checked again. |
| Fallback web search | High | If Python is down, Gemini Google Search and DuckDuckGo still run. Domain filtering happens after discovery. |
| Two agents | High | Official URLs, timetable parsing, and browser rules can diverge. The student-facing answer then depends on which process answered. |
| Session on first chat body | Medium | History and delete are cookie-only. The first `POST` can still bind a client-supplied session id before the cookie exists. This is not student login. |
| Public read APIs | Medium | Document, timetable, image, and source routes are mounted without the admin JWT. Source text redacts roster lines. Image search uses the public-record filter. The extra routes still widen the surface the UI does not need. |
| Agent history ignored | Medium | The Python request accepts history and drops it, so a follow-up can re-plan without the prior turn. |
| Calendar chooser not wired | Medium | Year selection and conflict detection do not affect live PDF answers. |
| Secrets in logs | Low if current code stays | Agent runs store provider and tool activity. Tokens, cookies, and keys are not written by the current Python client. |
| `crawl-report.ts` type error | Low | `tsc` fails on that script only. Runtime crawl can still be wrong if the lean shape does not match the logger. |
| Stale README and unpinned Python extras | Medium for operators | A new machine can start the agent without Chromium or RapidOCR and believe OCR and browsing are unavailable. |
| Uploaded page images | Low | `uploads/agent-pages` is gitignored local PNG storage. Citations stay on `https://lbrce.ac.in` URLs. |
| Old Playwright builds on the workstation | Low, not in git | User Playwright folder still has older Chromium, Firefox, and WebKit builds beside Chromium 1255. |

Student chunks stay out of general retrieval. Roster wording is refused. Roll lookup is rate-limited. Those controls live in Express, not in the Python graph. Deleting the Node chat path would remove them.

## 7. Recommended removals

Do not remove these in the same change as the agent. Each line is a later, separate cleanup.

| Priority | Remove or retire | Complexity | Risk |
| --- | --- | --- | --- |
| Medium | `listImagesPreview` | Low. One function, no route | Low |
| Medium | `_pymupdf` and `_paddle_or_blank` | Low. Confirm tests still import nothing from them | Low |
| Medium | Move `pino-pretty` to devDependencies | Low | Low |
| Medium | Pin `playwright` and `rapidocr-onnxruntime` in the agent requirements, and point `dev:agent` at the virtualenv | Low | Low. Avoids a silent missing-OCR setup |
| High | After Python covers faculty steps, roster refusal, roll lookup, and index-sufficient answers, stop calling the TypeScript agent | High. Behavior parity first | High until that parity exists |
| High | After the fallback agent is gone, remove Node Playwright from the API workspace if no other caller remains | Medium | Medium. Live browser tests move to Python only |
| Medium | Either call `choose_calendar` from `read_pdf`, or stop presenting the Python calendar helpers as part of the live path | Medium | Medium. Wiring changes answers; deleting loses tested year selection |
| Medium | Either use one official target list, or generate one from the other | Low | Medium. A bad merge can drop a college page |
| Low | Drop Gemini Google Search and DuckDuckGo once Python is required in production | Medium | High if done while Python is optional. The bot would stop searching when port 4100 is down |
| Low | Unmount public list routes the UI and tests do not need, after updating tests | Medium | Medium. External scripts may call them |
| Low | Stop installing Paddle and Docling until a caller needs them | Low | Low. They are not installed now |

Do not remove ingestion, the upload timetable parser, admin routes the UI uses, Express grounding, or the Python graph.

## 8. Files to retain

| Area | Retain |
| --- | --- |
| Web | `apps/web/src/pages/ChatPage.tsx`, `AdminPages.tsx`, `App.tsx`, `api/client.ts`, `lib/session.ts`, `components/Sidebar.tsx`, `AnswerBlocks.tsx`, `Citations.tsx`, `DataTable.tsx`, `TimetableView.tsx`, `ImageGallery.tsx`, `MarkdownView.tsx` |
| API chat | `controllers/public.controller.ts` except the unused preview function, `controllers/admin.controller.ts`, `services/chat.service.ts`, `security/session.ts`, `security/ssrf.ts`, `retrieval/search.ts`, `retrieval/grounding.ts`, `retrieval/images.ts`, `retrieval/citations.ts`, `integrations/python-agent.ts`, `integrations/gemini/provider.ts`, BharatCode fallback |
| API knowledge | `ingestion/**`, `timetable/parse.ts`, `timetable/filename.ts`, `timetable/resolve.ts`, `models/index.ts`, `scripts/seed.ts`, `scripts/ensure-seed.ts`, `scripts/crawl-report.ts` |
| API fallback, until parity | `agent/orchestrator.ts`, `agent/plan.ts`, `agent/pdf.ts`, `agent/browser.ts`, `agent/policy.ts`, and their tests |
| Python | `app/main.py`, `graph.py`, `tools.py`, `documents.py`, `browser_capture.py`, `security.py`, `verify.py`, `official.py`, both test modules |
| Shared | `packages/shared/src/schemas.ts`, `constants.ts` |
| Ops | `apps/agent/DEPLOYMENT.md`, both `.env.example` files, `.gitignore` entries for `.venv`, `__pycache__`, and `uploads/` |

`apps/agent/app/images.py` should be retained only if the graph starts using it. Until then it is test-only.

## 9. Priority

| Priority | Item |
| --- | --- |
| Critical | Keep the Python listener private and token-checked. Keep SSRF and ERP-login blocks. Do not delete Express chat, faculty, roster, or grounding while cleaning duplicates. |
| High | Dual agents and the Google/DuckDuckGo fallback can answer the same question with different evidence. Official URL lists and timetable parsers can drift. |
| Medium | Dead helpers, calendar logic not wired, Python image helper not wired, ignored history, public routes the UI never calls, stale README, agent script not using the virtualenv, unpinned OCR and browser packages. |
| Low | `pino-pretty` dependency classification, `crawl-report.ts` types, local Mongo compose versus Atlas, leftover Playwright browser builds outside the repo, `/api/health` not showing agent status. |

## 10. Complexity and risk of cleanup

| Cleanup | Complexity | Risk if done carelessly |
| --- | --- | --- |
| Delete the three unreferenced symbols | About an hour, including test run | Low |
| Pin Python extras and fix the dev script | About an hour | Low |
| Share one official URL map | Half day | Medium. Missing a path changes discovery |
| Wire calendar selection into `read_pdf` | One to two days, with conflicting-year fixtures | Medium. Changes live calendar answers |
| Use the Node image matcher only, or call the Python one from the graph | One day | Medium. Must keep private-image exclusion |
| Make production refuse web search when the agent is down | Half day | High until Python is always deployed |
| Retire the TypeScript agent | Several days of parity work | High. Faculty wizard, roll lookup, and index answers never enter Python today |
| Remove public list endpoints | Half day plus test updates | Medium |
| `npm audit` triage | Separate from feature cleanup | High if `npm audit fix` is applied blindly to Express, Mongoose, or Playwright |

## What this audit did not do

No file other than this report was added or edited. No dependency was installed or removed. Tests were not re-run for this pass. The last recorded suites, from the multimodal completion on this tree, were: API Vitest 14 files and 96 tests passed; browser live test 4 passed; web 2 files and 6 tests passed; Python document and agent tests 18 passed. `tsc` for the API still reports only `apps/api/src/scripts/crawl-report.ts`.
