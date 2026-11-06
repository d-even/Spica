import 'server-only';
import { privateKeyToAccount } from 'viem/accounts';
import type { NetworkId } from '@/lib/networks';

export type Mode = 'demo' | 'live';

/** Demo unless explicitly live. Demo and live never mix within a process. */
export const mode = (): Mode => (process.env.PAYGATE_MODE === 'live' ? 'live' : 'demo');

/** The Circle Agent Marketplace feed. Off, so the marketplace holds only what providers list here. */
export const circleCatalogEnabled = () => process.env.PAYGATE_CIRCLE_CATALOG === 'true';

/**
 * Which model plans agent runs. AGENT_PROVIDER picks one explicitly; otherwise
 * whichever key is set is used (Gemini first, then Claude), else the demo planner.
 */
export function agentProvider(): 'gemini' | 'claude' | 'demo' {
  const wanted = process.env.AGENT_PROVIDER?.toLowerCase();
  if (wanted === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
  if (wanted === 'claude' && process.env.ANTHROPIC_API_KEY) return 'claude';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  return 'demo';
}

export const publicUrl = () => (process.env.PAYGATE_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export const supabaseConfig = () => {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
};

export interface Integration {
  id: string;
  label: string;
  purpose: string;
  configured: boolean;
  missing: string[];
  optional?: boolean;
}

const check = (id: string, label: string, purpose: string, names: string[], optional = false): Integration => {
  const missing = names.filter((name) => !process.env[name]);
  return { id, label, purpose, configured: missing.length === 0, missing, optional };
};

/** Names only. Values never leave the server. */
export function integrations(): Integration[] {
  return [
    {
      id: 'discovery',
      label: 'Circle Agent Marketplace',
      purpose: 'Optional catalog of third-party APIs. Off by default.',
      configured: circleCatalogEnabled(),
      missing: circleCatalogEnabled() ? [] : ['PAYGATE_CIRCLE_CATALOG'],
      optional: true,
    },
    {
      id: 'llm',
      label: agentProvider() === 'claude' ? 'Claude' : 'Gemini',
      purpose: 'Understands requests and plans the agent run. Set GEMINI_API_KEY or ANTHROPIC_API_KEY.',
      configured: agentProvider() !== 'demo',
      missing: agentProvider() === 'demo' ? ['GEMINI_API_KEY'] : [],
    },
    check('supabase', 'Supabase', 'Durable data.', ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']),
    check('session', 'Wallet sign-in', 'Signs session cookies for wallet sign-in. Required in live mode.', ['PAYGATE_SESSION_SECRET']),
    check('arc', 'Arc payments', 'USDC nanopayments through Circle Gateway.', ['AGENT_PRIVATE_KEY']),
    check(
      'hedera',
      'Hedera payments',
      'USDC payments through an x402 facilitator.',
      ['HEDERA_AGENT_ACCOUNT_ID', 'HEDERA_AGENT_PRIVATE_KEY', 'HEDERA_FACILITATOR_URL'],
      true,
    ),
    check(
      'hcs',
      'Hedera Consensus Service',
      'Tamper-evident audit trail.',
      ['HEDERA_OPERATOR_ID', 'HEDERA_OPERATOR_KEY', 'HEDERA_HCS_TOPIC_ID'],
      true,
    ),
  ];
}

/** The wallet the agent pays from. Circle refuses a payment to the wallet it comes from. */
export function isAgentWallet(address: string) {
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key) return false;
  return privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`).address.toLowerCase() === address.toLowerCase();
}

export function liveNetworks(): NetworkId[] {
  const networks: NetworkId[] = [];
  if (process.env.AGENT_PRIVATE_KEY) {
    networks.push('arc-testnet');
  }
  if (process.env.HEDERA_AGENT_ACCOUNT_ID && process.env.HEDERA_AGENT_PRIVATE_KEY && process.env.HEDERA_FACILITATOR_URL) {
    networks.push('hedera-testnet');
  }
  return networks;
}

export const activeNetworks = (): NetworkId[] => (mode() === 'demo' ? ['demo'] : liveNetworks());
