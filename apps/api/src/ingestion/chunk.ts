export interface TextChunk {
  text: string;
  index: number;
  pageNumber?: number;
  heading?: string;
}

export function chunkText(input: string, pageNumber?: number, size = 1100, overlap = 150): TextChunk[] {
  const cleaned = input.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned) return [];
  const sections = cleaned.split(/\n(?=#{1,3}\s|(?:[A-Z][A-Za-z0-9 &/-]{3,80})\n)/);
  const chunks: TextChunk[] = [];
  let heading: string | undefined;
  for (const section of sections) {
    const headingMatch = section.match(/^(?:#{1,3}\s*)?(.{3,80})\n/);
    if (headingMatch && section.startsWith(headingMatch[0]) && !/[.!?]$/.test(headingMatch[1] ?? '')) {
      heading = headingMatch[1]?.trim();
    }
    let cursor = 0;
    while (cursor < section.length) {
      const slice = section.slice(cursor, cursor + size).trim();
      if (slice.length > 40) {
        chunks.push({ text: slice, index: chunks.length, pageNumber, heading });
      }
      if (cursor + size >= section.length) break;
      cursor += size - overlap;
    }
  }
  return chunks;
}
