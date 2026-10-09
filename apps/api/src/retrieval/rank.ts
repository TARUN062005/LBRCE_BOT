export interface ScoredChunk {
  id: string;
  title: string;
  text: string;
  url?: string;
  pageNumber?: number;
  section?: string;
  verificationStatus: 'verified' | 'unverified' | 'rejected' | 'unknown';
  publishedAt?: string;
  retrievedAt?: string;
  documentType?: string;
  lexicalScore: number;
  semanticScore: number;
  sourceType: 'webpage' | 'document';
  allowAiInput?: boolean;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < a.length; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    dot += av * bv;
    left += av * av;
    right += bv * bv;
  }
  if (!left || !right) return 0;
  return dot / (Math.sqrt(left) * Math.sqrt(right));
}

export function rankChunks(chunks: ScoredChunk[], limit = 6): ScoredChunk[] {
  const maxLexical = Math.max(0, ...chunks.map((chunk) => chunk.lexicalScore));
  return chunks
    .filter((chunk) => chunk.verificationStatus !== 'rejected')
    .map((chunk) => ({
      chunk,
      score:
        0.55 * chunk.semanticScore +
        0.35 * (maxLexical ? chunk.lexicalScore / maxLexical : 0) +
        (chunk.verificationStatus === 'verified' ? 0.15 : 0) +
        recencyBoost(chunk.publishedAt) +
        contentAdjustment(chunk.text),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.chunk);
}

function contentAdjustment(text: string): number {
  const value = text.toLowerCase();
  let score = 0;
  if (/all rights reserved|designed\s*&?\s*developed|web team/.test(value)) score -= 0.4;
  if (/call us:|webmail|fee payment|home administration/.test(value)) score -= 0.2;
  const words = value.split(/\s+/).filter((word) => word.length > 3);
  if (words.length > 40) score += 0.08;
  return score;
}

function recencyBoost(publishedAt?: string): number {
  if (!publishedAt) return 0;
  const time = Date.parse(publishedAt);
  if (Number.isNaN(time)) return 0;
  const ageDays = (Date.now() - time) / 86_400_000;
  if (ageDays < 0) return 0.05;
  if (ageDays < 120) return 0.08;
  if (ageDays < 365) return 0.04;
  return 0;
}

export function mergeChunkHits(groups: ScoredChunk[][]): ScoredChunk[] {
  const byId = new Map<string, ScoredChunk>();
  for (const group of groups) {
    for (const chunk of group) {
      const existing = byId.get(chunk.id);
      if (!existing) {
        byId.set(chunk.id, { ...chunk });
        continue;
      }
      existing.lexicalScore = Math.max(existing.lexicalScore, chunk.lexicalScore);
      existing.semanticScore = Math.max(existing.semanticScore, chunk.semanticScore);
    }
  }
  return [...byId.values()];
}
