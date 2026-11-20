const ADMISSION =
  /could not be (found|verified|read)|could not find|not visible|will not guess|do not (have|know)|no (specific |official )?(announcement|information)|was not (found|listed|stated)|not stated on/i;

export function answerAdmitsGap(markdown: string): boolean {
  return ADMISSION.test(markdown);
}

export function cleanAnswerText(markdown: string): string {
  return markdown.replace(/\[email\s+protected\]/gi, 'the address printed on the official contact page');
}

/** Keep lbrce.ac.in pages that can actually be read. Login and ERP screens are not sources. */
export function usableCollegeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'lbrce.ac.in' && !host.endsWith('.lbrce.ac.in')) return undefined;
    if (host === 'erp.lbrce.ac.in') return undefined;
    if (/login/i.test(parsed.pathname)) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

/**
 * Every number of three or more digits in the answer must appear in the evidence or the question.
 * Commas are ignored so 78,600 matches 78600.
 */
export function figuresSupported(answer: string, evidence: string, question = ''): boolean {
  const allowed = `${evidence} ${question}`.replace(/,/g, '');
  const sequences = answer.match(/\d[\d,]{2,}/g) ?? [];
  return sequences.every((sequence) => allowed.includes(sequence.replace(/,/g, '')));
}

export function evidenceHasToday(text: string, now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(
    now,
  );
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const monthName = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', month: 'long' }).format(now);
  const shortMonth = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', month: 'short' }).format(now);
  const dayNumber = String(Number(day));
  const patterns = [
    `${day}-${month}-${year}`,
    `${day}/${month}/${year}`,
    `${year}-${month}-${day}`,
    `${dayNumber} ${monthName} ${year}`,
    `${monthName} ${dayNumber}, ${year}`,
    `${dayNumber} ${shortMonth} ${year}`,
  ];
  const haystack = text.toLowerCase();
  return patterns.some((pattern) => haystack.includes(pattern.toLowerCase()));
}

export function decodeCfEmail(hex: string): string {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2 !== 0) return '';
  const key = Number.parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let index = 2; index < hex.length; index += 2) {
    out += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16) ^ key);
  }
  return out.includes('@') ? out : '';
}

const NOT_GROUNDED = 'This could not be verified from the official college sources. I will not guess the missing fact.';

export function unverifiedMessage(): string {
  return NOT_GROUNDED;
}

const GENERIC_TOKENS = new Set(
  'what when where which who whom whose why how does did the and for with from that this about lbrce lakireddy mylavaram college please show tell can you latest current official available information requirement facilities procedure structure visited companies company membership year today announcement notice'.split(
    ' ',
  ),
);

const CATEGORY_TOKENS = new Set(
  'fee fees tuition hostel hostels principal contact phone email exam examination timetable schedule scholarship scholarships attendance placement placements admission admissions department departments calendar calendars'.split(
    ' ',
  ),
);

export function isNavigationText(text: string): boolean {
  const value = text.toLowerCase();
  const markers = ['home administration', 'student corner', 'call us:', 'all rights reserved', 'quick links', 'webmail', 'major recruiters', 'important links', 'total visitors'];
  const menu = ['student corner', 'examination time tables', 'freshman engineering', 'citizen charter'];
  return markers.filter((marker) => value.includes(marker)).length >= 2 || menu.filter((marker) => value.includes(marker)).length >= 2;
}

export function chunksAnswerQuestion(
  message: string,
  chunks: { title: string; text: string }[],
  intent: string,
  topic?: RegExp,
): boolean {
  const usable = chunks.filter((chunk) => !isNavigationText(`${chunk.title} ${chunk.text}`));
  if (!usable.length) return false;
  const blob = usable.map((chunk) => `${chunk.title} ${chunk.text}`).join('\n');
  if (!pageAnswersQuestion(message, blob)) return false;
  if (intent === 'notice' && /\btoday\b/i.test(message) && !evidenceHasToday(blob)) return false;
  if (topic) return usable.some((chunk) => topic.test(`${chunk.title} ${chunk.text}`));
  if (intent === 'fee') return /tuition|₹|rs\.?\s*\d|per year/i.test(blob);
  if (intent === 'placement') return /placement/i.test(blob);
  if (intent === 'admission') return /admission|eapcet|icet|pgecet/i.test(blob);
  if (intent === 'department') return /department|engineering/i.test(blob);
  return true;
}
export function pageAnswersQuestion(question: string, text: string): boolean {
  const tokens = [...question.toLowerCase().matchAll(/\b[a-z0-9]{4,}\b/g)]
    .map((match) => match[0])
    .filter((token) => !GENERIC_TOKENS.has(token));
  if (!tokens.length) return true;
  const haystack = text.toLowerCase();
  const contains = (token: string) => haystack.includes(token);
  const specific = tokens.filter((token) => !CATEGORY_TOKENS.has(token));
  if (!specific.length) return tokens.some(contains);
  const hits = specific.filter(contains).length;
  return hits >= Math.min(2, specific.length);
}
