# LBRCE retrieval failure fix

This report separates what was executed from what was only inspected in code. No faculty name or designation below was invented. Names appear only when an official page or an indexed college record contained them.

## 1. Root cause of each original failure

### Gallery photos

`Can you fetch some LBRCE photos?` was classified as a general question. The image detector required the exact word `photo`, so `photos` did not count. The official gallery page could be opened, but the HTML reader collected links and ignored `img` `src`, `data-src`, `srcset`, and the full-size file linked around a thumbnail. Image evidence that did exist was kept as text, so the chat had no gallery to render.

### Head of TP Cell, and Training and Placement Dean

`Who is the current Head of TP Cell?` matched the faculty path because it contained “head of”. Faculty search then preferred `isHead` records. A department head, including a Civil Engineering head, could rank first even though the question was about the Training and Placement cell. Verification treated the word “head” inside “Head of the Department” as enough evidence. “Training and Placement Dean”, “Head of TP Cell”, and “Placement Officer” were also treated as the same kind of match.

### CSE 7th semester C section timetable

`7th sem` and `C section` / `C-section` were not stored as semester 7 and section C. With the semester missing, timetable resolution asked “Which semester should I use?” even though the user had already said it. A question that asked for both the class roster and the timetable returned on the roster path and never reached the timetable.

### Student roster

The roster detector missed phrasings such as “Students List”. Where it did match, the refusal could look like a generic retrieval failure, and a combined roster-plus-timetable question dropped the timetable.

### Evidence check

A high-scoring faculty chunk could be accepted when it did not name the requested role. User-facing refusals also repeated internal step names.

## 2. Files modified for this fix

- `apps/api/src/retrieval/intent.ts` — image, institutional-role, semester, section, and roster detection.
- `apps/api/src/retrieval/roles.ts` — exact designation matching and faculty-table parsing.
- `apps/api/src/retrieval/conversation.ts` — carry department, semester, and section into a follow-up.
- `apps/api/src/retrieval/search.ts` — role query no longer uses the department-head flag; gallery images are preferred for a general photo request.
- `apps/api/src/retrieval/assemble.ts` — faculty cards use the printed designation; empty or non-college image blocks are omitted.
- `apps/api/src/retrieval/images.ts` — decorative image filter and image category.
- `apps/api/src/services/chat.service.ts` — role resolution, roster-plus-timetable privacy note, follow-up entities, image blocks from the research agent.
- `apps/api/src/controllers/public.controller.ts` and `apps/api/src/app.ts` — `GET /api/media` downloads an allowlisted LBRCE image.
- `apps/api/src/retrieval/failures.test.ts` — the six reported scenarios.
- `apps/agent/app/tools.py` — gallery image parsing, header filtering, album pages, faculty page for role questions.
- `apps/agent/app/verify.py` — a department head or a different placement title does not satisfy the requested role.
- `apps/agent/tests/test_agent.py` — gallery HTML and role evidence.
- `apps/web/src/components/ImageGallery.tsx` — preview remains, and a same-origin download link was added for official image files.

The existing answer block type `image_gallery` already had URL, source page, caption, alt text, and topic. That schema was kept.

## 3. Image retrieval results

Tested on 20 November 2026 against `https://www.lbrce.ac.in/gallery_pages/galleryindex.php`.

- The page returned HTTP 200.
- After resolving relative URLs, dropping the site header, logo, and non-LBRCE URLs, the parser returned 7 official photographs:
  - `iccins2023/Welcome.JPG`
  - `Graduationday2023/001.JPG`
  - `annualday2023/009.JPG`
  - `annualday2020/annual2020thumb.jpg`
  - `annualday2019/annual2019thumb.jpg`
  - `isrowsw2019/isro2019thumb.jpg`
  - `iccide2017/iccide2017thumb.jpg`
- `https://www.lbrce.ac.in/images/gallery/Graduationday2023/001.JPG` returned HTTP 200, `image/jpeg`, 13,402,112 bytes.
- A fixture with `src`, `data-src`, a linked full-size file, a header, a logo, and an external image kept only the two official content images. The linked full-size file replaced the thumbnail.

Not tested: the React chat was not driven through a live “fetch some LBRCE photos” turn, and `GET /api/media` was not called. Deduplication is by absolute URL. File bytes are not hashed. Album pages are followed only when the research agent is collecting images, and at most two extra gallery pages are opened.

## 4. Faculty designation retrieval results

Tested on 20 November 2026.

`https://www.lbrce.ac.in/quicklinks_pages/faculty.php` returned the faculty table (about 993 KB, 2,408 rows). The same parser used by chat read 927 named rows.

| Requested role | Result on that page |
| --- | --- |
| Head of TP Cell | No row uses that designation. |
| Training and Placement Dean | No row uses that designation. |
| Placement Officer | One row: Mr. SRINIVAS KONDAPABULURI, exact designation `PLACEMENT OFFICER`, department `MBA`. The row does not print a date. |

“Professor & Dean” appears for other people, including indexed records for Dr. VADHRI SURYANARAYANA (AI&DS), Dr. SRINIVASA RAO. M (CSE), and Dr. PICHI REDDY. S (ME). Those designations do not say Training and Placement, so they are not returned as the Training and Placement Dean.

`https://www.lbrce.ac.in/placements/index.php` says a Training and Placement Officer is deputed as head of the cell. That sentence does not print a name. The chat does not turn it into a named head. If the faculty page has no matching title, the reply says the role is not established and, when the officer row is present, quotes that different designation instead of substituting it.

The indexed faculty collection did not contain a Placement Officer row. The live faculty page is preferred over that index. A department-head record is not eligible for these questions.

Not tested: a full chat turn was not sent through the running API. Last-verified dates are not invented. Joining-style dates printed on other faculty rows are not treated as proof that a role is current. No last-verified date is published for the Placement Officer row.

## 5. Timetable retrieval results

Unit test: “Show CSE 7th semester C section timetable.” extracts department CSE, semester 7, and section C, and does not ask for the semester when those values are already present.

Indexed records, read from the college database on 20 November 2026, for CSE, semester 7, section C:

| Academic year | File | Extracted period cells |
| --- | --- | --- |
| 2022-23 | VII_SEM_C_SEC_TIMETABLE_AY_2022-23.jpeg | 0 |
| 2023-24 | VII_SEM_C_SEC_TIMETABLE_AY_2023-24.jpg | 0 |
| 2024-25 | VII_SEM_C_SEC_TIMETABLE_AY_2024-25.jpg | 0 |
| 2025-26 | VII_SEM_C_SEC_TT_AY_2025-26.jpg | 0 |
| 2026-27 | VII_SEM_C_SEC_TT_AY_2026-27.jpg | 0 |

All five are unverified and have a source URL and an image. None has validity dates. Running the timetable resolver on those rows for 20 November 2026 selected `2026-27` and did not ask a clarification. The note states that period cells have not been extracted, so the source file is linked instead of a guessed grid, and the other years are named.

Not tested: the JPEG was not opened and no subject, faculty, or room was read from it. A live chat reply was not generated.

## 6. Student-list privacy behavior

“Give me the complete CSE 7th semester C-section student list.” is detected as a roster request. The public reply says a complete class roster, including names and registration numbers, cannot be provided through this chat, and that a timetable, section, or an officially stated count can still be answered.

A question that asks for both the roster and the timetable no longer stops before the timetable. The privacy explanation is placed above the timetable answer.

Individual registration-number lookup and its existing rate limit were left in place.

Not tested: no live chat call was made, and no student names were read for this report.

## 7. Frontend rendering results

The existing chat renderer already supports markdown, tables, timetable grids, faculty tables, source links, and image galleries. The gallery hides an image that fails to load and opens a preview. Official image files now also have a Download link to `/api/media`, which checks the LBRCE host allowlist and only returns an image response.

`apps/web` component tests passed: sortable table, timetable grid, gallery caption and official-page link, citations, and navigation (5 tests).

Not tested: the download link and a live gallery were not clicked in the browser.

## 8. Automated test results

Passed on 20 November 2026:

- API: `failures.test.ts`, `audit-questions.test.ts`, `images.test.ts`, `conversation.test.ts` — 23 tests.
- Web: `components.test.tsx` — 5 tests.
- Python agent: `tests.test_agent` and `tests.test_documents` — 24 tests.

The six required scenarios are covered as follows.

| Scenario | What the test checks |
| --- | --- |
| Gallery photos | Intent is image retrieval. HTML parsing returns official image URLs and drops the header, logo, and external file. |
| Head of TP Cell | Intent is an institutional role, not a department-head search. A Civil Engineering “Head of the Department” row does not match. Evidence that only says Placement Officer does not match. |
| Training and Placement Dean | A “Dean of Training and Placement” fixture matches. “Professor & Dean” and “Placement Officer” do not. |
| CSE 7 C timetable | Department, semester, and section are extracted, including `C-section`. The resolver returns a match instead of asking for the semester, and it keeps the newer academic year. |
| Complete student list | Roster wording is detected. A timetable-only question is not treated as a roster request. |
| Follow-up faculty | “Also show its faculty.” stays a faculty follow-up and keeps CSE, semester 7, and section C from the previous question. |

`tsc --noEmit` in `apps/api` still reports the pre-existing errors in `apps/api/src/scripts/crawl-report.ts` only.

## 9. Live official website test results

Executed:

- Gallery index, 7 content images, header excluded.
- One gallery JPEG downloaded directly from `lbrce.ac.in` (`image/jpeg`).
- Faculty page parsed with the chat parser: no Head of TP Cell, no Training and Placement Dean, one Placement Officer row as named above.
- Placements index describes an unnamed Training and Placement Officer as head of the cell.
- Placement statistics page and the principal page did not name either role.
- Database resolver selected the 2026-27 CSE 7 C timetable file and refused to invent empty cells.

Not executed:

- A chat message through the running web app.
- `GET /api/media` against the 13 MB JPEG.
- OCR or visual reading of the timetable JPEG.

## 10. Remaining limitations

- The current Head of the TP Cell and the current Training and Placement Dean are not established by the faculty list. The Placement Officer row must not be presented as either of those roles.
- CSE semester 7 section C timetable files are indexed, including 2026-27, but their period, subject, faculty, and room cells are not extracted. The chat can point at the official file. It cannot yet show the grid.
- Several gallery images on the index are thumbnails. At most two album pages are opened after the index.
- Image identity is the official URL, not a hash of the file bytes.
- Follow-up memory is applied when the new message refers to the earlier turn (“its”, “also”, “what about”). It was unit-tested, not exercised as two live chat messages.
- The public chat still does not disclose a full identifiable class roster.
