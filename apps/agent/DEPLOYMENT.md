# LBRCE Python agent — deployment

The public site and the admin API stay on the existing Node.js process. The Python process is a private worker. Do not publish port 4100 to the internet.

## Processes

| Process | Dev command | Default bind | Role |
| --- | --- | --- | --- |
| Express | `npm run dev -w @lbrce/api` | `0.0.0.0:4000` in the existing server | Sessions, chat history, admin, and the public `/api/chat` routes |
| Vite | `npm run dev -w @lbrce/web` | `localhost:5173` | Chat page |
| FastAPI | `npm run dev:agent` | `127.0.0.1:4100` | LangGraph retrieval agent |

Express authenticates the browser session, then calls `POST /api/agent/chat/stream` with header `X-Agent-Token`. The browser never receives that token.

## Configuration

Set the same values in the existing root `.env`. Do not commit that file.

- `AGENT_BASE_URL` — Express target. Development default is `http://127.0.0.1:4100`.
- `AGENT_INTERNAL_TOKEN` — shared secret. Required in production. Development uses `local-dev` only for loopback clients.
- `AGENT_HOST` — Python bind address. Keep `127.0.0.1` unless the token is a real secret and the port is on a private network.
- `AGENT_PORT` — default `4100`.
- `MONGODB_URI`, `GEMINI_API_KEY`, `BHARATCODE_API_KEY`, `VECTOR_SEARCH_INDEX` — the Python process reads the same names the API already uses.

`PYTHON_AGENT=off` keeps the previous TypeScript retrieval path. If the Python process is down, Express also falls back to that path.

## Install

```powershell
cd "d:\LBRCE BOT\apps\agent"
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
```

PyMuPDF is the PDF reader that always runs: text, tables, embedded images, and page renders. The libraries in `requirements-document.txt` add a second path and are not installed by the command above.

```powershell
.\.venv\Scripts\python -m pip install -r requirements-document.txt
.\.venv\Scripts\python -m playwright install chromium
```

That second install is large. Use it only on a machine that will actually OCR and browse.

| Library | Why it is separate | If it is missing |
| --- | --- | --- |
| PaddleOCR and PaddlePaddle | Native inference runtime, about 1–2 GB | Scanned pages skip local OCR and go to Gemini Vision |
| Docling | Second PDF layout parser, overlaps PyMuPDF | Used only when PyMuPDF text is shorter than 80 characters |
| OpenCV | Image resize before OCR | Pillow resizes the render instead |
| Playwright | Chromium browser, about 300 MB | Download failure is reported; no screenshot is claimed |

## Resource and cost

- FastAPI plus PyMuPDF: about 200–400 MB RAM, one short CPU burst per PDF.
- Playwright: one headless Chromium, about 300–500 MB, only after a PDF download fails.
- PaddleOCR: commonly 1–2 GB RAM and several seconds per page. Do not run it on a small shared Node host.
- Gemini: one text call for the final answer, plus one vision call only when OCR does not recover a scanned page, plus one embedding only when vector search is configured and keyword search is empty. BharatCode is used only when Gemini returns nothing usable.
- MongoDB writes: a published chunk for each new official extract. No Redis and no extra hosted queue.
- The worker should stay on loopback or a private VPC. A public Python port would expose the model keys' caller. There is no separate paid host required for local development.

A host that only runs Node cannot be assumed to have Chromium, Paddle, or a long-lived Python process. On that kind of host, run the agent on a private VM with at least 2 GB RAM (4 GB if PaddleOCR is installed) and point `AGENT_BASE_URL` at it over the private network.

## What is installed in this workspace

- API dependency `playwright` and Chromium build 1255, including the headless shell, under the user Playwright browser folder.
- Python packages `playwright` and `rapidocr-onnxruntime` in `apps/agent/.venv`. RapidOCR is the local OCR engine. It reads a rendered page when the PDF has no text layer.
- PyMuPDF renders each kept page to `uploads/agent-pages`. Those files are local evidence, not public URLs.
- PaddleOCR and Docling are still not installed. The code calls them only when imported, and the working local path is PyMuPDF plus RapidOCR.

