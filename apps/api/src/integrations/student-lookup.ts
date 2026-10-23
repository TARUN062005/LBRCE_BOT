import * as cheerio from 'cheerio';
import { DocumentChunk } from '../models/index.js';
import { fetchPublic } from './college-sources/fetch.js';

const SITE = 'https://www.lbrce.ac.in';

const LISTS_BY_BRANCH: Record<string, string[]> = {
  '01': ['/civil/civilstudentslist.php'],
  '02': ['/eee/eeestudentslist.php'],
  '03': ['/mech/mechstudentslist.php'],
  '04': ['/ece/ecestudentslist.php'],
  '05': ['/cse/csestudentslist.php', '/csm/csmstudentslist.php', '/ai/aistudentslist.php'],
  '12': ['/it/itstudentslist.php'],
  '21': ['/ase/asestudentslist.php'],
  '54': ['/mba/mbastudentslist.php'],
};

const ALL_LISTS = [...new Set(Object.values(LISTS_BY_BRANCH).flat())];

export interface StudentHit {
  registrationNumber: string;
  name: string;
  url: string;
  title: string;
}

export function registrationNumbers(message: string): string[] {
  return [...new Set([...message.toUpperCase().matchAll(/\b\d{5}[A-Z]\d{2}[A-Z0-9]{2}\b/g)].map((match) => match[0]))];
}

export async function lookupStudents(numbers: string[], signal?: AbortSignal): Promise<StudentHit[]> {
  const wanted = new Set(numbers.map((number) => number.toUpperCase()));
  const found = new Map<string, StudentHit>();
  if (!wanted.size) return [];

  const indexed = await DocumentChunk.find({
    published: true,
    $or: [...wanted].map((number) => ({ text: new RegExp(`\\b${number}\\b`) })),
  })
    .select('text sourceUrl title')
    .limit(20)
    .lean();

  for (const row of indexed) {
    for (const line of String(row.text ?? '').split('\n')) {
      for (const number of wanted) {
        if (found.has(number) || !new RegExp(`\\b${number}\\b`).test(line.toUpperCase())) continue;
        const name = line.split('|')[0]?.trim();
        if (!name || name.length < 3) continue;
        found.set(number, {
          registrationNumber: number,
          name: name.replace(/^student registration list\s*/i, ''),
          url: String(row.sourceUrl ?? ''),
          title: String(row.title ?? 'Student registration list'),
        });
      }
    }
  }

  const missing = [...wanted].filter((number) => !found.has(number));
  if (missing.length && !signal?.aborted) {
    for (const path of listPaths(missing)) {
      const still = missing.filter((number) => !found.has(number));
      if (!still.length || signal?.aborted) break;
      const page = await readList(`${SITE}${path}`, still);
      for (const hit of page) found.set(hit.registrationNumber, hit);
    }
  }

  return [...wanted].flatMap((number) => {
    const hit = found.get(number);
    return hit ? [hit] : [];
  });
}

function listPaths(numbers: string[]): string[] {
  const paths = new Set<string>();
  for (const number of numbers) {
    const branch = number.match(/[A-Z](\d{2})/)?.[1] ?? '';
    for (const path of LISTS_BY_BRANCH[branch] ?? ALL_LISTS) paths.add(path);
  }
  return [...paths];
}

async function readList(url: string, numbers: string[]): Promise<StudentHit[]> {
  try {
    const response = await fetchPublic(url, ['lbrce.ac.in']);
    const html = response.body.toString('utf8').slice(0, 2_000_000);
    const $ = cheerio.load(html);
    const title = $('title').first().text().replace(/\s+/g, ' ').trim() || 'Student list';
    const hits: StudentHit[] = [];
    $('tr').each((_, row) => {
      const cells = $(row)
        .find('th, td')
        .toArray()
        .map((cell) => $(cell).text().replace(/\s+/g, ' ').trim());
      for (const number of numbers) {
        if (!cells.some((cell) => cell.replace(/\s/g, '').toUpperCase() === number)) continue;
        const name = cells.find((cell) => /[A-Za-z]{4,}/.test(cell) && !/regd|registration|name of|student/i.test(cell));
        if (!name) continue;
        hits.push({ registrationNumber: number, name, url, title });
      }
    });
    return hits;
  } catch {
    return [];
  }
}
