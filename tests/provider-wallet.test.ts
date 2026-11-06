import { afterEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { isAgentWallet } from '@/server/env';

const key = `0x${'11'.repeat(32)}`;
const agent = privateKeyToAccount(key as `0x${string}`).address;

afterEach(() => vi.unstubAllEnvs());

describe('isAgentWallet', () => {
  it('spots the agent wallet in any letter case, with or without the key prefix', () => {
    vi.stubEnv('AGENT_PRIVATE_KEY', key);
    expect(isAgentWallet(agent)).toBe(true);
    expect(isAgentWallet(agent.toLowerCase())).toBe(true);
    vi.stubEnv('AGENT_PRIVATE_KEY', key.slice(2));
    expect(isAgentWallet(agent)).toBe(true);
  });

  it('spots the agent Hedera account', () => {
    vi.stubEnv('HEDERA_AGENT_ACCOUNT_ID', '0.0.777');
    expect(isAgentWallet('0.0.777')).toBe(true);
    expect(isAgentWallet('0.0.778')).toBe(false);
  });

  it('allows any other wallet, and stays quiet with no agent key', () => {
    vi.stubEnv('AGENT_PRIVATE_KEY', key);
    expect(isAgentWallet('0x000000000000000000000000000000000000dEaD')).toBe(false);
    vi.stubEnv('AGENT_PRIVATE_KEY', '');
    expect(isAgentWallet(agent)).toBe(false);
  });
});
