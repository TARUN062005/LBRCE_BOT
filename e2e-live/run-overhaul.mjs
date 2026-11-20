const base = 'http://127.0.0.1:4000';
const session = 'overhaul01';

async function ask(message, conversationId) {
  const started = Date.now();
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' },
    body: JSON.stringify({ message, sessionId: session, conversationId }),
  });
  const body = await response.json();
  const blocks = body.blocks ?? [];
  const text = blocks
    .map((block) => block.markdown || block.question || block.message || '')
    .filter(Boolean)
    .join('\n')
    .slice(0, 1200);
  const images = blocks.flatMap((block) => block.images ?? []);
  const docs = blocks.filter((block) => block.documentUrl).map((block) => block.documentUrl);
  return {
    status: response.status,
    ms: Date.now() - started,
    conversationId: body.conversationId,
    text,
    imageCount: images.length,
    imageHosts: [...new Set(images.map((image) => { try { return new URL(image.url).hostname; } catch { return ''; } }))],
    gallery: images.filter((image) => /gallery/i.test(`${image.url} ${image.pageUrl ?? ''}`)).length,
    docs,
    types: blocks.map((block) => block.type),
  };
}

const results = [];
async function step(name, message, conversationId) {
  const result = await ask(message, conversationId);
  results.push({ name, message, ...result });
  console.log(JSON.stringify({ name, ms: result.ms, status: result.status, types: result.types, imageCount: result.imageCount, gallery: result.gallery, docs: result.docs, text: result.text.slice(0, 400) }));
  return result.conversationId;
}

await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' }, body: JSON.stringify({ sessionId: session }) });
await step('tpo', 'Who is the current Training and Placement Officer?');
await step('photos', 'Can you fetch some LBRCE photos?');
await step('compare', 'Compare CSE and ECE.');
await step('unsupported', 'What is the secret club membership fee for the invented LBRCE robotics club?');
let calendarId = await step('calendar-ask', 'Show me the academic calendar.');
if (calendarId) await step('calendar-year', '2026-27', calendarId);
let facultyId = await step('cse-info', 'Show CSE department information.');
if (facultyId) await step('cse-faculty', 'What about its faculty?', facultyId);
