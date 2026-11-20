import * as cheerio from 'cheerio';
import { fetchPublic } from '../integrations/college-sources/fetch.js';
import { isDecorativeImageUrl } from './images.js';

const INDEX = 'https://www.lbrce.ac.in/gallery_pages/galleryindex.php';

export interface GalleryPhoto {
  id: string;
  url: string;
  pageUrl: string;
  title?: string;
  alt?: string;
}

/** Photographs linked from the official gallery, not homepage banners. */
export async function officialGalleryPhotos(signal?: AbortSignal): Promise<GalleryPhoto[]> {
  if (signal?.aborted) return [];
  const index = await fetchPublic(INDEX, ['lbrce.ac.in']);
  const pageUrl = index.url || INDEX;
  const $ = cheerio.load(index.body.toString('utf8'));
  const photos = collect($, pageUrl);
  const albums = new Set<string>();
  $('a[href]').each((_, anchor) => {
    const href = $(anchor).attr('href') ?? '';
    if (!/gallery/i.test(href) || !/\.php(?:$|\?)/i.test(href)) return;
    try {
      const url = new URL(href, pageUrl).toString();
      if (url !== pageUrl) albums.add(url);
    } catch {
      return;
    }
  });
  for (const album of [...albums].slice(0, 2)) {
    if (signal?.aborted || photos.length >= 8) break;
    try {
      const response = await fetchPublic(album, ['lbrce.ac.in']);
      photos.push(...collect(cheerio.load(response.body.toString('utf8')), response.url || album));
    } catch {
      continue;
    }
  }
  const unique = new Map<string, GalleryPhoto>();
  for (const photo of photos) {
    if (!unique.has(photo.url)) unique.set(photo.url, photo);
  }
  return [...unique.values()].slice(0, 8);
}

function collect($: cheerio.CheerioAPI, pageUrl: string): GalleryPhoto[] {
  const photos: GalleryPhoto[] = [];
  $('img').each((_, image) => {
    const src = $(image).attr('data-src') || $(image).attr('data-original') || $(image).attr('src') || '';
    if (!src || src.startsWith('data:')) return;
    let url: string;
    try {
      url = new URL(src, pageUrl).toString();
    } catch {
      return;
    }
    if (!/^https:\/\/(?:www\.)?lbrce\.ac\.in\//i.test(url)) return;
    if (isDecorativeImageUrl(url) || /slider|banner|brightcone/i.test(url)) return;
    if (!/\.(?:jpe?g|png|webp)(?:$|\?)/i.test(url)) return;
    photos.push({ id: url, url, pageUrl, alt: ($(image).attr('alt') || '').trim() || undefined });
  });
  return photos;
}
