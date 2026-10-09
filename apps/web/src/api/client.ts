import type { AnswerBlock, ChatResponse } from '@lbrce/shared';

const base = import.meta.env.VITE_API_URL ?? '';
const TOKEN_KEY = 'lbrce-admin-token';

export function getAdminToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? '';
}

export function setAdminToken(token: string): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${base}${path}`, { ...init, headers, credentials: 'include' });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, body?.error?.message ?? 'Request failed', body?.error?.code);
  }
  return body as T;
}

export interface StreamHandlers {
  onStatus?: (status: string) => void;
  onToken?: (token: string) => void;
  onDone: (response: ChatResponse) => void;
}

export async function streamChat(
  payload: { message: string; sessionId: string; conversationId?: string },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = getAdminToken();
  const response = await fetch(`${base}/api/chat/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body?.error?.message ?? 'Streaming failed', body?.error?.code);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const event = frame.match(/^event: (.+)$/m)?.[1];
      const dataLine = frame.match(/^data: (.+)$/m)?.[1];
      if (!event || !dataLine) continue;
      const data = JSON.parse(dataLine);
      if (event === 'status') handlers.onStatus?.(data.status);
      if (event === 'token') handlers.onToken?.(data.token);
      if (event === 'done') handlers.onDone(data as ChatResponse);
      if (event === 'error') throw new ApiError(500, data.message ?? 'The response was interrupted');
    }
  }
}

export type { AnswerBlock, ChatResponse };
