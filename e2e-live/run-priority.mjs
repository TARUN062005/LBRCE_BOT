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
  const images = blocks.flatMap((block) => block.images ?? []);
  const timetable = blocks.find((block) => block.type === 'timetable');
  return {
    ms: Date.now() - started,
    status: response.status,
    conversationId: body.conversationId,
    text: blocks.map((block) => block.markdown || block.question || block.note || '').join('\n'),
    imageCount: images.length,
    hosts: [...new Set(images.map((image) => { try { return new URL(image.url).host; } catch { return 'bad'; } }))],
    gallery: images.filter((image) => /\/images\/gallery\//i.test(image.url)).length,
    entries: timetable?.entries?.length ?? 0,
    timetableNote: timetable?.note ?? '',
    imageUrl: Boolean(timetable?.imageUrl),
  };
}

const which = process.argv[2] ?? 'short';
if (which === 'short') {
  await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' }, body: JSON.stringify({ sessionId: 'priority01' }) });
  const fee = await ask('What is the secret club membership fee for the invented LBRCE robotics club?', undefined, 'priority01');
  console.log('FEE', JSON.stringify({ ms: fee.ms, text: fee.text.slice(0, 500), hasDump: /175000|78600|different amounts/i.test(fee.text) }));
  const compare = await ask('Compare CSE and ECE.', undefined, 'priority02');
  console.log('COMPARE', JSON.stringify({ ms: compare.ms, text: compare.text.slice(0, 900) }));
  const photos = await ask('Can you fetch some LBRCE photos?', undefined, 'priority03');
  console.log('PHOTOS', JSON.stringify({ ms: photos.ms, imageCount: photos.imageCount, gallery: photos.gallery, hosts: photos.hosts, text: photos.text.slice(0, 240) }));
}
if (which === 'timetable') {
  const result = await ask('Show CSE 7th semester C section timetable.', undefined, 'priority04');
  console.log('TIMETABLE', JSON.stringify({ ms: result.ms, entries: result.entries, note: result.timetableNote, image: result.imageUrl, text: result.text.slice(0, 400) }));
}
if (which === 'calendar') {
  const year = await ask('Show me the academic calendar.', undefined, 'priority05');
  const picked = await ask('2026-27', year.conversationId, 'priority05');
  const chosen = await ask('Regulation R26', picked.conversationId, 'priority05');
  console.log('CALENDAR', JSON.stringify({
    ask: year.text.slice(0, 200),
    options: picked.text.slice(0, 200),
    r26: chosen.text.slice(0, 1200),
    ms: chosen.ms,
    hasR23: /R23|13-07-2026|iot0206|oM020/.test(chosen.text),
  }));
}
