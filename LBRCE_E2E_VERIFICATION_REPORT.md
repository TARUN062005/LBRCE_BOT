# LBRCE AI — live verification

API health during these calls: `status: ok`, `ocr: true`, MongoDB connected. Calls used `POST /api/chat` on `127.0.0.1:4000`. Times are the HTTP duration. A fluent sentence is not treated as a pass.

## Test 1 — Academic calendar

Question: “Show me the academic calendar.”

Actual: “Which academic year should I open?” in 1.8 seconds.

Reply: “2026-27.”

Actual: “The 2026-27 calendar file prints more than one regulation. Which one should I read?” Options: Regulation R26, Regulation R23. Duration 31.1 seconds. That time includes downloading the PDF and OCR.

Reply: “Regulation R26.”

Actual, 29.0 seconds:

- Document: `https://www.lbrce.ac.in/academics/aycalendars/Academic_Calendars_2026-27.pdf`
- Title: `Academic_Calendars_2026-27.pdf`
- OCR included `Commencement of Class Work 10-08-2026`
- The same response still said the file prints R26 and R23
- Other OCR lines were misread, including `Dasara Holidays iot0206` and `MID Examinations oM020`

Status: **partial pass**. Year and regulation are asked. The correct official PDF is downloaded and OCR’d. Commencement of class work matches the date visible on the official first page. OCR does not isolate only R26, and several other lines are wrong. Those wrong lines must not be treated as verified dates.

## Test 2 — CSE 7th semester C timetable

Not re-run in this pass. The earlier live run selected the 2026-27 CSE semester 7 section C JPEG and extracted **zero** period cells. No cells were invented. Grid OCR is still unverified.

Status: **not passed**.

## Test 3 — Training and Placement Officer

Question: “Who is the current Training and Placement Officer?”

Actual, 2.1 seconds: **Dr. Sujit Kumar Rath** is named **Training and Placement Officer** on the Industry Relations & Placements team page. Phone printed: 8919482365 & 812529489. The email line was quoted as published, including the obfuscated text and `,in`, and the answer said it was not corrected. Source: `https://www.lbrce.ac.in/placements/placementcontact.php`. The page does not print a last-verified date, and the answer says that.

Status: **pass** for the name, title, and source. The page itself does not prove the word “current” beyond being the page that was live when fetched.

## Test 4 — Gallery

Question: “Can you fetch some LBRCE photos?”

Actual, 3.1 seconds: “Official gallery photographs. Homepage banners are not used.” Eight images, all under `/images/gallery/`, including:

- `https://www.lbrce.ac.in/images/gallery/iccins2023/Welcome.JPG`
- `https://www.lbrce.ac.in/images/gallery/Graduationday2023/001.JPG`
- `https://www.lbrce.ac.in/images/gallery/annualday2023/009.JPG`

Page URL on those records: `https://www.lbrce.ac.in/gallery_pages/galleryindex.php`.

Public web / Google image search returned **zero** images in this environment. No web image was invented to fill that gap.

Status: **pass** for the official gallery. **fail** for Google image results.

## Test 5 — Faculty follow-up

“Show CSE department information.” took 61.2 seconds and returned a model summary (NBA, seat counts, placement counts). Those figures were **not** checked line by line against the department page in this run, so that summary is **not** marked passed.

“What about its faculty?” took 3.4 seconds and returned a table of 53 rows. Every sampled department value was `CSE`. The first row was Dr. SEELAM NAGARJUNA REDDY, Professor & HOD, CSE. No Civil Engineering row and no hostel label appeared in the department column.

Status: **pass** for staying on CSE faculty. The rows came from the indexed faculty collection, not from a fresh download of the CSE faculty page during that turn.

## Test 6 — Compare CSE and ECE

Actual, 2.2 seconds. The CSE cell included “established in 1998” and an intake sentence from `https://www.lbrce.ac.in/cse/index.php`. ECE established and intake were “Not stated on the official page.” No invented ECE number was filled in.

Status: **pass** for not fabricating the missing side. The CSE sentence is a clipped extract, not a cleaned field.

## Test 7 — Unsupported question

Question: “What is the secret club membership fee for the invented LBRCE robotics club?”

Actual, 17.7 seconds: it said the answer is not established and it would not guess. It also listed many unrelated fee amounts from official fee pages (175000, 78600, and others) because the question contains the word “fee.”

Status: **fail**. It did not invent a club fee. It still presented unrelated amounts as if they were part of the answer.

## Test 8 — Roster plus timetable

Not re-run. The existing refusal for a complete identifiable roster was not removed. The timetable half has the same unread-grid failure as Test 2.

Status: **not passed** in this run.

## Automated tests

`placements.test.ts`, `failures.test.ts`, and `audit-questions.test.ts`: 20 tests passed. They use fixtures. They do not prove the live site.
