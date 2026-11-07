import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { publicUrl } from '@/server/env';

const MAX_RESPONSE_BYTES = 1_000_000;
const TIMEOUT_MS = 20_000;

export function isPrivateAddress(address: string) {
  if (address === '::1' || address === '::' || /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address)) return true;
  const mapped = address.replace(/^::ffff:/i, '');
  if (isIP(mapped) !== 4) return false;
  const [a, b] = mapped.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/**
 * Catalog URLs are third-party input, so they must not reach internal hosts.
 * SPICA's own origin is the one exception, because built-in services live there.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.origin === new URL(publicUrl()).origin) return url;
  if (url.protocol !== 'https:') throw new Error('Only https services can be called.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
  if (addresses.some(isPrivateAddress)) throw new Error('This service resolves to a private address.');
  return url;
}

export interface FetchedResponse {
  status: number;
  headers: Headers;
  text: string;
}

/** Fetch for untrusted endpoints: no redirects, a timeout and a size cap. */
export async function safeFetch(url: URL, init: RequestInit): Promise<FetchedResponse> {
  const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('The service response is too large.');
    }
    chunks.push(value);
  }
  return { status: response.status, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') };
}
