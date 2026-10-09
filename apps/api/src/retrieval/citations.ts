import type { Citation } from '@lbrce/shared';
import type { ScoredChunk } from './rank.js';

export function citationsFromChunks(chunks: ScoredChunk[]): Citation[] {
  return chunks.map((chunk) => ({
    id: chunk.id,
    title: chunk.title,
    url: chunk.url,
    pageNumber: chunk.pageNumber,
    section: chunk.section,
    publishedAt: chunk.publishedAt,
    retrievedAt: chunk.retrievedAt,
    verificationStatus: chunk.verificationStatus,
    sourceType: chunk.sourceType,
  }));
}

export function keepKnownCitations(ids: string[], citations: Citation[]): Citation[] {
  const allowed = new Set(ids);
  return citations.filter((citation) => allowed.has(citation.id));
}

export function excerptMarkdown(chunks: ScoredChunk[]): string {
  if (!chunks.length) return '';
  const lines = chunks.slice(0, 4).map((chunk, index) => {
    const quote = chunk.text.replace(/\s+/g, ' ').trim().slice(0, 500);
    return `${index + 1}. **${chunk.title}**${chunk.pageNumber ? ` (page ${chunk.pageNumber})` : ''}\n\n> ${quote}`;
  });
  return `Retrieved excerpts are shown below. A generated summary was not produced.\n\n${lines.join('\n\n')}`;
}
