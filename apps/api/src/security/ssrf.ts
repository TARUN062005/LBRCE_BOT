import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal']);

export function isPrivateAddress(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === '::1' || normalized === '0.0.0.0' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80')) return true;
  if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice('::ffff:'.length));

  const parts = normalized.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true;
  return false;
}

export function hostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return allowedHosts.some((allowed) => {
    const rule = allowed.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
    return host === rule || host.endsWith(`.${rule}`);
  });
}

export type ResolveHost = (hostname: string) => Promise<{ address: string }[]>;

const defaultResolve: ResolveHost = async (hostname) => lookup(hostname, { all: true });

export async function assertPublicUrl(
  raw: string,
  allowedHosts: string[],
  resolve: ResolveHost = defaultResolve,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP(S) URLs are allowed');
  }
  if (url.username || url.password) throw new Error('URLs with credentials are blocked');

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Blocked host');
  }
  if (!hostAllowed(host, allowedHosts)) throw new Error('Host is not on the allowlist');

  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Private IP addresses are blocked');
    return url;
  }

  const records = await resolve(host);
  if (!records.length) throw new Error('Host did not resolve');
  for (const record of records) {
    if (isPrivateAddress(record.address)) throw new Error('Host resolves to a private address');
  }
  return url;
}
