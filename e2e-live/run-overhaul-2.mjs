const base = 'http://127.0.0.1:4000';

async function ask(message, conversationId, session) {
  const started = Date.now();
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' },
    body: JSON.stringify({ message, sessionId: session, conversationId }),
  });
  const body = await response.json();
  const blocks = body.blocks ?? [];
  const table = blocks.find((block) => block.type === 'table');
  const images = blocks.flatMap((block) => block.images ?? []);
  return {
    ms: Date.now() - started,
    conversationId: body.conversationId,
    text: blocks.map((block) => block.markdown || block.question || '').join('\n').slice(0, 700),
    options: blocks.find((block) => block.type === 'clarification')?.options ?? [],
    imageCount: images.length,
    gallery: images.filter((image) => /\/gallery\//i.test(image.url)).length,
    sample: images.slice(0, 3).map((image) => image.url),
    rows: (table?.rows ?? []).slice(0, 4),
    departments: [...new Set((table?.rows ?? []).map((row) => row[2]).filter(Boolean))].slice(0, 8),
    rowCount: table?.rows?.length ?? 0,
  };
}

await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' }, body: JSON.stringify({ sessionId: 'overhaul02' }) });
const photos = await ask('Can you fetch some LBRCE photos?', undefined, 'overhaul02');
console.log('PHOTOS', JSON.stringify(photos));
const info = await ask('Show CSE department information.', undefined, 'overhaul03');
const faculty = await ask('What about its faculty?', info.conversationId, 'overhaul03');
console.log('FACULTY', JSON.stringify({ ms: faculty.ms, rowCount: faculty.rowCount, departments: faculty.departments, rows: faculty.rows }));
const year = await ask('Show me the academic calendar.', undefined, 'overhaul04');
const picked = await ask('2026-27', year.conversationId, 'overhaul04');
console.log('CALENDAR', JSON.stringify({ ask: year.text, options: picked.options, text: picked.text.slice(0, 300), ms: picked.ms }));
