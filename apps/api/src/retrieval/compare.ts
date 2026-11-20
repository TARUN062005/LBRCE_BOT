import { matchDepartment } from '@lbrce/shared';
import { fetchPublic } from '../integrations/college-sources/fetch.js';

const PAGES: Record<string, string> = {
  CSE: 'https://www.lbrce.ac.in/cse/index.php',
  ECE: 'https://www.lbrce.ac.in/ece/index.php',
  EEE: 'https://www.lbrce.ac.in/eee/index.php',
  IT: 'https://www.lbrce.ac.in/it/index.php',
  CE: 'https://www.lbrce.ac.in/civil/index.php',
  ME: 'https://www.lbrce.ac.in/mech/index.php',
  ASE: 'https://www.lbrce.ac.in/ase/index.php',
  'AI&DS': 'https://www.lbrce.ac.in/ai/index.php',
  MBA: 'https://www.lbrce.ac.in/mba/index.php',
};

export async function compareDepartmentPages(message: string): Promise<{ markdown: string; urls: string[] } | null> {
  const codes = departmentsIn(message);
  if (codes.length < 2) return null;
  const rows: string[][] = [];
  const urls: string[] = [];
  for (const code of codes.slice(0, 2)) {
    const url = PAGES[code];
    if (!url) return null;
    const response = await fetchPublic(url, ['lbrce.ac.in']);
    const text = response.body
      .toString('utf8')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim();
    urls.push(response.url || url);
    rows.push([code, groundedPhrase(text, /established in \d{4}/i), groundedIntake(text)]);
  }
  const header = `| | ${rows[0]?.[0] ?? ''} | ${rows[1]?.[0] ?? ''} |\n| --- | --- | --- |`;
  const body = [
    `| Established | ${cell(rows[0]?.[1])} | ${cell(rows[1]?.[1])} |`,
    `| Intake | ${cell(rows[0]?.[2])} | ${cell(rows[1]?.[2])} |`,
  ].join('\n');
  const links = urls.map((url, index) => `- [${codes[index]}](${url})`).join('\n');
  return {
    markdown: `Comparison uses only the official department pages. A field that is not printed is marked unavailable.\n\n${header}\n${body}\n\n${links}`,
    urls,
  };
}

function departmentsIn(message: string): string[] {
  const found: string[] = [];
  const pattern = /\b(CSE|ECE|EEE|IT|CE|ME|ASE|MBA|AI\s*&\s*DS|AIDS)\b/gi;
  for (const match of message.matchAll(pattern)) {
    const token = match[1] ?? '';
    const department = matchDepartment(token.replace(/\s+/g, ''));
    const code = department?.code ?? token.toUpperCase();
    if (code && !found.includes(code)) found.push(code);
  }
  return found;
}

/** A phrase is kept only when every number in it appears in that same official page. */
export function groundedPhrase(text: string, pattern: RegExp): string {
  const match = text.match(pattern)?.[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (!match) return '';
  const numbers = match.match(/\d[\d,]*/g) ?? [];
  const source = text.replace(/,/g, '');
  if (!numbers.length || numbers.some((number) => !source.includes(number.replace(/,/g, '')))) return '';
  return match;
}

/** Keeps the printed intake phrase, including a later increase when the same sentence states one. */
export function groundedIntake(text: string): string {
  return groundedPhrase(text, /intake of \d{1,4} students(?: and the intake was subsequently increased to \d{1,4} students)?/i);
}

function cell(value: string | undefined): string {
  const clean = (value ?? '').replace(/\|/g, '/').trim();
  return clean || 'Not stated on the official page';
}
