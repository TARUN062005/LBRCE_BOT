import { createHash } from 'node:crypto';
import { assertPublicUrl, type ResolveHost } from '../security/ssrf.js';
import { isNavigationText, pageAnswersQuestion } from '../retrieval/grounding.js';

export const MAX_PDF_BYTES = 12 * 1024 * 1024;
export const MAX_PDF_PAGES = 40;

export interface EvidenceItem {
  sourceUrl: string;
  sourceType: 'webpage' | 'pdf' | 'image' | 'screenshot';
  documentTitle?: string;
  pageNumber?: number;
  extractedText: string;
  capturedAt: string;
  documentDate?: string;
  contentHash?: string;
  verificationStatus: 'verified' | 'partial' | 'unverified';
  pageUrl?: string;
}

export interface TimetablePeriod {
  period: number;
  startTime: string | null;
  endTime: string | null;
  subject: string | null;
  faculty: string | null;
  room: string | null;
  uncertain: boolean;
}

export interface TimetableStructure {
  department: string | null;
  year: string | null;
  semester: string | null;
  section: string | null;
  academicYear: string | null;
  day: string | null;
  periods: TimetablePeriod[];
  unreadable: boolean;
}

const INJECTION = /ignore (all |any |the )?(previous |prior )?instructions|system prompt|you are now|reveal (the )?(api key|secret)/gi;

export function sanitizeUntrusted(text: string): string {
  return text.replace(INJECTION, '[removed untrusted instruction]').replace(/\s+/g, ' ').trim().slice(0, 8000);
}

export function refusesOutsideCollege(message: string): boolean {
  if (/\b(lbrce|lakireddy|mylavaram)\b/i.test(message)) return false;
  return /\b(random|another college|other college|private college|wikipedia|\biit\b|\bnit\b)\b/i.test(message);
}

export function assessPdf(buffer: Buffer, pageCount = 1): { ok: true; hash: string } | { ok: false; reason: string } {
  if (buffer.length > MAX_PDF_BYTES) return { ok: false, reason: 'PDF exceeds the 12 MB limit' };
  if (pageCount > MAX_PDF_PAGES) return { ok: false, reason: 'PDF exceeds the 40 page limit' };
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return { ok: false, reason: 'File is not a PDF' };
  return { ok: true, hash: createHash('sha256').update(buffer).digest('hex') };
}

export async function assertCollegeHttps(raw: string, resolve?: ResolveHost): Promise<URL> {
  const url = await assertPublicUrl(raw, ['lbrce.ac.in'], resolve);
  if (url.protocol !== 'https:') throw new Error('Only HTTPS official URLs are opened');
  if (url.hostname.toLowerCase() === 'erp.lbrce.ac.in') throw new Error('ERP login pages are not public evidence');
  if (/login/i.test(url.pathname)) throw new Error('Login pages are not public evidence');
  return url;
}

export function evidenceIsSufficient(message: string, texts: string[]): boolean {
  const usable = texts.map((text) => sanitizeUntrusted(text)).filter((text) => text.length > 40 && !isNavigationText(text));
  if (!usable.length) return false;
  return pageAnswersQuestion(message, usable.join('\n'));
}

export function conflictingAmounts(texts: string[]): string[] {
  const amounts = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/₹\s*[\d,]+|rs\.?\s*[\d,]+/gi)) {
      amounts.add(match[0].replace(/[^\d]/g, ''));
    }
  }
  const values = [...amounts].filter((value) => value.length >= 4);
  if (values.length < 2) return [];
  return [`The official extracts mention different amounts: ${values.join(', ')}.`];
}

export function timetableFromText(text: string): TimetableStructure {
  const cleaned = sanitizeUntrusted(text);
  const time = cleaned.match(/\b(\d{1,2}:\d{2})\b/);
  const readable = Boolean(time);
  return {
    department: null,
    year: null,
    semester: null,
    section: null,
    academicYear: cleaned.match(/\b(20\d{2}\s*[-–/]\s*\d{2,4})\b/)?.[1] ?? null,
    day: cleaned.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday)\b/i)?.[1] ?? null,
    periods: [
      {
        period: 1,
        startTime: time?.[1] ?? null,
        endTime: null,
        subject: null,
        faculty: null,
        room: null,
        uncertain: !readable,
      },
    ],
    unreadable: !readable,
  };
}

export function calendarEvents(text: string): { academicYear: string | null; events: string[] } {
  const cleaned = sanitizeUntrusted(text);
  const years = [...cleaned.matchAll(/\b(20\d{2}\s*[-–/]\s*\d{2,4})\b/g)].map((match) => match[1] ?? '');
  const uniqueYears = [...new Set(years)];
  return {
    academicYear: uniqueYears.at(-1) ?? null,
    events: uniqueYears,
  };
}

export function acceptModelPlan(requested: string[], allowed: readonly string[]): string[] {
  const allow = new Set(allowed);
  const chosen: string[] = [];
  for (const name of requested) {
    if (!allow.has(name) || chosen.includes(name)) continue;
    chosen.push(name);
    if (chosen.length >= 6) break;
  }
  return chosen;
}

const seenHashes = new Set<string>();

export function rememberDocument(hash: string): { duplicate: boolean } {
  if (seenHashes.has(hash)) return { duplicate: true };
  seenHashes.add(hash);
  return { duplicate: false };
}

export function resetDocumentMemory(): void {
  seenHashes.clear();
}
