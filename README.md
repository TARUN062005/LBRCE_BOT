# LBRCE AI

Retrieval-grounded assistant for Lakireddy Bali Reddy College of Engineering, Mylavaram. Answers come from pages and documents the system has actually fetched or that an administrator has uploaded. If a college fact is not in that index, the assistant says it could not be verified.

The React app and the Express API run and deploy separately. Shared request and response contracts live in `packages/shared`.

## Architecture

```text
apps/web     React, Vite, TypeScript, Tailwind
apps/api     Express, Mongoose, Gemini, crawler, jobs
packages/shared   Zod contracts and department query aliases
```

A question is handled in this order:

1. Classify the intent and read department, year, semester, section, and day from the question.
2. Query structured timetable, faculty, and image collections.
3. Run lexical MongoDB text search, then semantic search when embeddings exist.
4. Prefer verified, current, and recent sources. Conflicting timetable cells are reported.
5. Ask Gemini to write a short answer only from the retrieved evidence, then drop any citation the retriever did not supply.
6. Render text, tables, timetables, images, clarifications, or an insufficient-evidence message.

Gemini is not used as a source of college facts. Structured records such as a stored timetable can be shown even when the API key is missing.

## Requirements

- Node.js 22 or newer
- MongoDB 7+ locally, or MongoDB Atlas
- A Google AI Studio API key for generated answers and embeddings

## Setup

```bash
npm install
copy apps\api\.env.example apps\api\.env
copy apps\web\.env.example apps\web\.env
```

Edit `apps/api/.env`:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Local `mongodb://127.0.0.1:27017/lbrce_ai` or an Atlas URI |
| `JWT_SECRET` | Long random string. Required in production |
| `GEMINI_API_KEY` | Server only. Never put this in the React app |
| `GEMINI_MODEL` | Default `gemini-3.5-flash`, which supports structured JSON output |
| `GEMINI_EMBEDDING_MODEL` | Default `gemini-embedding-001` |
| `GEMINI_EMBEDDING_DIMENSIONS` | Default `768` |
| `VECTOR_SEARCH_INDEX` | Optional Atlas index name. See `docs/atlas-vector-search.md` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Creates the first admin user when the password is set |
| `CRAWL_MAX_PAGES` | Page budget for each refresh |
| `CRAWL_DELAY_MS` | Delay between official-site requests |
| `OCR_ENABLED` | `true` runs Tesseract on scanned PDFs and uploaded images |

`GEMINI_MODEL` can be changed without editing code. Use a model enabled for your AI Studio key. `gemini-3.5-flash` is the default because the Gemini structured-output documentation lists it. `gemini-2.0-flash` is shut down and is not used.

For local MongoDB:

```bash
docker compose up -d
```

Or use an existing MongoDB service. This workspace was exercised against MongoDB 8 on `127.0.0.1:27017`.

## Run

```bash
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000
- Health: http://localhost:4000/api/health

The Vite dev server proxies `/api` to the API. For a split deployment, set `VITE_API_URL` to the public API origin and `CORS_ORIGIN` to the web origin. If the browser and API are on different sites, set `COOKIE_SAMESITE=none` and serve the API over HTTPS.

Production:

```bash
npm run build
npm run start -w @lbrce/api
```

Serve `apps/web/dist` from any static host. Run the API as a Node 22 process with the same environment variables. The ingestion worker starts with the API unless `RUN_WORKER=false`.

## Official sources

The configured source is `https://www.lbrce.ac.in/`. Seed paths were taken from the public site navigation, including department timetable and faculty pages, admissions, the academic calendar, examinations, placements, and the gallery. The crawler still has to fetch each URL.

It allows only `lbrce.ac.in` and its subdomains, blocks private IPs and credentialed URLs, follows redirects only after the same checks, and skips URLs disallowed by `robots.txt`. The current `robots.txt` explains content signals but does not set `ai-input`. If a future `Content-Signal: ai-input=no` directive appears, those pages stay searchable as excerpts and links and are not sent to Gemini.

```bash
npm run seed -w @lbrce/api
npm run crawl -w @lbrce/api
```

Admins can also queue a refresh from `/admin/ingestion` or `POST /api/admin/ingestion/run`. Uploaded files stay unpublished until an admin publishes them.

### What was indexed in this workspace

On 9 October 2026 a limited crawl (`CRAWL_MAX_PAGES=8`, delay 1200 ms, OCR off, no Gemini key) succeeded against the live site with 0 failed requests:

- https://www.lbrce.ac.in/academic_pages/timetables.php
- https://www.lbrce.ac.in/cse/csetimetables.php
- https://www.lbrce.ac.in/ece/ecetimetables.php
- https://www.lbrce.ac.in/eee/eeetimetables.php
- https://www.lbrce.ac.in/it/ittimetables.php
- https://www.lbrce.ac.in/civil/civiltimetables.php
- https://www.lbrce.ac.in/mech/mechtimetables.php
- https://www.lbrce.ac.in/ase/asetimetables.php

That run stored 121 official image references and 120 timetable records. The records keep the official image URL plus department, academic year, semester, and section parsed from the filename. Example: CSE, 2026–27, semester 3, section A points at `III_SEM_A_SEC_TT_AY_2026-27.jpg` on the CSE timetable page. Period, subject, faculty, and room cells were not extracted. The college publishes these timetables as images, and OCR was not enabled for that run. The assistant shows the official image and says the grid is unverified instead of inventing it.

Raise `CRAWL_MAX_PAGES` and run the crawl again to index the homepage, admissions, fees, examinations, and placements. Those pages were discovered but not fetched in the 8-page run because timetable URLs are processed first.

## Timetables

Ask for the department, year or semester, and section. "Second year, first semester" is read as semester 3. If several sections match, the assistant asks which one. Validity dates are checked against the current date in Asia/Kolkata. An administrator can correct cells at `/admin/timetables` and then mark the timetable verified. A verified correction replaces the unverified extraction.

Enable `OCR_ENABLED=true` before crawling image timetables if you want Tesseract to attempt cell extraction. Review that text before treating it as verified.

## Add another official source

1. Add a `CollegeSource` document with `baseUrl`, `allowedHosts`, and `seedPaths`.
2. Keep hosts on the college domain unless you have permission to fetch somewhere else.
3. Extend `DEPARTMENT_MATCHERS` in `packages/shared` only when a new official programme name needs to be recognized in questions. Those aliases are not shown as college records.
4. Queue a refresh. New upload types can use the existing document pipeline if the MIME type is already allowed.

## API

Public:

- `POST /api/chat`
- `POST /api/chat/stream` (server-sent events: `status`, `token`, `done`, `error`)
- `GET /api/chat/history?sessionId=`
- `GET /api/chat/:id?sessionId=`
- `DELETE /api/chat/:id?sessionId=`
- `GET /api/search?q=`
- `GET /api/sources/:id`
- `GET /api/documents`
- `GET /api/documents/:id`
- `GET /api/timetables`
- `GET /api/timetables/search`
- `GET /api/timetables/:id`
- `GET /api/images/search?q=`
- `POST /api/feedback`
- `GET /api/health`

Admin, with the `lbrce_admin` cookie or `Authorization: Bearer`:

- `POST /api/admin/auth/login`
- `POST /api/admin/auth/logout`
- `GET /api/admin/me`
- `GET /api/admin/dashboard`
- `GET /api/admin/documents`
- `POST /api/admin/documents/upload`
- `GET /api/admin/documents/:id`
- `POST /api/admin/documents/:id/publish`
- `POST /api/admin/documents/:id/archive`
- `POST /api/admin/documents/:id/reprocess`
- `POST /api/admin/ingestion/run`
- `GET /api/admin/ingestion/status`
- `POST /api/admin/ingestion/:id/retry`
- `GET /api/admin/timetables`
- `POST /api/admin/timetables/verify`
- `PATCH /api/admin/timetables/:id`
- `POST /api/admin/sources/refresh`
- `GET /api/admin/retrieval?q=`

Errors use `{ error: { code, message, requestId } }`.

## Security

Secrets stay in the API environment. Helmet, explicit CORS, origin checks on browser mutations, rate limits, Zod validation, httpOnly admin cookies, bcrypt passwords, and upload magic-byte checks are enabled. Retrieved pages are treated as untrusted data. The model is told to ignore instructions found inside them, and citation ids that were not retrieved are discarded.

The crawler does not collect student results, attendance, or authenticated ERP data.

## Tests and checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

API integration tests use `mongodb-memory-server`. On this machine they use the installed MongoDB 8 binary via `MONGOMS_SYSTEM_BINARY` when that executable is present. Test fixtures are labeled synthetic and are not college records.

## Limitations

- Generated answers and embeddings need `GEMINI_API_KEY`. Without it, the app still returns retrieved excerpts, timetable images, and structured rows.
- Atlas Vector Search is optional. The cosine fallback reads a bounded set of stored embeddings.
- Image timetable cells need OCR or an admin correction before they can appear as a period grid.
- The first crawl in this workspace did not download notice or fee PDFs.
- Official images are loaded from the college host. If that host blocks embedding, the UI links to the official page.
- One API process runs the ingestion queue in memory. Run a single worker if you deploy more than one API instance, or set `RUN_WORKER=false` on the others.
- Rate limits use process memory and reset when the process restarts.
