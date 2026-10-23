import * as cheerio from 'cheerio';
import { fetchPublic } from './college-sources/fetch.js';
import { extractPdf } from '../ingestion/extract.js';

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
  const text = extracted.text.replace(/\s+/g, ' ').trim();
  const title = decodeURIComponent(url.split('/').pop() ?? 'Academic calendar');
  if (text.length > 80) {
    const focus = focusCalendarText(extracted.text, question);
    return { url, title, text: focus };
  }
  if (file.body.length > 8 * 1024 * 1024) return { url, title, text: '' };
  return { url, title, text: '', pdf: file.body };
}

function pickCalendarUrl(links: string[], question: string): string | undefined {
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
  return links[0];
}

function focusCalendarText(text: string, question: string): string {
  const holiday = question.match(/sankranthi|sankranti|pongal|holiday/i)?.[0];
  if (!holiday) return text.slice(0, 6000);
  const at = text.search(new RegExp(holiday, 'i'));
  if (at < 0) return text.slice(0, 6000);
  return text.slice(Math.max(0, at - 500), at + 1500);
}
