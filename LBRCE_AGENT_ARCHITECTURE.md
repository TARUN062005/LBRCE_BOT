# LBRCE agent architecture

This note describes the college chatbot as it exists, what is reused, and the agent added on top. It is an implementation plan for the current repository, not a second application.

## Current architecture

The public UI is one React chat page (`apps/web`). It posts to the Express API on port 4000 (`apps/api`). Answers are stored in MongoDB with the browser session cookie `lbrce_session`.

`answerQuestion` in `apps/api/src/services/chat.service.ts` already does the following:

1. Classify the question (`apps/api/src/retrieval/intent.ts`).
2. Search faculty records, timetables, and published chunks (`apps/api/src/retrieval/search.ts`). Atlas vector search is used when `VECTOR_SEARCH_INDEX` is set.
3. Ask Gemini to write from those chunks. BharatCode Qwen runs only when Gemini throws or returns nothing (`apps/api/src/integrations/fallback-provider.ts`). Embeddings stay on Gemini.
4. For a thin calendar hit, open the official academic-calendar PDF (`apps/api/src/integrations/calendar-source.ts`) and send a scanned file to Gemini vision.
5. Otherwise open a known official URL (`apps/api/src/integrations/official-pages.ts`) or a college-only web search (`apps/api/src/integrations/web-search.ts`).

Downloads already pass `assertPublicUrl` in `apps/api/src/security/ssrf.ts`: allowlist, DNS lookup, and a block on private, loopback, and link-local addresses. Admin routes stay behind the admin JWT. Student lists are excluded from ordinary retrieval.

## Reused modules

| Need | Existing module |
| --- | --- |
| Intent and entities | `retrieval/intent.ts` |
| Indexed search and faculty | `retrieval/search.ts`, `retrieval/faculty-guide.ts` |
| Official HTML | `integrations/official-pages.ts` |
| Calendar PDF | `integrations/calendar-source.ts` |
| PDF text | `ingestion/extract.ts` (`extractPdf`) |
| Image OCR | `ingestion/extract.ts` (`ocrImage`, `ocrPdf`) |
| Vision | `GeminiProvider.readDocument` |
| Model fallback | `FallbackProvider` |
| SSRF | `security/ssrf.ts` |
| Chat UI blocks | `packages/shared` answer blocks and `AnswerBlocks.tsx` |

`ocrPdf` can render pages only when `@napi-rs/canvas` is installed. It is not installed. Scanned PDFs therefore go to Gemini vision, or to a Playwright screenshot when the file itself cannot be downloaded.

## Missing before this upgrade

- A single tool registry and a bounded loop, instead of only the fixed branches in `chat.service.ts`.
- Evidence objects with URL, page, capture time, and verification status.
- A browser path that opens an official page only after a direct download fails.
- A check that refuses another college, a private address, or a redirect off `lbrce.ac.in`.
- An admin log of tool order, provider, and failure, without session cookies or secrets.
- An in-process record of document hashes so the same PDF is not queued twice. Redis and BullMQ are not added. They would be a second process to run and pay for; the API already has an ingestion worker, and on-demand PDF reading stays inside the request with a 45 second budget.

## Agent shape

```
Student chat
  -> existing index, faculty, and timetable lookup
  -> if that answer is sufficient, return it (unchanged)
  -> LBRCE agent orchestrator
       planTools() chooses at most 6 tools
       each tool is a named function in the registry
       results become Evidence
       verifyEvidence() drops prompt injection, conflicts, and empty pages
  -> Gemini, then BharatCode, using only that evidence
  -> chat blocks plus an evidence card
```

The model cannot pick a tool that is not in the registry. A model-suggested plan is intersected with the allowlist. Webpage, PDF, and OCR text are wrapped as untrusted data and cannot replace the system prompt.

Playwright is a local Chromium binary used only for `browse_official_page`. It is not a cloud browser. If the package or browser is missing, the tool returns a failure and the answer does not claim that a screenshot was read.

## Security

- Tools accept only `https://` URLs whose host is `lbrce.ac.in` or a subdomain, after `assertPublicUrl`.
- `erp.lbrce.ac.in` and login paths are rejected as public evidence.
- Redirects are checked again. A hop to another domain throws.
- PDF bytes must start with `%PDF`, stay under 12 MB, and stay under 40 pages.
- Downloaded bytes are never executed.
- Agent logs store the question, tool names, provider, and error text. They do not store cookies, passwords, or API keys.

## Sequence

1. Architecture note (this file).
2. PDF download, text extraction, page limits, and vision fallback.
3. Playwright tool, used only when download fails, and only on an approved URL.
4. Tool registry and orchestrator with time, count, and duplicate limits.
5. Evidence verification and grounded answers.
6. Evidence card and activity text on the existing chat page.
7. Admin agent log, unit tests, and the existing test suites.

Google Search is not used as a source of college facts on this path. Discovery stays on official pages and college-hosted documents.

## Implementation status

Stages 2–7 are in the API and the existing chat page.

- `apps/api/src/agent/policy.ts` holds the allowlist, PDF limits, injection filter, timetable and calendar parsers, and the in-process document-hash memory. Redis and BullMQ were not added.
- `apps/api/src/agent/pdf.ts` downloads an official PDF and sends a short extract to the existing vision reader.
- `apps/api/src/agent/browser.ts` loads Playwright only when a download fails. The package is not installed in this workspace, so a missing browser is a failed tool call.
- `apps/api/src/agent/orchestrator.ts` runs at most six tools and 45 seconds, then keeps the evidence or refuses.
- The chat service calls that orchestrator only when the index did not already answer and the process is not the test runner.
- Answers can include an `evidence` block. The admin retrieval page can load `GET /api/admin/agent-runs`.

