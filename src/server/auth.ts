import 'server-only';
import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { mode } from '@/server/env';
import { seal, unseal } from '@/server/session';

export const SESSION_COOKIE = 'paygate_session';
const NONCE_COOKIE = 'paygate_siwe_nonce';
export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001';

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** How long a sign-in nonce, and the message signed with it, stay usable. */
export const NONCE_TTL_SECONDS = 10 * 60;

/** Networks a person can sign in with. Hedera testnet comes next. */
export type WalletChain = 'arc-testnet';

export interface SessionUser {
  id: string;
  /** The signed-in wallet. Null for the shared demo user and older email sessions. */
  address: string | null;
  chain: WalletChain | null;
  demo: boolean;
}

/**
 * A stable user ID for a wallet, shaped as a UUID so the existing uuid columns
 * need no migration. Keyed on the address family, so one EVM address is one
 * user whichever EVM chain it signed in on.
 */
export function walletUserId(family: 'evm', address: string): string {
  const hex = createHash('sha256').update(`paygate:${family}:${address.toLowerCase()}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
});

/**
 * The identity of every request comes from here, never from the request body.
 * A signed-in wallet wins. Otherwise demo mode uses one shared demo user, and
 * live mode requires signing in.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  let session: { sub: string; addr: string | null; chain: WalletChain | null } | null = null;
  try {
    session = unseal('session', token);
  } catch (error) {
    console.error('Session check failed:', (error as Error).message);
  }
  if (session) return { id: session.sub, address: session.addr, chain: session.chain, demo: false };
  return mode() === 'demo' ? { id: DEMO_USER_ID, address: null, chain: null, demo: true } : null;
}

export async function startSession(user: { id: string; address: string; chain: WalletChain }) {
  const token = seal('session', { sub: user.id, addr: user.address, chain: user.chain }, SESSION_TTL_SECONDS);
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_SECONDS));
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Remembers the nonce this browser must sign, in a signed short-lived cookie. */
export async function issueNonce(nonce: string) {
  (await cookies()).set(NONCE_COOKIE, seal('siwe-nonce', { nonce }, NONCE_TTL_SECONDS), cookieOptions(NONCE_TTL_SECONDS));
}

/** Returns the pending nonce and deletes it, so each one can be used once. */
export async function takeNonce(): Promise<string | null> {
  const store = await cookies();
  const payload = unseal<{ nonce: string }>('siwe-nonce', store.get(NONCE_COOKIE)?.value);
  store.delete(NONCE_COOKIE);
  return payload?.nonce ?? null;
}
