const TTL_MS = 3 * 60 * 1000;
const stored = new Map<string, { at: number; markdown: string }>();

export function evidenceKey(chunks: { id: string; text: string }[]): string {
  return chunks.map((chunk) => `${chunk.id}:${chunk.text.slice(0, 80)}`).join('|');
}

export function cachedNarrative(question: string, key: string, now = Date.now()): string | undefined {
  const hit = stored.get(cacheKey(question, key));
  if (!hit || now - hit.at > TTL_MS) return undefined;
  return hit.markdown;
}

export function storeNarrative(question: string, key: string, markdown: string, now = Date.now()): void {
  if (!markdown.trim() || /could not be verified/i.test(markdown)) return;
  stored.set(cacheKey(question, key), { at: now, markdown });
}

export function clearNarrativeCache(): void {
  stored.clear();
}

function cacheKey(question: string, key: string): string {
  return `${question.trim().toLowerCase()}::${key}`;
}
