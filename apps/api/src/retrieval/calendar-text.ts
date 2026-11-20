/** A printed calendar date. Glued or letter-mixed OCR tokens are rejected. */
export function validPrintedDate(token: string): string | null {
  const match = token.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2010 || year > 2040) return null;
  return `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`;
}

export function lineHasCorruptDate(line: string): boolean {
  const withoutValid = line.replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/g, ' ');
  return /\d{5,}|[A-Za-z]+\d{2,}|\d+[A-Za-z]+\d+|\d{1,2}\.\d{1,2}[/-]\d{2,4}/.test(withoutValid);
}

/** Lines that belong to one regulation and contain only well-formed dates. */
export function linesForRegulation(text: string, regulation: string): string[] {
  const wanted = regulation.toUpperCase();
  const pages = text.split(/\n(?=--- page \d+ ---)/);
  let current = '';
  const kept: string[] = [];
  for (const page of pages) {
    const headerCodes = [...page.slice(0, 500).matchAll(/\bR\d{2}\b/gi)].map((match) => (match[0] ?? '').toUpperCase());
    const unique = [...new Set(headerCodes)];
    if (unique.length === 1) current = unique[0] ?? current;
    if (current !== wanted) continue;
    for (const raw of page.split('\n')) {
      const line = raw.replace(/\s+/g, ' ').trim();
      if (line.startsWith('--- page ')) continue;
      const codes = [...line.matchAll(/\bR\d{2}\b/gi)].map((match) => (match[0] ?? '').toUpperCase());
      if (codes.length && !codes.includes(wanted)) continue;
      if (!/commencement|instruction|holiday|vacation|examination|\bmid\b/i.test(line)) continue;
      if (lineHasCorruptDate(line)) continue;
      const dates = [...line.matchAll(/\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/g)].map((match) => validPrintedDate(match[0] ?? ''));
      if (!dates.length || dates.some((date) => !date)) continue;
      kept.push(line);
    }
  }
  return kept.slice(0, 12);
}
