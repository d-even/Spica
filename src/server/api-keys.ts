import 'server-only';
import type { NetworkId } from '@/lib/networks';
import { seal, unseal } from '@/server/session';

const KEY_PREFIX = 'pg_';
const KEY_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Its own token purpose, so a session cookie can never be used as a key, or the reverse. */
const PURPOSE = 'api_key';
const AGENT_KEY_PREFIX = 'spica_';
const AGENT_PURPOSE = 'agent_key';

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

/** What an agent key may do: buy for this agent, under its owner's limits. */
export interface AgentKeyGrant {
  userId: string;
  agentId: string;
}

/** Shown once. Signed, not stored, so it lasts its full term and cannot be cancelled early. */
export function issueAgentKey(grant: AgentKeyGrant, now = Date.now()): { key: string; expiresAt: string } | null {
  try {
    return {
      key: `${AGENT_KEY_PREFIX}${seal(AGENT_PURPOSE, { grant }, KEY_TTL_SECONDS, now)}`,
      expiresAt: new Date(now + KEY_TTL_SECONDS * 1000).toISOString(),
    };
  } catch (error) {
    console.error('Agent key not issued:', (error as Error).message);
    return null;
  }
}

export function readAgentKey(key: string, now = Date.now()): AgentKeyGrant | null {
  if (!key.startsWith(AGENT_KEY_PREFIX)) return null;
  try {
    return unseal<{ grant: AgentKeyGrant }>(AGENT_PURPOSE, key.slice(AGENT_KEY_PREFIX.length), now)?.grant ?? null;
  } catch {
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
