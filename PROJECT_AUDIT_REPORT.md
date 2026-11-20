# LBRCE AI Chatbot — Project Audit

Audit date: 12 November 2026.  
Scope: code on disk plus a live run of the API already listening on port 4000 and the web app on port 5173.  
No application source was changed for this audit. Temporary count and question scripts were removed after the run.

## 1. Executive Summary

This is a real retrieval-grounded chatbot, not a frontend demo. A browser chat calls an Express API. The API classifies the question, searches MongoDB (lexical text plus Atlas vector search), and asks Gemini to write from those passages. If the index does not answer, the API can open the official academic-calendar PDF or search the public web and keep only `lbrce.ac.in` pages. BharatCode (Qwen) is configured as a second model when Gemini fails. That fallback was not the model that produced the 15 answers in this run, because Gemini returned a response each time.

The indexed corpus is substantial: 50 crawled official pages, 905 published chunks, 314 faculty rows, 318 timetable records, and 734 images. It is not complete. Timetable period cells were not extracted (`timetableentries` = 0). The principal page and the hostels page are not in the crawled set. Scanned calendar text for Sankranti is absent (`sankranti` chunk count = 0). OCR is off.

Live answers were often grounded in official URLs. A nonsense question was refused. Two failures were retrieval or routing, not missing code: “examination timetable” was treated as a class timetable, and scholarship text that exists in the index was not retrieved.

## 2. Project Architecture

Monorepo (`package.json` workspaces):

| Path | Role |
| --- | --- |
| `apps/web` | React 19, Vite 7, Tailwind, React Router. Public UI is the chat. Admin UI remains. |
| `apps/api` | Express 4, Mongoose, ingestion crawler, retrieval, Gemini and BharatCode. |
| `packages/shared` | Zod chat contracts, department aliases, seed URLs, suggested questions. |

Runtime checked on 12 November 2026:

- `GET http://localhost:4000/api/health` returned `status: ok`, `mongo: connected`, `gemini: configured`, `bharatcode: configured`, `vectorSearch: atlas`, `ocr: false`.
- Web dev server: `http://localhost:5173/`.
- Browser calls the API directly when `apps/web/.env` sets `VITE_API_URL=http://localhost:4000` (`apps/web/src/api/client.ts`). The Vite proxy is unused in that configuration.

Persistence is MongoDB. Collections observed: `crawledpages` 50, `documents` 21, `documentchunks` 905 (all published), 558 chunks with an embedding model, `faculties` 314 (11 marked head), `departments` 11, `timetables` 318, `timetableentries` 0, `collegeimages` 734, `users` 1, `conversations` 10, `messages` 34.

## 3. Actual Chatbot Execution Flow

Public send path:

1. `ChatPage.submit` in `apps/web/src/pages/ChatPage.tsx` calls `streamChat` in `apps/web/src/api/client.ts`.
2. `POST /api/chat/stream` (`streamChat` in `apps/api/src/controllers/public.controller.ts`) runs `answerQuestion` in `apps/api/src/services/chat.service.ts` and streams `status`, `token`, and `done` events. `POST /api/chat` returns the same result as JSON. The audit used the JSON route.
3. A conversation is stored for a client-generated `sessionId` (`getSessionId` in `apps/web/src/lib/session.ts`, key `lbrce-session` in `localStorage`). There is no student login.
4. `detectIntent` and `extractEntities` in `apps/api/src/retrieval/intent.ts` label the question.
5. Special cases run before general RAG:
   - Registration numbers: `lookupStudents` in `apps/api/src/integrations/student-lookup.ts`.
   - Faculty with no department or no person: `planFacultyQuestion` / `resolveFacultyRequest` (`apps/api/src/retrieval/faculty-guide.ts`, `apps/api/src/retrieval/search.ts`).
   - Timetables: `resolveTimetableQuery` in `apps/api/src/timetable/resolve.ts`.
6. Otherwise `searchKnowledge` runs lexical `$text` search and semantic search. Semantic search uses Gemini embeddings and Atlas `$vectorSearch` when `VECTOR_SEARCH_INDEX` is set, then cosine similarity if that returns nothing (`search.ts`).
7. `generateNarrative` or `streamNarrative` calls the model with `SYSTEM_PROMPT` or `STREAM_SYSTEM_PROMPT` (`apps/api/src/integrations/gemini/prompt.ts`). The prompt says to use only the retrieved evidence.
8. If that answer is missing and the question is a calendar question, `loadOfficialCalendar` in `apps/api/src/integrations/calendar-source.ts` fetches the official PDF. Readable text is sent to the model. A scanned PDF is sent to `readDocument` (Gemini vision). BharatCode does not read PDFs.
9. If there is still no indexed or structured answer, `searchWeb` runs. Gemini tries the Google Search tool once. On failure it uses DuckDuckGo HTML, fetches up to three `lbrce.ac.in` pages (`apps/api/src/integrations/web-search.ts`), and summarizes them. Non-college links are dropped.
10. `assembleBlocks` in `apps/api/src/retrieval/assemble.ts` keeps citations that were actually retrieved and strips links whose host is not `lbrce.ac.in`. If nothing is produced, the block type is `insufficient_evidence`.
11. `getProvider` in `apps/api/src/integrations/gemini/provider.ts` returns a `FallbackProvider` (`apps/api/src/integrations/fallback-provider.ts`): Gemini, then BharatCode (`apps/api/src/integrations/bharatcode/provider.ts`) on rate limit, outage, or empty output. Embeddings stay on Gemini.

## 4. Frontend and Backend Verification

Frontend, verified in code and by the dev server being up:

- One public route, `/`. Other public paths redirect to `/` (`apps/web/src/App.tsx`).
- Chat column is fixed height. Messages scroll inside it.
- Assistant blocks render Markdown, tables, timetables, image galleries, citations, and clickable clarification chips (`apps/web/src/components/AnswerBlocks.tsx`).
- Sidebar: new chat, recent chats with delete (`DELETE /api/chat/:id?sessionId=`), and suggested prompts from `SUGGESTED_QUESTIONS` in `packages/shared/src/constants.ts`. Those strings are prompts, not stored facts.
- Thinking state is a status label plus animation while `status` is set.
- Admin screens: `/admin/login`, ingestion, documents, timetables, retrieval.

Backend endpoints that exist in `apps/api/src/app.ts`:

- Public: `POST /api/chat`, `POST /api/chat/stream`, `GET /api/chat/history`, `GET /api/chat/:id`, `DELETE /api/chat/:id`, plus search, documents, timetables, images, feedback.
- Admin, JWT: login, ingestion, uploads, publish, timetable verification.
- Health: `GET /api/health`.

The 15 live `POST /api/chat` calls all returned HTTP 200. That is executed evidence that the chat endpoint works against the connected database and the configured model.

## 5. AI Model and API Verification

Implemented and configured in the running process:

- Gemini via `@google/genai`. Model name comes from `GEMINI_MODEL` (default `gemini-3.5-flash` in `apps/api/src/config/env.ts`). The key is read from `.env` by `readGeminiApiKey` and is not returned by health.
- Embeddings: `gemini-embedding-001`, 768 dimensions. 558 of 905 chunks have an embedding. Student-list chunks are stored without embeddings (ingestion skips `documentType: student`).
- BharatCode: OpenAI-compatible `POST https://bharatcode.ai/api/model/v1/chat/completions`, default model `qwen-3.8-27b`, key `BHARATCODE_API_KEY`. Health reported `bharatcode: configured`. This audit did not capture a request that fell through to BharatCode.
- Thinking is set to minimal on Gemini so visible text is not consumed by hidden reasoning.
- Calls are serialized with a 1.5 s gap and retries on rate limit (`GeminiProvider.withRetry`).

Prompts forbid invented faculty, fees, dates, rooms, results, and placement stats, and they forbid links outside `lbrce.ac.in`. That is an instruction, not a guarantee. The web prompt still tells the model to use Google Search. The code may instead feed it fetched college pages. The saved web note says “Looked up on the public web” even when the pages are only the college site.

## 6. Dataset and Knowledge Coverage

Seed list: `OFFICIAL_SEED_PATHS` in `packages/shared/src/constants.ts`. The crawler only allows `lbrce.ac.in` (`assertPublicUrl` in `apps/api/src/security/ssrf.ts`).

Crawled URLs include the homepage, courses, admissions, fee structure, faculty, contact, exam notifications and timetables, placements and `stat2526.php`, gallery, department homepages and timetable pages, the library page, the academic calendar listing, academic regulations, and department student lists.

Not in the 50 stored page URLs: `administration_pages/principal.php`, `studentcorner_pages/hostels.php`. Those pages are seeds, but this crawl did not store them. The live bot still opened them through web fallback.

Chunk keyword counts (published text, case-insensitive), which only show that a word occurs, not that retrieval will select it:

| Topic | Chunks containing the word | What that means |
| --- | --- | --- |
| College overview | Homepage and admissions pages are crawled | Answered from the index in the live test |
| Departments and courses | `courses.php` crawled | Answered with official links |
| Faculty | 314 structured rows, 64 faculty chunks, 11 heads | HOD answered from the faculty collection in 1.7 s |
| Admissions | `admissions.php` crawled | Answered from the index |
| Fees | 11 `fee` chunks and 66 chunks containing “fee”; fee page crawled | Answered with amounts that also appear on the live fee page |
| Placements | 8 placement chunks; placements pages crawled | Answered from placement pages |
| Calendar | 22 calendar chunks; “sankranti” count is 0 | Listing answered from the index; holiday dates inside the scanned PDF were not used |
| Examinations | 80 circular chunks; exam pages crawled | “Examination timetable” was routed to the class-timetable clarifier |
| Timetables | 318 records, 0 period rows | Image and metadata only, unless an admin verifies cells |
| Attendance | 1 chunk | Live answer did not use that chunk |
| Scholarships | 28 chunks | Live answer did not use those chunks |
| Hostel | 18 chunks, but the hostels page itself was not crawled | Live answer used web fetch of the hostels page |
| Transport / bus | 22 “transport”, 57 “bus” | Not separately executed as its own question |
| Library / labs | Library page crawled; 9 “laboratory” chunks; 734 images | Campus-photo intent exists; not executed as its own question |
| Events | 39 chunks contain “event” | Not a dedicated events feed |
| Contact | `contact.php` crawled; 69 chunks contain “contact” | Answered from the contact page |
| Rules | 4 regulation chunks; regulations page crawled | Not executed as its own question |

Faculty rows by department include CSE 54, FED 45, ECE 37, CE 32, ME 27, IT 25, EEE 24, AI&DS 24, CSE (AI&ML) 20, MBA 14, ASE 11, plus one stray “Department of ME” row. Names such as “Department of CSE” are filtered out of the picker in `loadFaculty`.

There is no live attendance, fee-payment, or ERP integration. `erp.lbrce.ac.in` appeared only as a citation when web search was thin.

## 7. Online Search and Retrieval Capabilities

Online retrieval is implemented. It is not “the model remembers the web.”

| Mechanism | Status | Limit |
| --- | --- | --- |
| Google Search grounding on Gemini | Implemented in `GeminiProvider.collectWebAnswer`. One attempt, then fallback. | This key has previously returned quota errors. This audit did not log which branch ran. |
| DuckDuckGo HTML search | Implemented in `fetchWebEvidence`. | Result links that are not `lbrce.ac.in` are discarded. |
| Fetch official HTML | Implemented in `readPage`, with SSRF checks. | Up to 3 pages, HTML truncated. |
| Academic calendar PDF | Implemented in `loadOfficialCalendar` and `readDocument`. | Runs only when the index did not already produce an answer. A partial index hit blocks it. |
| BharatCode web search | Implemented as the same page-fetch path, no Google tool. | Not observed in this run. |
| Arbitrary news sites, social media, or non-college docs | Missing by design | The product drops those links. |
| Live “today’s notice” feed | Missing | The bot can only see crawled pages plus a fresh college-page fetch. |

Citations are rendered by `Citations` in `apps/web/src/components/Citations.tsx` and filtered with `isCollegeUrl`. A web answer can still cite a weak page, including the homepage or `erp.lbrce.ac.in`, when the fetch did not contain the fact.

## 8. Question-by-Question Test Results

Executed 12 November 2026 against `POST http://localhost:4000/api/chat` with `Origin: http://localhost:5173` and session `audit-session-20261112`. All 15 returned HTTP 200. Text below is truncated from the API. Official-page spot checks used `fetch` of the live college site after the answers.

1. **What is LBRCE?**  
   Local index. Text block. Cited `admissions.php` and department homepages. Described the college in Mylavaram. It also used promotional wording (“top colleges”) that the prompt would only allow if that wording was in the retrieved pages. Not independently sentence-checked.

2. **Who is the current principal of LBRCE?**  
   Not in the index. Web lookup, 9.3 s. Answer: Dr. K. Appa Rao, Professor, Mechanical Engineering, with `administration_pages/principal.php`. A direct fetch of that page returned HTTP 200 and the text includes “Appa Rao”. Extra citations included an ECE faculty page and an IT contact page, which are weaker sources for this fact.

3. **What departments are available?**  
   Local index. Cited `/` and `admission_pages/courses.php`. Listed engineering departments, MBA, and Freshman Engineering. The live courses page also contains the words “Information Technology”, so that list item is not an obvious invention. Full programme list was not diffed line by line.

4. **What is the current fee structure?**  
   Local index. Cited `feestructure.php` and `admission_pages/feestructure.php`. Stated B.Tech convener tuition ₹78,600 per year. The live fee page contains “78,600”. Other amounts in the answer (MBA, M.Tech, management quota) were not each re-checked.

5. **What companies visited LBRCE for placements?**  
   Local index. Cited `placements/stat2526.php` and `placements/index.php`. Named companies such as Cognizant, Infosys, Deloitte, HCL, Capgemini, Kia. Those names were not each confirmed on the page in this audit. The source URL is a real crawled placements page. Treat the company list as model output from retrieved text, not as a manually verified roster.

6. **What is the latest academic calendar?**  
   Local index. Cited `aycalender.php` and `Academic_Calendars_2023-24.pdf`. It listed calendar files through 2026–27 but only expanded the 2023–24 text. It did not open the newer scanned PDF. `sankranti` does not appear in any chunk. The PDF-vision path exists and did not run, because the index already produced an answer.

7. **What is the attendance requirement?**  
   Web fallback, even though one published chunk contains “attendance”. The model said the percentage was not on the fetched pages and pointed at the college homepage and `http://erp.lbrce.ac.in/Login/`. It did not invent a percentage. The ERP login link is a poor citation.

8. **Where can I find the examination timetable?**  
   Misrouted. Intent `timetable` wins over `examination` because `detectIntent` checks “timetable” first. Response type `clarification`: “Which department timetable should I use?” It did not open `examsection_pages/examtables.php`, which is crawled.

9. **What scholarships are available?**  
   Web fallback, despite 28 chunks containing “scholarship”. The model said a scheme list was not on the fetched pages and linked the homepage. It did not invent a scheme list. Retrieval failed to use local text.

10. **What are the hostel facilities?**  
    Web lookup of `studentcorner_pages/hostels.php` (that URL was not in the crawled set). Answer described a girls’ hostel of about 25,000 sq. ft. for about 300 students, mess, and solar hot water. The live hostels page returns HTTP 200 and contains “300” and “hostel”. The area and solar-water sentences were not separately confirmed.

11. **What is today's latest announcement at LBRCE?**  
    Web lookup. It said a specific announcement for today was not found and pointed at the homepage and `examnotific.php`. It did not invent a notice. There is no “latest today” feed.

12. **Who is the HOD of CSE?**  
    Structured faculty record, 1.7 s. “Dr.SEELAM NAGARJUNA REDDY”, Professor & HOD, CSE, source `quicklinks_pages/faculty.php`. This matches the indexed head flag. The live faculty HTML was not re-read in this audit.

13. **What is the admission procedure?**  
    Local index. Cited `admission_pages/admissions.php`. Described UG via EAPCET/ECET and PG via ICET and PGECET. Those exam names appear in the shared navigation text of official pages. The full procedure was not diffed against the page.

14. **What is the college's official contact information?**  
    Local index. Cited `quicklinks_pages/contact.php`. Address Mylavaram, PIN 521 230, and phone numbers including 08659-222933. The live site chrome also shows “Call us: 08659 - 222933”. The API text included the literal “[email protected]”, which is not a usable address. Phone numbers in the same answer looked real; the email rendering did not.

15. **Underwater basket weaving club fee for 2099**  
    Web lookup. “The requested information could not be found on the public web.” No fee was invented. It still attached `https://www.lbrce.ac.in/` as a citation.

## 9. Fake vs Genuine Functionality Analysis

Genuine:

- Streaming chat, history, and delete are wired to MongoDB.
- Answers in this run came from retrieval or from a live fetch, then from a model. There is no dictionary of canned college answers.
- Faculty heads, timetables, and student registration numbers have dedicated lookups.
- Insufficient-evidence and “could not be verified” strings are fallbacks, not the normal path. The unknown-club question used the web path and refused the fact.
- Unit tests use synthetic colleges (`apps/api/src/retrieval/retrieval.test.ts`). Those fixtures are not served to users.

Not fake, but easy to misread:

- `SUGGESTED_QUESTIONS` are only buttons.
- `README.md` still says that a missing fact is simply “could not be verified” and that Gemini is never a source. The code now searches the web and can read a calendar PDF. The README is behind the implementation.
- A timetable “answer” can be an official image with zero extracted periods. That is an honest gap, not a fabricated grid.
- Web answers are marked inferred and unverified even when the page is official.

## 10. Hallucination and Reliability Analysis

Controls that exist:

- Index prompts require the evidence block and tell the model to admit a missing fact.
- `groundedNarrative` drops index narratives whose citation ids were not retrieved.
- `stripExternalLinks` and `isCollegeUrl` remove non-college links from saved Markdown and from the UI.
- The unknown question was refused.

Controls that failed or were bypassed in this run:

- Keyword presence does not mean the retriever ranks that chunk. Scholarships and attendance show this.
- A weak index hit suppresses a better live fetch. The calendar question is the example.
- “Timetable” captures examination timetable questions.
- The model can attach the homepage when the fetch did not contain the fact, which looks like a source even though the fact was not found.
- Web summaries can mix a correct page with extra citations (principal answer).
- Fee and placement lists are only as good as the retrieved excerpt. They were not fully re-audited number by number.
- Student lists are public pages copied into the database. Asking for one student is supported. The corpus itself is a large roster.

Reliability today: good for faculty identity, admissions, contact, fees that are on the crawled fee page, and for refusing an invented club. Weaker for “latest” calendars, today’s notices, scholarships, attendance percentage, and examination timetables.

## 11. Security and Performance Issues

| Severity | Finding |
| --- | --- |
| HIGH | Student chat is authorized only by a `sessionId` stored in the browser. Anyone who has that id can read or delete that browser’s chats through `/api/chat/:id`. There is no student account. |
| HIGH | Public department student lists are indexed (336 student chunks). The bot is designed to return one row, but the database holds the roster. |
| MEDIUM | `detectIntent` sends examination timetable questions down the class-timetable path. |
| MEDIUM | A partial calendar index blocks the official PDF reader, so newer scanned calendars stay unanswered. |
| MEDIUM | OCR is off (`ocr: false`). Timetable images and scanned PDFs stay largely unreadable. `timetableentries` is 0. |
| MEDIUM | Web search can cite `erp.lbrce.ac.in` login URLs and the bare homepage when the page text did not contain the answer. |
| MEDIUM | Chat limiter is 30 requests per 15 minutes per client (`chatLimiter` in `apps/api/src/middleware/common.ts`). A shared NAT or a script can exhaust it. Gemini has its own quota. The 15-question run took about 3 minutes and several answers took 9–28 seconds. |
| LOW | Admin JWT lasts 12 hours (`auth.service.ts`). Production requires `JWT_SECRET` and `ADMIN_PASSWORD` (`getEnv`). Defaults exist for development. |
| LOW | `.env` is gitignored. Keys are not returned by `/api/health`. Do not commit `apps/api/.env`. |
| LOW | `README.md` describes an older, stricter “no web” behavior. |
| LOW | One faculty row is stored as department “Department of ME”, separate from “ME”. |
| LOW | Delete failures in the sidebar are ignored (`App.tsx` `onDelete` catch returns undefined). |

SSRF protection for crawls and page fetches is real (`assertPublicUrl`: allowlist, no credentials, no private IPs). Helmet is enabled. Admin routes use `requireAdmin`.

Performance: Atlas vector search is on. Student chunks are not embedded, so name search depends on regex and exact list fetch. Gemini calls are queued. Web fallback adds DuckDuckGo plus up to three page downloads.

## 12. Missing Features

- Student accounts, roles, and server-side sessions.
- A real “today’s notice” or ERP attendance connection. Those portals were intentionally not scraped when they require login.
- OCR of timetable images and calendar scans, wired so a thin index hit does not block it.
- Examination intent that is not stolen by the word “timetable”.
- Scholarship and attendance retrieval tuning, or an explicit official URL for each.
- Transport as a first-class intent.
- Proof, in production logs, of the BharatCode fallback. The code and health check exist; this run never needed the second model.
- Monitoring, request traces, and a freshness stamp on each crawled page shown to the user.
- README updated to the current web and BharatCode behavior.

## 13. Overall Project Readiness

Usable as a college pilot for admissions, contact, faculty identity, placement pages that were crawled, and fee text that was crawled. Not production-ready as the only source of academic truth. The largest functional holes are unscanned timetable grids, calendar PDFs that lose to stale chunks, examination questions routed to class timetables, and anonymous chat sessions.

## 14. Recommended Improvements

1. Fix `detectIntent` so “examination timetable” stays on the exam path and opens `examtables.php`.
2. If calendar chunks do not contain the asked holiday or year, still open the official PDF.
3. Turn on OCR for timetable images and scanned PDFs, then store period cells only when the read is confident.
4. Re-crawl `principal.php` and `hostels.php`, and add scholarship pages if they exist on the official site.
5. When web evidence does not contain the fact, return `insufficient_evidence` with no homepage citation.
6. Put student chat behind a login, or at least an httpOnly session cookie instead of a readable `sessionId`.
7. Log which provider answered (Gemini or BharatCode) and which web branch ran (Google Search or DuckDuckGo) without logging keys or full prompts.
8. Update `README.md` so operators do not trust the older “no web search” description.

## 15. Final Verdict

| Area | Score |
| --- | --- |
| Frontend functionality | 8/10 |
| Backend functionality | 8/10 |
| Actual AI integration | 8/10 |
| LBRCE knowledge coverage | 7/10 |
| Online information retrieval | 7/10 |
| Answer accuracy and reliability | 6/10 |
| Overall project readiness | 6/10 |

1. **Is this a real AI chatbot or just a demo?**  
   It is a real chatbot. The UI, API, database, embeddings, and Gemini calls all participate. This run produced answers from that stack.

2. **Can it answer questions outside its existing dataset?**  
   Yes, when the web or calendar-PDF path runs. Principal and hostels were answered that way. It cannot answer from the open web at large, because non-college links are removed. A thin index hit can also stop the online path, as with the academic calendar.

3. **Does it actually search the internet?**  
   Yes. The code calls Gemini with a Google Search tool and, on failure, DuckDuckGo HTML plus a fetch of the result pages. It then keeps only `lbrce.ac.in` URLs. Several live answers included the sentence that they were looked up on the public web.

4. **Can it retrieve information from the official LBRCE website?**  
   Yes. Both the crawler and the live fetch path use `https://www.lbrce.ac.in/`. Principal, fees, hostels, and contact answers pointed at those hosts. A direct fetch confirmed the principal page contains “Appa Rao” and the fee page contains “78,600”.

5. **Does it provide reliable answers or hallucinate?**  
   It is mostly grounded and it refused an invented club. It still missed local scholarship and attendance text, misrouted the examination timetable, cited a login URL, and returned a broken email token. Company lists and secondary fee figures were not fully re-checked against the HTML.

6. **What happens when a user asks an unknown question?**  
   The API searches the college site. If the pages do not contain the fact, it says the information could not be found. If search itself errors, the user sees a provider error or the insufficient-evidence block from `assembleBlocks`. It is not supposed to fill the gap from general model knowledge. The prompts say that. The unknown-club test followed the refusal path.

7. **What exactly must be implemented to make it a production-ready LBRCE AI chatbot?**  
   Student authentication, OCR and verified timetable cells, calendar answers that open the current PDF, an examination route that is separate from class timetables, retrieval tests for scholarships and attendance, citations only when the page supports the sentence, provider and crawl monitoring, a scheduled recrawl, and an updated operator guide. The model wiring, including BharatCode as a fallback, is already in the code.

## 16. Re-audit after the fixes

A second live run was executed on 12 November 2026 against the same API after the code changes below. All 15 questions returned HTTP 200. A later pass re-checked the fee and hostel questions after retrieval was tightened again. Temporary scripts used for those calls were deleted. Application tests that passed with this code: `apps/api/src/retrieval/audit-questions.test.ts` (10), `apps/api/src/routes/api.integration.test.ts` (6, including a check that chat history ignores a session id in the query), and the web component tests (6).

What changed in the implementation:

- `detectIntent` in `apps/api/src/retrieval/intent.ts` classifies an examination timetable as `examination` before the class-timetable rule.
- Scholarship, attendance, hostel, principal, and contact have their own intents. Topic search looks for those words and skips student-list chunks.
- A calendar listing is not treated as the latest calendar unless the newest year also has dates. `loadOfficialCalendar` reads the newest PDF and sends it to model vision when the extracted text has no dates. Page rendering for tesseract is attempted only when `@napi-rs/canvas` is installed. It is not installed, so that OCR step logs a skip and vision is the fallback.
- `pageAnswersQuestion` refuses a page that merely shares a category word. The invented club question contains “fee”, but the tuition page is not treated as the answer.
- Answers that admit a gap keep no citation. ERP and login URLs are dropped. `[email protected]` is replaced.
- Numbers of three or more digits must appear in the evidence or the question, or the draft is discarded.
- Chat history, open, and delete require the httpOnly cookie `lbrce_session`. A session id in the query string is ignored. The browser establishes that cookie through `POST /api/session`.
- A request for a student roster is refused. General search does not return `documentType: student` chunks. A name lookup needs two name tokens, and registration lookups are limited to 8 per 15 minutes per session.

| Question | This run | Compared with the first audit |
| --- | --- | --- |
| What is LBRCE? | Index text, admissions and IT pages | Same kind of grounded overview |
| Current principal | Dr. K. Appa Rao, cited `contact.php` | Previously cited `principal.php`. The name matches the earlier page check. This run did not re-download `principal.php` |
| Departments | List from `courses.php` | Same official page |
| Fee structure | Second pass: UG ₹78,600, MBA ₹57,200, M.Tech ₹71,500 from `admission_pages/feestructure.php` | The first re-run had refused, then quoted a menu. After the fee page was fetched, the number check allowed these amounts, so they are present in that page text. The first audit had only spot-checked 78,600 |
| Placement companies | Excerpt of `placements/stat2526.php` after Gemini was rate-limited and BharatCode timed out | No company list was generated in this run. The page was cited. Names were not invented |
| Latest academic calendar | “The official academic calendar file is published, but the requested dates could not be read.” | It no longer presents 2023–24 dates as the latest calendar. The PDF was fetched. Canvas OCR is unavailable, and vision did not return dates on this run |
| Attendance | “This could not be verified.” No percentage | Same honest gap. It no longer cites the ERP login |
| Examination timetable | Points to `examsection_pages/examtables.php` | Previously asked which department class timetable to use |
| Scholarships | Menu excerpts that contain the word. No scheme list | Still not a scheme list. It did not invent schemes |
| Hostel | Second pass: excerpt of `studentcorner_pages/hostels.php` | Previously a web summary that included “300” and an unchecked area figure. This run quotes the official page and does not add that area figure. The quoted portion is the page heading, not a full facilities list |
| Today’s announcement | “No announcement dated today was found on the official notice page.” | Same refusal, without treating an old circular as today’s news |
| HOD of CSE | Dr. Seelam Nagarjuna Reddy, from the faculty record, `faculty.php` | Same structured record |
| Admission procedure | EAPCET/ECET, ICET, PGECET, cited `admissions.php` | Same official page |
| Contact | Mylavaram address and phone numbers. The `[email protected]` token is gone. The captured citation list was empty | The broken email token is fixed. Source links were not attached on this run |
| Invented club fee for 2099 | “This could not be verified from the official college sources. I will not guess the missing fact.” No links | Previously refused but still cited the homepage |

### Score comparison

| Area | First audit | After these fixes |
| --- | --- | --- |
| Frontend functionality | 8/10 | 8/10 |
| Backend functionality | 8/10 | 8/10 |
| Actual AI integration | 8/10 | 8/10 |
| LBRCE knowledge coverage | 7/10 | 6/10 |
| Online information retrieval | 7/10 | 7/10 |
| Answer accuracy and reliability | 6/10 | 7/10 |
| Overall project readiness | 6/10 | 6/10 |

Accuracy is higher because the club fee, today’s notice, and the unread calendar were refused, the examination timetable now points at the exam page, and the fee amounts that were shown had to be present on the official fee page. Knowledge coverage is lower because scholarship text is still menu text, the hostel quote is only the top of the page, and the newest calendar dates were not read. Gemini hit a rate limit during the run and BharatCode timed out on the placement question, so some answers fell back to excerpts instead of a summary.

The bot still should not be treated as able to answer every college question. It can answer a question when an official page or the faculty records contain it, it can open a known official URL when the index does not, and it now says when that page does not contain the fact.
