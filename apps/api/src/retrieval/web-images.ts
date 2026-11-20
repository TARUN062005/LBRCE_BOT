export interface WebPhoto {
  id: string;
  url: string;
  pageUrl?: string;
  title?: string;
}

/**
 * Public-web photographs for a college photo request.
 * These are additional to the official gallery. A failed search returns nothing
 * and does not invent image URLs.
 */
export async function publicCollegePhotos(query: string, signal?: AbortSignal): Promise<WebPhoto[]> {
  if (signal?.aborted) return [];
  const search = /\bphoto|picture|image|gallery|campus/i.test(query) ? 'Lakireddy Bali Reddy College of Engineering campus Mylavaram' : query;
  try {
    const home = await fetch('https://duckduckgo.com/', {
      headers: { 'user-agent': 'Mozilla/5.0' },
      signal,
    });
    const html = await home.text();
    const token = html.match(/vqd="([^"]+)"/)?.[1] || html.match(/vqd=([\d-]+)/)?.[1];
    if (!token) return [];
    const endpoint = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(search)}&vqd=${encodeURIComponent(token)}&f=,,,,,&p=1`;
    const response = await fetch(endpoint, { headers: { 'user-agent': 'Mozilla/5.0' }, signal });
    if (!response.ok) return [];
    const body = (await response.json()) as { results?: { image?: string; url?: string; title?: string; width?: number; height?: number }[] };
    const photos: WebPhoto[] = [];
    for (const row of body.results ?? []) {
      if (!row.image || !/^https:\/\//i.test(row.image)) continue;
      if ((row.width ?? 0) > 0 && (row.width ?? 0) < 400) continue;
      photos.push({ id: row.image, url: row.image, pageUrl: row.url, title: row.title });
      if (photos.length >= 6) break;
    }
    return photos;
  } catch {
    return [];
  }
}
