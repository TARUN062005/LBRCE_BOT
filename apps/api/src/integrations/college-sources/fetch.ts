import { assertPublicUrl, type ResolveHost } from '../../security/ssrf.js';

const USER_AGENT = 'LBRCE-AI-Bot/1.0 (college information assistant; respects robots.txt)';

export interface PublicResponse {
  url: string;
  status: number;
  contentType: string;
  lastModified?: string;
  body: Buffer;
  contentSignal?: string | null;
}

export async function fetchPublic(
  startUrl: string,
  allowedHosts: string[],
  options?: { maxBytes?: number; resolve?: ResolveHost; fetchImpl?: typeof fetch },
): Promise<PublicResponse> {
  const maxBytes = options?.maxBytes ?? 15 * 1024 * 1024;
  const fetchImpl = options?.fetchImpl ?? fetch;
  let current = startUrl;
  for (let hop = 0; hop < 4; hop += 1) {
    await assertPublicUrl(current, allowedHosts, options?.resolve);
    const response = await fetchImpl(current, {
      redirect: 'manual',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*;q=0.8,*/*;q=0.5',
      },
      signal: AbortSignal.timeout(60_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect missing location');
      current = new URL(location, current).toString();
      continue;
    }
    const body = await readLimited(response, maxBytes);
    return {
      url: current,
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      lastModified: response.headers.get('last-modified') ?? undefined,
      contentSignal: response.headers.get('content-signal'),
      body,
    };
  }
  throw new Error('Too many redirects');
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Response exceeds the size limit');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
