const PRIVATE = /student list|roster|\bprivate\b|password|\blogin\b|registration number/i;

export interface ImageRecord {
  title?: string;
  alt?: string;
  caption?: string;
  context?: string;
  topic?: string;
  ocrText?: string;
  description?: string;
  department?: string;
  academicYear?: string;
  sourceUrl?: string;
  pageUrl?: string;
  pageNumber?: number;
  documentId?: string;
}

export function imageRecordIsPublic(record: ImageRecord): boolean {
  const blob = [record.title, record.alt, record.caption, record.context, record.topic, record.ocrText, record.description, record.sourceUrl]
    .filter(Boolean)
    .join(' ');
  return !PRIVATE.test(blob);
}

export function imageHaystack(record: ImageRecord): string {
  return [record.title, record.alt, record.caption, record.context, record.topic, record.ocrText, record.description, record.department, record.academicYear, record.sourceUrl]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function isDecorativeImageUrl(url: string | undefined): boolean {
  const lowered = (url ?? '').toLowerCase();
  return ['/logo', 'favicon', 'sprite', 'icon', 'blank.gif', 'spacer', 'header', 'banner', 'footer', 'button'].some((marker) => lowered.includes(marker));
}

export function imageTopic(url: string | undefined): string {
  const lowered = (url ?? '').toLowerCase();
  if (/lab/.test(lowered)) return 'laboratory';
  if (/sport|cricket|basketball/.test(lowered)) return 'sports';
  if (/annual|cultural|graduation|fest/.test(lowered)) return 'event';
  if (/faculty|staff/.test(lowered)) return 'faculty';
  if (/campus|building|block/.test(lowered)) return 'campus';
  return 'official';
}

export function matchingImages<T extends ImageRecord>(records: T[], query: string): T[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !['the', 'show', 'official', 'photographs', 'photos', 'image', 'images'].includes(token));
  if (!tokens.length) return [];
  return records.filter((record) => imageRecordIsPublic(record) && tokens.some((token) => imageHaystack(record).includes(token)));
}
