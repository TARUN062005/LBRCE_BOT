import * as cheerio from 'cheerio';
import { fetchPublic } from './college-sources/fetch.js';
import { extractPdf, ocrPdf } from '../ingestion/extract.js';

const LISTING = 'https://www.lbrce.ac.in/academic_pages/aycalender.php';

export interface OfficialCalendar {
  url: string;
  title: string;
  text: string;
  pdf?: Buffer;
}

export async function loadOfficialCalendar(question: string, signal?: AbortSignal): Promise<OfficialCalendar | null> {
  if (signal?.aborted) return null;
  const listing = await fetchPublic(LISTING, ['lbrce.ac.in']);
  const $ = cheerio.load(listing.body.toString('utf8'));
  const links: string[] = [];
  $('a[href]').each((_, anchor) => {
    const href = $(anchor).attr('href') ?? '';
    if (!/academic_calendars_.*\.pdf/i.test(href)) return;
    links.push(new URL(href, LISTING).toString());
  });
  const url = pickCalendarUrl(links, question);
  if (!url) return null;
  const file = await fetchPublic(url, ['lbrce.ac.in'], { maxBytes: 12 * 1024 * 1024 });
  if (!file.contentType.toLowerCase().includes('pdf') && !url.toLowerCase().endsWith('.pdf')) return null;
  const extracted = await extractPdf(file.body);
  let raw = extracted.text;
  let text = raw.replace(/\s+/g, ' ').trim();
  const title = decodeURIComponent(url.split('/').pop() ?? 'Academic calendar');
  const dated = (value: string) =>
    /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/.test(value) ||
    /\b(january|february|march|april|june|july|august|september|october|november|december)\b/i.test(value);
  if (text.length <= 80 || !dated(text)) {
    const ocr = await ocrPdf(file.body, 8);
    if (ocr.trim().length > text.length && dated(ocr)) {
      raw = ocr;
      text = ocr.replace(/\s+/g, ' ').trim();
    }
  }
  if (text.length > 80 && dated(text)) {
    return { url, title, text: focusCalendarText(raw, question) };
  }
  if (file.body.length > 8 * 1024 * 1024) return { url, title, text: '' };
  return { url, title, text: '', pdf: file.body };
}

/** Years printed on the official calendar listing, newest first. */
export async function calendarYearOptions(signal?: AbortSignal): Promise<string[]> {
  const links = await calendarLinks(signal);
  const years = new Set<string>();
  for (const href of links) {
    const match = href.match(/(20\d{2})\s*[-–]\s*(\d{2,4})/);
    if (!match?.[1] || !match[2]) continue;
    years.add(`${match[1]}-${match[2].slice(-2)}`);
  }
  return [...years].sort((left, right) => right.localeCompare(left));
}

/** Official calendar PDF for a question that already names a year. */
export async function calendarFileUrl(question: string, signal?: AbortSignal): Promise<string | null> {
  const links = await calendarLinks(signal);
  return pickCalendarUrl(links, question) ?? null;
}

async function calendarLinks(signal?: AbortSignal): Promise<string[]> {
  if (signal?.aborted) return [];
  const listing = await fetchPublic(LISTING, ['lbrce.ac.in']);
  const $ = cheerio.load(listing.body.toString('utf8'));
  const links: string[] = [];
  $('a[href]').each((_, anchor) => {
    const href = $(anchor).attr('href') ?? '';
    if (!/academic_calendars_.*\.pdf/i.test(href)) return;
    links.push(new URL(href, LISTING).toString());
  });
  return links;
}

export function pickCalendarUrl(links: string[], question: string): string | undefined {
  const years = [...question.matchAll(/\b(20\d{2})\b/g)].map((match) => match[1] ?? '');
  const start = years[0];
  const end = years[1];
  if (start && end) {
    const short = `${start}-${end.slice(-2)}`;
    const match = links.find((url) => url.includes(short));
    if (match) return match;
  }
  if (start) {
    const match = links.find((url) => url.includes(start));
    if (match) return match;
  }
  return [...links].sort((left, right) => calendarStart(right) - calendarStart(left))[0];
}

function calendarStart(url: string): number {
  const match = url.match(/(20\d{2})\s*[-–]\s*\d{2,4}/);
  return match ? Number(match[1]) : 0;
}

function focusCalendarText(text: string, question: string): string {
  const holiday = question.match(/sankranthi|sankranti|pongal|holiday/i)?.[0];
  if (!holiday) return text.slice(0, 24000);
  const at = text.search(new RegExp(holiday, 'i'));
  if (at < 0) return text.slice(0, 6000);
  return text.slice(Math.max(0, at - 500), at + 1500);
}
