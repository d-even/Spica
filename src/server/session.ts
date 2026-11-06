import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mode } from '@/server/env';

/**
 * Signed, expiring tokens for cookies: `<base64url payload>.<base64url HMAC>`.
 * Each token names its purpose, so a sign-in nonce can never be used as a session.
 * Stateless, so it works across serverless instances without a session table.
 */
const globals = globalThis as typeof globalThis & { paygateSessionSecret?: string };

export function sessionSecret(): string {
  const configured = process.env.PAYGATE_SESSION_SECRET;
  if (configured) {
    if (configured.length < 32) throw new Error('PAYGATE_SESSION_SECRET must be at least 32 characters.');
    return configured;
  }
  if (mode() === 'live') throw new Error('PAYGATE_SESSION_SECRET is not set.');
  // Demo only: sessions last until the server restarts.
  return (globals.paygateSessionSecret ??= randomBytes(32).toString('hex'));
}

const mac = (body: string) => createHmac('sha256', sessionSecret()).update(body).digest();

export function seal(purpose: string, payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, purpose, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  ).toString('base64url');
  return `${body}.${mac(body).toString('base64url')}`;
}

/** The payload if the token is authentic, unexpired and for this purpose. Otherwise null. */
export function unseal<T extends Record<string, unknown>>(purpose: string, token: string | undefined): T | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  const expected = mac(body);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.purpose !== purpose || typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;
    return payload as T;
  } catch {
    return null;
  }
}
