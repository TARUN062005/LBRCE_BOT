import { writeFileSync } from 'node:fs';

const API = 'http://127.0.0.1:4000';
const sessionId = 'e2elive01';

function summarize(blocks) {
  return (blocks ?? []).map((block) => {
    if (block.type === 'text' || block.type === 'document_summary') {
      return { type: block.type, markdown: String(block.markdown ?? '').slice(0, 1200) };
    }
    if (block.type === 'image_gallery') {
      return {
        type: block.type,
        title: block.title,
        images: (block.images ?? []).map((image) => ({
          url: image.url,
          pageUrl: image.pageUrl,
          title: image.title,
          alt: image.alt,
          caption: String(image.caption ?? '').slice(0, 180),
          topic: image.topic,
        })),
      };
    }
    if (block.type === 'table') {
      return { type: block.type, title: block.title, columns: block.columns, rows: (block.rows ?? []).slice(0, 12) };
    }
    if (block.type === 'timetable') {
      return {
        type: block.type,
        title: block.title,
        academicYear: block.academicYear,
        department: block.department,
        semester: block.semester,
        section: block.section,
        verificationStatus: block.verificationStatus,
        note: block.note,
        imageUrl: block.imageUrl,
        entryCount: (block.entries ?? []).length,
        citations: block.citations,
      };
    }
    if (block.type === 'clarification') return { type: block.type, question: block.question, options: block.options };
    if (block.type === 'insufficient_evidence') return { type: block.type, message: block.message };
    if (block.type === 'evidence') {
      return {
        type: block.type,
        items: (block.items ?? []).map((item) => ({
          sourceUrl: item.sourceUrl,
          sourceType: item.sourceType,
          documentTitle: item.documentTitle,
          excerpt: String(item.excerpt ?? '').slice(0, 240),
        })),
      };
    }
    if (block.type === 'source_list') return { type: block.type, sources: block.sources };
    return { type: block.type };
  });
}

async function ask(cookie, message, conversationId) {
  const started = Date.now();
  const response = await fetch(`${API}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ message, sessionId, conversationId }),
    signal: AbortSignal.timeout(180000),
  });
  const elapsedMs = Date.now() - started;
  const body = await response.json().catch(() => ({}));
  return {
    message,
    httpStatus: response.status,
    elapsedMs,
    conversationId: body.conversationId,
    blocks: summarize(body.blocks),
    error: body?.error,
  };
}

const health = {};
for (const [name, url] of [
  ['api', `${API}/api/health`],
  ['agent', 'http://127.0.0.1:4100/health'],
  ['web', 'http://127.0.0.1:5173/'],
]) {
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    health[name] = { status: response.status, ms: Date.now() - started };
  } catch (error) {
    health[name] = { error: error instanceof Error ? error.name : 'failed', ms: Date.now() - started };
  }
}

const session = await fetch(`${API}/api/session`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId }),
});
const setCookie = session.headers.get('set-cookie') ?? '';
const cookie = setCookie.split(';')[0];
if (!cookie) throw new Error('session cookie missing');

const turns = [
  { id: 'photos', message: 'Can you fetch some LBRCE photos?' },
  { id: 'tp-head', message: 'Who is the current Head of TP Cell?' },
  { id: 'placement-officer', message: 'Who is the Placement Officer?' },
  { id: 'tp-dean', message: 'Training and Placement Dean' },
  { id: 'timetable', message: 'Show CSE 7th semester C section timetable.' },
  { id: 'roster', message: 'Give me the complete CSE 7th semester C-section student list and timetable.' },
  { id: 'compare', message: 'Compare CSE and ECE departments in table format.' },
  { id: 'campus', message: 'Show me LBRCE campus photographs and explain the facilities.', thread: 'campus' },
  { id: 'faculty-followup', message: 'What about its faculty?', thread: 'campus' },
];

const results = [];
const threads = {};
for (const turn of turns) {
  const prior = turn.thread ? threads[turn.thread] : undefined;
  process.stdout.write(`start ${turn.id}\n`);
  try {
    const result = await ask(cookie, turn.message, prior);
    if (turn.thread && result.conversationId) threads[turn.thread] = result.conversationId;
    results.push({ id: turn.id, ...result });
    process.stdout.write(`done ${turn.id} ${result.elapsedMs} ${result.httpStatus}\n`);
  } catch (error) {
    results.push({ id: turn.id, message: turn.message, error: error instanceof Error ? error.name + ': ' + error.message : 'failed' });
    process.stdout.write(`fail ${turn.id}\n`);
  }
  writeFileSync(new URL('./api-results.json', import.meta.url), JSON.stringify({ health, results }, null, 2));
}

const photo = results.find((item) => item.id === 'photos');
const image = photo?.blocks?.find((block) => block.type === 'image_gallery')?.images?.[0];
if (image?.url) {
  const started = Date.now();
  try {
    const downloaded = await fetch(`${API}/api/media?url=${encodeURIComponent(image.url)}`, { signal: AbortSignal.timeout(60000) });
    const bytes = Buffer.from(await downloaded.arrayBuffer());
    results.push({
      id: 'download',
      url: image.url,
      httpStatus: downloaded.status,
      contentType: downloaded.headers.get('content-type'),
      disposition: downloaded.headers.get('content-disposition'),
      bytes: bytes.length,
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    results.push({ id: 'download', url: image.url, error: error instanceof Error ? error.message : 'failed' });
  }
  writeFileSync(new URL('./api-results.json', import.meta.url), JSON.stringify({ health, results }, null, 2));
}

console.log('complete', results.length);
