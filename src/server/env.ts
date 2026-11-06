import 'server-only';
import type { NetworkId } from '@/lib/networks';

export type Mode = 'demo' | 'live';

/** Demo unless explicitly live. Demo and live never mix within a process. */
export const mode = (): Mode => (process.env.PAYGATE_MODE === 'live' ? 'live' : 'demo');

/** Mainnet moves real money, so it takes an explicit server-side opt-in. */
export const mainnetEnabled = () => process.env.PAYGATE_ENABLE_MAINNET === 'true';

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
      purpose: 'Service discovery. Public API, no key needed.',
      configured: true,
      missing: [],
    },
    check('llm', 'Claude', 'Understands requests and plans the agent run.', ['ANTHROPIC_API_KEY']),
    check('supabase', 'Supabase', 'Durable data.', ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']),
    check('session', 'Wallet sign-in', 'Signs session cookies for wallet sign-in. Required in live mode.', ['PAYGATE_SESSION_SECRET']),
    check('arc', 'Arc payments', 'USDC nanopayments through Circle Gateway.', ['AGENT_PRIVATE_KEY']),
    check('seller', 'Arc seller', 'Receives payments for the built-in cricket services.', ['PAYGATE_SELLER_ADDRESS'], true),
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
    check('cricket', 'CricketData', 'Live scores for the built-in cricket services.', ['CRICAPI_KEY'], true),
  ];
}

export function liveNetworks(): NetworkId[] {
  const networks: NetworkId[] = [];
  if (process.env.AGENT_PRIVATE_KEY) {
    networks.push('arc-testnet');
    if (mainnetEnabled()) networks.push('arc-mainnet');
  }
  if (process.env.HEDERA_AGENT_ACCOUNT_ID && process.env.HEDERA_AGENT_PRIVATE_KEY && process.env.HEDERA_FACILITATOR_URL) {
    networks.push('hedera-testnet');
    if (mainnetEnabled()) networks.push('hedera-mainnet');
  }
  return networks;
}

export const activeNetworks = (): NetworkId[] => (mode() === 'demo' ? ['demo'] : liveNetworks());
