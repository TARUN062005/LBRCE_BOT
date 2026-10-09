import * as cheerio from 'cheerio';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { matchDepartment } from '@lbrce/shared';
import { entriesFromSpreadsheet, parseTimetableText, type ParsedEntry } from '../timetable/parse.js';
import { logger } from '../utils/logger.js';

export interface ExtractedTable {
  headers: string[];
  rows: string[][];
}

export interface ExtractedImage {
  url: string;
  alt: string;
  title: string;
  caption: string;
  context: string;
}

export interface ExtractedPage {
  title: string;
  headings: string[];
  text: string;
  tables: ExtractedTable[];
  images: ExtractedImage[];
  links: string[];
}

const SKIP_IMAGE = /logo|icon|sprite|button|favicon|banner-bg|pixel/i;

export function extractHtmlPage(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe').remove();
  const title = clean($('title').first().text()) || clean($('h1').first().text()) || pageUrl;
  const headings = $('h1, h2, h3')
    .map((_, element) => clean($(element).text()))
    .get()
    .filter(Boolean)
    .slice(0, 40);

  const tables: ExtractedTable[] = [];
  $('table').each((_, table) => {
    const rows: string[][] = [];
    $(table)
      .find('tr')
      .each((__, row) => {
        const cells: string[] = [];
        $(row)
          .find('th, td')
          .each((___, cell) => {
            cells.push(clean($(cell).text()));
          });
        if (cells.some(Boolean)) rows.push(cells);
      });
    if (rows.length < 2) return;
    tables.push({ headers: rows[0] ?? [], rows: rows.slice(1, 400) });
  });

  const images: ExtractedImage[] = [];
  $('img').each((_, image) => {
    const src = $(image).attr('src');
    if (!src || src.startsWith('data:')) return;
    let url: string;
    try {
      url = new URL(src, pageUrl).toString();
    } catch {
      return;
    }
    const alt = clean($(image).attr('alt') ?? '');
    const title = clean($(image).attr('title') ?? '');
    if (!alt && !title && SKIP_IMAGE.test(url)) return;
    const parentText = clean($(image).parent().text()).slice(0, 240);
    images.push({ url, alt, title, caption: title || alt, context: parentText });
  });

  const links = new Set<string>();
  $('a[href]').each((_, anchor) => {
    const href = $(anchor).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
      return;
    }
    try {
      const url = new URL(href, pageUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') links.add(url.toString().split('#')[0] ?? url.toString());
    } catch {
      return;
    }
  });

  const text = redactSensitive(
    $('body')
      .text()
      .replace(/[ \t]+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 80_000),
  );

  const timetableImages = images.filter((image) => /timetable|time-table|_tt_/i.test(image.url));
  const otherImages = images.filter((image) => !/timetable|time-table|_tt_/i.test(image.url));
  return {
    title,
    headings,
    text,
    tables: tables.slice(0, 8).map((table) => ({
      headers: table.headers.map(redactSensitive),
      rows: table.rows.map((row) => row.map(redactSensitive)),
    })),
    images: [...timetableImages.slice(0, 250), ...otherImages.slice(0, 30)],
    links: [...links],
  };
}

export function facultyFromTables(tables: ExtractedTable[], sourceUrl: string, fallbackDepartment?: string) {
  const people: { name: string; designation?: string; department?: string; isHead: boolean; sourceUrl: string }[] = [];
  for (const table of tables) {
    const headers = table.headers.map((header) => header.toLowerCase());
    const nameIndex = headers.findIndex((header) => /name/.test(header));
    const roleIndex = headers.findIndex((header) => /designation|qualification|position/.test(header));
    const deptIndex = headers.findIndex((header) => /department/.test(header));
    if (nameIndex < 0) continue;
    for (const row of table.rows) {
      const name = clean(row[nameIndex] ?? '');
      if (!name || name.length < 3 || /name/i.test(name)) continue;
      const designation = roleIndex >= 0 ? clean(row[roleIndex] ?? '') : undefined;
      const rawDepartment = deptIndex >= 0 ? clean(row[deptIndex] ?? '') : '';
      const department = normalizeDepartment(rawDepartment) || fallbackDepartment;
      people.push({
        name,
        designation,
        department,
        isHead: /head of the department|\bhod\b|\bhead\b/i.test(designation ?? ''),
        sourceUrl,
      });
    }
    if (people.length) break;
  }
  return people;
}

function normalizeDepartment(value: string): string | undefined {
  if (!value) return undefined;
  if (/^it$/i.test(value)) return 'IT';
  return matchDepartment(value)?.code ?? value;
}

export function classifyUrl(url: string): string {
  const value = url.toLowerCase();
  if (value.includes('timetable') || value.includes('time-table')) return 'timetable';
  if (value.includes('calender') || value.includes('calendar')) return 'calendar';
  if (value.includes('fee')) return 'fee';
  if (value.includes('placement')) return 'placement';
  if (value.includes('faculty')) return 'faculty';
  if (value.includes('regulation')) return 'regulation';
  if (value.includes('syllabus') || value.includes('lesson')) return 'syllabus';
  if (value.includes('notice') || value.includes('circular') || value.includes('notific')) return 'notice';
  if (value.includes('exam') || value.includes('result')) return 'circular';
  return 'other';
}

export function departmentFromUrl(url: string): string | undefined {
  return matchDepartment(url.replace(/[_./-]+/g, ' '))?.code;
}

export async function extractPdf(buffer: Buffer): Promise<{ pages: string[]; text: string; ocrRecommended: boolean }> {
  const { extractText } = await import('unpdf');
  const result = await extractText(new Uint8Array(buffer), { mergePages: false });
  const pages = (Array.isArray(result.text) ? result.text : [result.text ?? '']).map((page) => page.trim());
  const text = pages.join('\n\n');
  const shortPages = pages.filter((page) => page.length < 30).length;
  return { pages, text, ocrRecommended: pages.length > 0 && shortPages / pages.length > 0.6 };
}

export async function extractDocx(buffer: Buffer): Promise<{ text: string; tables: ExtractedTable[] }> {
  const raw = await mammoth.extractRawText({ buffer });
  const html = await mammoth.convertToHtml({ buffer });
  const tables = extractHtmlPage(html.value, 'https://www.lbrce.ac.in/').tables;
  return { text: raw.value, tables };
}

export function extractSpreadsheet(buffer: Buffer): { text: string; tables: ExtractedTable[]; entries: ParsedEntry[] } {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const tables: ExtractedTable[] = [];
  const entries: ParsedEntry[] = [];
  for (const name of workbook.SheetNames.slice(0, 6)) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, raw: false, defval: '' });
    const rows = matrix
      .slice(0, 500)
      .map((row) => row.map((cell) => String(cell ?? '').trim()))
      .filter((row) => row.some(Boolean));
    if (rows.length < 2) continue;
    const table = { headers: rows[0] ?? [], rows: rows.slice(1) };
    tables.push(table);
    entries.push(...entriesFromSpreadsheet(table.headers, table.rows));
  }
  const text = tables
    .map((table) => [table.headers.join(' | '), ...table.rows.map((row) => row.join(' | '))].join('\n'))
    .join('\n\n');
  return { text, tables, entries };
}

export async function ocrImage(buffer: Buffer): Promise<string> {
  try {
    const tesseract = await import('tesseract.js');
    const worker = await tesseract.createWorker('eng');
    try {
      const result = await worker.recognize(buffer);
      return result.data.text ?? '';
    } finally {
      await worker.terminate();
    }
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : 'ocr failed' }, 'OCR skipped');
    return '';
  }
}

export function timetableEntriesFromText(text: string): ParsedEntry[] {
  return parseTimetableText(text);
}

function clean(value: string | undefined): string {
  return redactSensitive((value ?? '').replace(/\s+/g, ' ').trim());
}

function redactSensitive(value: string): string {
  return value.replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '');
}
