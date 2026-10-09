export interface ContentSignals {
  search?: boolean;
  aiInput?: boolean;
  aiTrain?: boolean;
}

export function parseContentSignals(robotsText: string, headerValue?: string | null): ContentSignals {
  const signals: ContentSignals = {};
  const sources = [robotsText, headerValue ?? ''];
  for (const source of sources) {
    const match = source.match(/content-signal\s*:\s*([^\n#]+)/i);
    if (!match?.[1]) continue;
    for (const part of match[1].split(',')) {
      const [key, raw] = part.split('=').map((item) => item.trim().toLowerCase());
      if (!key || (raw !== 'yes' && raw !== 'no')) continue;
      const allowed = raw === 'yes';
      if (key === 'search') signals.search = allowed;
      if (key === 'ai-input') signals.aiInput = allowed;
      if (key === 'ai-train') signals.aiTrain = allowed;
    }
  }
  return signals;
}
