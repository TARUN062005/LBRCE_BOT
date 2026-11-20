import type { EvidenceItem } from '../agent/policy.js';
import { readEnvFileValue } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface PythonAgentResult {
  answer: string;
  evidence: EvidenceItem[];
  activity: string[];
  status: 'answered' | 'refused' | 'failed';
  intent: string;
  attempts: { step: string; ok: boolean; detail: string }[];
}

export function pythonAgentEnabled(): boolean {
  return process.env.NODE_ENV !== 'test' && process.env.PYTHON_AGENT !== 'off';
}

export async function askPythonAgent(input: {
  message: string;
  conversationId: string;
  history: { role: string; content: string }[];
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  onToken?: (token: string) => void;
}): Promise<PythonAgentResult | null> {
  if (!pythonAgentEnabled()) return null;
  const base = (process.env.AGENT_BASE_URL || 'http://127.0.0.1:4100').replace(/\/$/, '');
  const token = agentToken();
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  const abort = () => controller.abort();
  input.signal?.addEventListener('abort', abort);
  try {
    const response = await fetch(`${base}/api/agent/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-token': token },
      body: JSON.stringify({
        conversationId: input.conversationId,
        message: input.message,
        session: { scope: 'lbrce' },
        history: input.history,
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return null;
    let result: PythonAgentResult | null = null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const read = await reader.read();
      if (read.done) break;
      buffer += decoder.decode(read.value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const event = frame.match(/^event: (.+)$/m)?.[1];
        const dataLine = frame.match(/^data: (.+)$/m)?.[1];
        if (!event || !dataLine) continue;
        const data = JSON.parse(dataLine) as Record<string, unknown>;
        if (event === 'status' && typeof data.status === 'string') input.onStatus?.(data.status);
        if (event === 'token' && typeof data.token === 'string') input.onToken?.(data.token);
        if (event === 'result') result = normalize(data);
        if (event === 'error') return null;
      }
    }
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'agent unavailable';
    logger.warn({ err: detail.slice(0, 180) }, 'python agent unavailable');
    return null;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abort);
  }
}

function agentToken(): string {
  const configured = readEnvFileValue('AGENT_INTERNAL_TOKEN') || process.env.AGENT_INTERNAL_TOKEN || '';
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') return '';
  return 'local-dev';
}

function normalize(data: Record<string, unknown>): PythonAgentResult | null {
  if (typeof data.answer !== 'string' || (data.status !== 'answered' && data.status !== 'refused')) return null;
  const evidence = Array.isArray(data.evidence) ? data.evidence.flatMap(asEvidence) : [];
  const attempts = Array.isArray(data.attempts)
    ? data.attempts.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        return [{ step: String(row.step ?? ''), ok: Boolean(row.ok), detail: String(row.detail ?? '') }];
      })
    : [];
  return {
    answer: data.answer,
    evidence,
    activity: Array.isArray(data.activity) ? data.activity.map(String) : [],
    status: data.status,
    intent: typeof data.intent === 'string' ? data.intent : 'general',
    attempts,
  };
}

function asEvidence(value: unknown): EvidenceItem[] {
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  const sourceUrl = typeof row.sourceUrl === 'string' ? row.sourceUrl : '';
  const extractedText = typeof row.extractedText === 'string' ? row.extractedText : '';
  if (!sourceUrl || !extractedText) return [];
  const sourceType = row.sourceType === 'pdf' || row.sourceType === 'image' || row.sourceType === 'screenshot' ? row.sourceType : 'webpage';
  const verificationStatus = row.verificationStatus === 'verified' || row.verificationStatus === 'partial' ? row.verificationStatus : 'unverified';
  return [
    {
      sourceUrl,
      sourceType,
      documentTitle: typeof row.documentTitle === 'string' ? row.documentTitle : undefined,
      pageNumber: typeof row.pageNumber === 'number' ? row.pageNumber : undefined,
      pageUrl: typeof row.pageUrl === 'string' ? row.pageUrl : undefined,
      extractedText,
      capturedAt: typeof row.capturedAt === 'string' ? row.capturedAt : new Date().toISOString(),
      verificationStatus,
    },
  ];
}
