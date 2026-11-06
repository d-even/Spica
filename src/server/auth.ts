import 'server-only';
import { cookies } from 'next/headers';
import { mode, sessionSecret, supabaseConfig } from '@/server/env';
import { readToken, signToken, walletUserId } from '@/server/wallet-auth';

export const SESSION_COOKIE = 'paygate_session';
export const CHALLENGE_COOKIE = 'paygate_challenge';
export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001';

const SESSION_TTL_MS = 12 * 60 * 60_000;

export interface SessionUser {
  id: string;
  /** Null only for the shared demo user. */
  wallet: string | null;
  demo: boolean;
}

/** Without Supabase there are no per-user accounts: see currentUser. */
export const signInSecret = () => (supabaseConfig() ? sessionSecret() : null);

/**
 * The identity of every request comes from here, never from the request body.
 * With Supabase configured a real session is required. Without it, demo mode
 * uses one shared demo user, and live mode refuses (see getStore).
 */
export async function currentUser(): Promise<SessionUser | null> {
  if (!supabaseConfig()) {
    return mode() === 'demo' ? { id: DEMO_USER_ID, wallet: null, demo: true } : null;
  }
  const secret = sessionSecret();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!secret || !token) return null;
  const wallet = readToken('session', token, secret);
  return wallet ? { id: walletUserId(wallet), wallet, demo: false } : null;
}

async function setSignedCookie(name: string, value: string, expiresAtMs: number) {
  (await cookies()).set(name, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor((expiresAtMs - Date.now()) / 1000),
  });
}

export async function setSession(wallet: string, secret: string) {
  const expiresAtMs = Date.now() + SESSION_TTL_MS;
  await setSignedCookie(SESSION_COOKIE, signToken('session', wallet, expiresAtMs, secret), expiresAtMs);
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Ties a challenge to the browser that asked for it. */
export async function setChallengeNonce(nonce: string, expiresAt: Date, secret: string) {
  const expiresAtMs = expiresAt.getTime();
  await setSignedCookie(CHALLENGE_COOKIE, signToken('challenge', nonce, expiresAtMs, secret), expiresAtMs);
}

/** Single use: the nonce is gone after one attempt, pass or fail. */
export async function takeChallengeNonce(secret: string) {
  const store = await cookies();
  const token = store.get(CHALLENGE_COOKIE)?.value;
  store.delete(CHALLENGE_COOKIE);
  return token ? readToken('challenge', token, secret) : null;
}
