import * as cheerio from 'cheerio';
import { assertPublicUrl } from '../security/ssrf.js';

export interface WebPageEvidence {
  title: string;
  url: string;
  text: string;
}

function isCollegePage(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'lbrce.ac.in' || host.endsWith('.lbrce.ac.in');
  } catch {
    return false;
  }
}

export async function fetchWebEvidence(question: string, signal?: AbortSignal): Promise<WebPageEvidence[]> {
  const query = /\b(lbrce|lakireddy|mylavaram)\b/i.test(question) ? question : `${question} LBRCE Mylavaram`;
  const tokens = personTokens(question);
  const links = await searchLinks(query, signal);
  if (tokens.length && /\bcse\b/i.test(question)) {
    links.unshift({ title: 'CSE students list', url: 'https://www.lbrce.ac.in/cse/csestudentslist.php' });
  }
  const pages: WebPageEvidence[] = [];
  for (const link of links) {
    if (pages.length >= 3) break;
    if (pages.some((page) => page.url === link.url)) continue;
    const page = await readPage(link.url, signal, tokens);
    if (page) pages.push({ ...page, title: page.title || link.title });
  }
  return pages;
}

async function searchLinks(query: string, signal?: AbortSignal): Promise<{ title: string; url: string }[]> {
  const endpoints = [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html' },
        signal: signal ?? AbortSignal.timeout(12_000),
      });
      if (!response.ok) continue;
      const html = await response.text();
      const links = parseResultLinks(html);
      if (links.length) return links;
    } catch {
      continue;
    }
  }
  return [];
}

function parseResultLinks(html: string): { title: string; url: string }[] {
  const $ = cheerio.load(html);
  const links: { title: string; url: string }[] = [];
  $('a[href]').each((_, anchor) => {
    const title = $(anchor).text().replace(/\s+/g, ' ').trim();
    const href = $(anchor).attr('href') ?? '';
    const url = unwrapResultUrl(href);
    if (!url || title.length < 3 || !isCollegePage(url)) return;
    if (links.some((link) => link.url === url)) return;
    links.push({ title: title.slice(0, 160), url });
  });
  links.sort((left, right) => Number(!/lbrce\.ac\.in/i.test(left.url)) - Number(!/lbrce\.ac\.in/i.test(right.url)));
  return links.slice(0, 6);
}

function unwrapResultUrl(href: string): string | undefined {
  try {
    const absolute = new URL(href, 'https://duckduckgo.com');
    const wrapped = absolute.searchParams.get('uddg');
    return (wrapped ?? (absolute.protocol.startsWith('http') ? absolute.toString() : '')).split('#')[0];
  } catch {
    return undefined;
  }
}

function personTokens(question: string): string[] {
  if (!/\b(admission|regd|registration|roll|student|named)\b/i.test(question)) return [];
  const stop = new Set('student fetch with name from list can you the and for tell admission number person named lbrce department computer science engineering please what when where which about their there roll registration hall ticket details find give show need want this that your have has been were was are not into'.split(' '));
  return [...new Set([...question.toLowerCase().matchAll(/\b[a-z]{4,}\b/g)].map((match) => match[0]).filter((token) => !stop.has(token)))];
}

async function readPage(url: string, signal?: AbortSignal, tokens: string[] = []): Promise<WebPageEvidence | undefined> {
  try {
    const parsed = await assertPublicUrl(url, [new URL(url).hostname]);
    let current = parsed;
    let response: Response | undefined;
    for (let hop = 0; hop < 3; hop += 1) {
      response = await fetch(current, {
        headers: { 'user-agent': 'LBRCE-AI-Bot/1.0', accept: 'text/html' },
        signal: signal ?? AbortSignal.timeout(15_000),
        redirect: 'manual',
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) return undefined;
      current = await assertPublicUrl(new URL(location, current).toString(), [new URL(location, current).hostname]);
    }
    if (!response) return undefined;
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.includes('html')) return undefined;
    const html = (await response.text()).slice(0, 1_500_000);
    const $ = cheerio.load(html);
    $('script, style, noscript, svg, iframe').remove();
    const title = $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 160);
    const matched = tokens.length
      ? $('tr')
          .toArray()
          .map((row) => $(row).text().replace(/\s+/g, ' ').trim())
          .filter((line) => tokens.every((token) => line.toLowerCase().includes(token)))
          .slice(0, 6)
      : [];
    const text = matched.length ? matched.join('\n') : $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3500);
    if (text.length < 80) return undefined;
    return { title: title || current.hostname, url: current.toString(), text };
  } catch {
    return undefined;
  }
}
