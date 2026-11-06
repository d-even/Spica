import 'server-only';
import type { NetworkId } from '@/lib/networks';
import { seal, unseal } from '@/server/session';

const KEY_PREFIX = 'pg_';
const KEY_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Its own token purpose, so a session cookie can never be used as a key, or the reverse. */
const PURPOSE = 'api_key';

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

/**
 * Issued only after a paid purchase. Signed with PAYGATE_SESSION_SECRET, like
 * sessions. Null when the server has no signing secret (live mode without one).
 */
export function issueApiKey(grant: ApiKeyGrant, now = Date.now()): string | null {
  try {
    return `${KEY_PREFIX}${seal(PURPOSE, { grant }, KEY_TTL_SECONDS, now)}`;
  } catch (error) {
    console.error('API key not issued:', (error as Error).message);
    return null;
  }
}

export function readApiKey(key: string, now = Date.now()): ApiKeyGrant | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  try {
    return unseal<{ grant: ApiKeyGrant }>(PURPOSE, key.slice(KEY_PREFIX.length), now)?.grant ?? null;
  } catch {
    return null;
  }
}
