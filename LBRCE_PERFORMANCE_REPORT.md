# LBRCE AI — Performance baseline and changes

Measured on this machine on 20 November 2026, before the optimizations below, then again for the stages that changed. No live Gemini or BharatCode call was made, and no Atlas round trip was timed. End-to-end P50, P95, and P99 for real chats are not available because this workspace has no stored latency sample of production traffic. Those figures are not estimated here.

## What the request does

The browser streams `POST /api/chat/stream`. Express searches MongoDB. Keyword search, vector search, topic search, and image search already run together. If that evidence is enough, Gemini writes the answer and BharatCode is only the fallback. A follow-up, a comparison, or a thin index calls the local Python agent, which can open official pages and read a PDF. The browser already renders tokens as they arrive.

## Baseline measurements

| Stage | Result | Notes |
| --- | --- | --- |
| Read a 4-page text PDF with `inspect_pdf` | 1038.4 ms median of 5 runs | Page images were written and table detection ran |
| Same PDF, text extraction only | 2.9 ms median | The extra time was not the text layer |
| `page.get_text("text")` on that PDF | 2.1 ms | |
| `page.get_text("words")` | 2.0 ms | |
| `page.find_tables()` | 831.5 ms | This was the PDF bottleneck |
| OCR of one already-rendered text page | 2355.4 ms median of 2 runs | Wasted when the text layer already exists |
| Three official LBRCE pages, one after another | 4739.4 ms total | Individual times 2005.2, 1335.9, and 1398.3 ms, all HTTP 200 |
| Same three pages at the same time | 1524.5 ms total | About 1497 ms each, overlapping |
| Frontend, MongoDB, Atlas vector search, Python agent, and LLM | Not measured | No running chat sample and no provider call in this pass |

The Node provider also waits until 1500 ms have passed since the previous model call. That spacing was not retimed with a live request, and it was left in place so a faster loop does not trip the provider rate limit.

## Changes after the baseline

| Change | Measured effect |
| --- | --- |
| Stop rendering a PNG when the page already has text | A text page no longer produces an image file. Scanned pages still render at scale 2 for OCR |
| Stop calling `find_tables` on every page | The same 4-page text PDF now inspects in 5.0 ms median. Word positions still build the timetable grid. A word cluster is kept as the table region |
| Open up to four official pages concurrently, and do not request the same URL twice | The three-page sample above is the reason: 4739.4 ms sequential versus 1524.5 ms concurrent. Each request still checks the official host and redirects. Timeout is 12 seconds |
| Reuse a PDF extract when the file bytes are the same | A second URL with the same bytes skips inspection. Covered by a unit test |
| Skip the planning model on a simple question | A comparison or a follow-up still asks the model to refine the plan. A direct question uses the existing bounded plan and does not spend a model call before research |
| Keep keyword and vector retrieval concurrent | This was already the case. Lexical search now asks for 12 chunks instead of 40, and the cosine fallback reads 80 embedding rows instead of 250. Atlas itself was not retimed |
| Remember a grounded narrative for three minutes | The key is the question plus the evidence text. A changed document misses the cache. Publishing or archiving a document clears it. An unverified answer is not stored |
| Pass the user's format into the prompt | Table, bullets, numbered steps, images, and PDF links are requested only when the user asks. An ordinary explanation stays prose |

## Targets

A simple indexed answer should be dominated by one retrieval and one model stream, not by a second research pass. A comparison or a missing fact still has to open official pages; the measured page fetch is about 1.5 seconds when the pages run together, plus model time. A scanned PDF still pays for OCR. That path was 2.4 seconds for one synthetic page and is unchanged, because skipping it would hide text that exists only in the image.

P50, P95, and P99 for complete chats still need a sample of real requests. They are not invented here.
