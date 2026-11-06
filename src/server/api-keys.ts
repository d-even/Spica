import 'server-only';
import type { NetworkId } from '@/lib/networks';
import { sessionSecret } from '@/server/env';
import { readToken, signToken } from '@/server/wallet-auth';

const KEY_PREFIX = 'pg_';
const KEY_TTL_MS = 30 * 24 * 60 * 60_000;

/** What one key may do. It is signed, so a developer cannot change a budget or a service. */
export interface ApiKeyGrant {
  userId: string;
  agentId: string;
  serviceId: string;
  /** Calls share this task, so the budget stated in the chat covers them all. */
  taskId: string;
  budgetMicros?: string;
  network?: NetworkId;
}

/** Issued only after a paid purchase. Null when the server has no signing secret. */
export function issueApiKey(grant: ApiKeyGrant, now = Date.now()) {
  const secret = sessionSecret();
  return secret ? `${KEY_PREFIX}${signToken('api_key', JSON.stringify(grant), now + KEY_TTL_MS, secret)}` : null;
}

export function readApiKey(key: string, now = Date.now()): ApiKeyGrant | null {
  const secret = sessionSecret();
  if (!secret || !key.startsWith(KEY_PREFIX)) return null;
  const value = readToken('api_key', key.slice(KEY_PREFIX.length), secret, now);
  return value ? (JSON.parse(value) as ApiKeyGrant) : null;
}
