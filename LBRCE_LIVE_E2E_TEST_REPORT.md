# LBRCE live end-to-end test

Run on 21 November 2026 against the local app.

| Service | Check |
| --- | --- |
| Web | `http://127.0.0.1:5173/` HTTP 200 in 13 ms |
| API | `http://127.0.0.1:4000/api/health` HTTP 200 in 76 ms |
| MongoDB | API health reported the database connected, and timetable records were read |
| Python agent | Restarted, then `http://127.0.0.1:4100/health` HTTP 200 in 54 ms |

The Python process that had been running since the previous session was started before the retrieval changes and does not auto-reload. It was stopped and started again from `apps/agent` so this run used the current agent code. No retrieval code was changed for this test.

API timings are the full `POST /api/chat` round trip. The browser was used for the photo question and the timetable question. The other questions were verified from the API response that the chat renders. Raw responses are in `e2e-live/api-results.json`. Screenshots are `e2e-live/e2e-photos-gallery.png` and `e2e-live/e2e-timetable.png`.

An official placements team page was fetched separately and was not used by the chat:

`https://www.lbrce.ac.in/placements/placementcontact.php` returned HTTP 200. The visible team is:

- Dr. V SURYANARAYANA — Dean - Industrial Relations
- Dr. Sujit Kumar Rath — Training and Placement Officer
- Mr. L. Venu Gopal — Placement Officer
- Ms. D. Venkata Lakshmi — Assistant TPO

Email addresses on that page are obfuscated. A plaintext address was not recovered, so the reported comma in an email address was not confirmed from the page.

## 1. Can you fetch some LBRCE photos?

**Status: failed.** Official gallery photographs were not retrieved.

**Time:** 27.3 seconds on the API. The browser stayed on “Writing a grounded answer” for more than 25 seconds and then rendered.

**Actual response:** The text said there are no official image URLs in the evidence. The same answer still attached a gallery.

**Evidence:** Central library page and `https://www.lbrce.ac.in/cse/index.php`. The gallery page `galleryindex.php` was not in the evidence. Citations also included the site header `headern_new.png`.

**Images shown:**

- `https://www.lbrce.ac.in/images/slider/2026-27/Brightcoe.ai.jpeg`
- `https://www.lbrce.ac.in/images/slider/2025-26/Gate_2025-26/1.jpeg`

Both loaded in the browser (1349×400 and 1349×450). They are homepage slider graphics, including a Brightcone.ai inauguration banner. They are not the campus gallery set.

**UI:** Preview opened and showed the Brightcone banner with a Close button. Download links point at `/api/media`. `GET /api/media` for the Brightcone file returned HTTP 200, `image/jpeg`, `Content-Disposition: attachment`, 139,612 bytes in 1.8 seconds. A saved file in the browser download folder was not confirmed.

The answer text and the gallery contradict each other. The chat paste supplied with this request shows the same class of failure: navigation text titled “LBRCE - Best Engineering College” and images that do not answer a request for college photographs.

## 2. Who is the current Head of TP Cell?

**Status: incomplete.** A department HOD was not returned as the head. The dedicated placements team page was not read.

**Time:** 16.4 seconds.

**Actual response:** The faculty list does not establish a Head of the Training and Placement Cell. It names Mr. SRINIVAS KONDAPABULURI, designation `PLACEMENT OFFICER`, department MBA, and says that designation is not the requested role. It also says the placements index describes an unnamed Training and Placement Officer as head of the cell.

**Evidence:** `https://www.lbrce.ac.in/quicklinks_pages/faculty.php` and the placements index sentence. Not `placementcontact.php`.

**UI:** Not opened in the browser. The API returned one text block and no faculty card for a department head.

## 3. Who is the Placement Officer?

**Status: failed against the placements team page.**

**Time:** 3.3 seconds.

**Actual response:** A faculty card and table for Mr. SRINIVAS KONDAPABULURI, exact designation `PLACEMENT OFFICER`, department MBA, source `faculty.php`. No date is printed on that row.

**Conflict:** `placementcontact.php` names Mr. L. Venu Gopal as Placement Officer. The chat presented the faculty-list row as the answer and did not mention the placements team page.

**UI:** Not opened in the browser. The API payload contains a two-column faculty table. Rendering of this particular table was not screenshotted.

## 4. Training and Placement Dean

**Status: partial.** No person was invented for that exact title. The related official title was missed.

**Time:** 7.3 seconds.

**Actual response:** The faculty list does not establish a Training and Placement Dean. Kondapabuluri is mentioned only as a different designation. No department HOD was substituted.

**Not retrieved:** Dr. V SURYANARAYANA is Dean - Industrial Relations on `placementcontact.php`. That title is not “Training and Placement Dean”, and the chat did not report it.

**UI:** Not opened in the browser.

## 5. Show CSE 7th semester C section timetable.

**Status: partial.** Year selection and the official file succeeded. The period grid and the extra images did not.

**Time:** 35.4 seconds on a fresh API conversation. In the browser the answer was still generating at 40 seconds and had finished by about 80 seconds.

**Actual response:** Timetable block `VII_SEM_C_SEC_TT_AY_2026-27.jpg`, academic year 2026-27, CSE, semester 7, section C, unverified, 0 period cells. No “Which semester” question. The note says the official file is linked instead of a guessed grid and lists the other indexed years.

**Official file:** `https://www.lbrce.ac.in/cse/cse_timetables/2026-27/CSE_26-27_ODD_SEM/VII_SEM/VII_SEM_C_SEC_TT_AY_2026-27.jpg` returned HTTP 200, `image/jpeg`, 506,531 bytes. In the browser that image loaded at 1654×2338.

**UI:** The timetable card rendered with the 2026-27 title, the unverified note, and “Period cells have not been verified”. Below it, a gallery loaded eight other timetable JPEGs, including 2023-24 semester 4 and 6 and 2025-26 semester 2 and 8. Those are not the CSE 7 C timetable. The screenshot shows those extra images, and one visible crop includes a “Name of the Father” header.

## 6. Give me the complete CSE 7th semester C-section student list and timetable.

**Status: partial.** The roster restriction held and the timetable was still returned. Extra images were attached.

**Time:** 24.2 seconds.

**Actual response:** “I cannot provide a complete class roster, including names and registration numbers, through this public chat. The timetable below is separate from that list.” No student names were included. The same 2026-27 CSE 7 C timetable block followed, with 0 period cells.

**Defect:** The gallery again included other years and sections, such as 2023-24 semester 4 and 6, plus a 2025-26 semester 7 C file that is not the selected timetable.

**UI:** Not opened in the browser. The API blocks are the text refusal plus the timetable block.

## 7. Compare CSE and ECE departments in table format.

**Status: failed.**

**Time:** 96.1 seconds.

**Actual response:** “The current official LBRCE sources do not establish that answer. I will not guess it.”

**Evidence:** No department sources and no table were returned.

**UI:** No comparison table existed to render. This was not screenshotted.

## 8. Show me LBRCE campus photographs and explain the facilities.

**Status: failed as a photo answer. The facilities text is only partly grounded.**

**Time:** 66.6 seconds.

**Actual response:** The text says the evidence contains no campus photographs, then describes the central library: area, floors, book counts, and e-resources. The same two homepage slider images from question 1 were attached again.

**Evidence:** Central library page, IT department page, and CSE department page. The gallery page was not used. Library figures were taken from the library page text. They were not re-checked number by number against a second fetch in this run.

**UI:** Not opened in the browser.

## 9. What about its faculty?

**Status: failed.** Conversation identity was kept. The subject was not.

**Time:** 6.1 seconds.

**Conversation:** Same id as question 8, `6b00935e568d8c80685465bc`.

**Actual response:** A faculty table for Civil Engineering, not for campus facilities and not for a department named in the previous turn. The first rows are hostel labels stored as faculty: “LLR Boys Hostel”, “LNG (Girls) Hostel-Common”, and “LNG (Girls) Hostel-Attached”, department CE. Dr. KOLLIPARA VENKATA RAMANA is listed as Associate Professor & HOD, CE. Excerpts after the table are a general faculty-list page, including Mechanical Engineering names.

**UI:** Not opened in the browser.

## UI defects seen in the browser

- Photo text says no images while the gallery renders images.
- Preview works. Download is wired to `/api/media` and that endpoint returned a JPEG. The browser’s saved-file dialog was not confirmed.
- The timetable card renders, and the 2026-27 image loads. Unrelated timetable images are rendered in the same answer.
- During the photo answer the page also showed “This conversation could not be loaded.” The sidebar still said “No conversations yet” while the answer was on screen. That message was not present after the timetable answer finished.
- A comparison table was never produced, so table rendering for question 7 was not verified. The Placement Officer API response does contain a table, but that screen was not opened.

## Remaining defects

1. A request for LBRCE photographs does not open the official gallery. It returns homepage sliders and library or department text, and the written answer denies that images exist.
2. Placement questions do not read `placementcontact.php`. The faculty list’s Placement Officer is not the person named on the placements team page, and that conflict is not shown.
3. “Training and Placement Dean” is correctly left unanswered, and Dean - Industrial Relations is not retrieved either.
4. CSE 7 C 2026-27 is selected without an extra semester question, but period cells are empty and other timetable images are mixed into the answer.
5. Roster privacy still blocks a full class list. The timetable part of that question works, with the same extra-image problem.
6. CSE versus ECE produced a refusal and no evidence-backed table.
7. “What about its faculty?” stayed in the conversation and then answered with Civil Engineering records, including hostel names stored as faculty.
8. Image captions repeat the page title instead of describing the photograph.
