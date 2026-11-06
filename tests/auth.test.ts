import { afterEach, describe, expect, it, vi } from 'vitest';
import { walletUserId } from '@/server/auth';
import { seal, unseal } from '@/server/session';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const SECRET = 'a'.repeat(64);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('session tokens', () => {
  it('round-trips a payload for the same purpose', () => {
    vi.stubEnv('PAYGATE_SESSION_SECRET', SECRET);
    const token = seal('session', { sub: 'u1' }, 60);
    expect(unseal('session', token)).toMatchObject({ sub: 'u1', purpose: 'session' });
  });

  it('refuses a token sealed for another purpose', () => {
    vi.stubEnv('PAYGATE_SESSION_SECRET', SECRET);
    const nonce = seal('siwe-nonce', { nonce: 'abc' }, 60);
    expect(unseal('session', nonce)).toBeNull();
  });

  it('refuses a tampered payload', () => {
    vi.stubEnv('PAYGATE_SESSION_SECRET', SECRET);
    const [, signature] = seal('session', { sub: 'u1' }, 60).split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', purpose: 'session', exp: 9_999_999_999 })).toString('base64url');
    expect(unseal('session', `${forged}.${signature}`)).toBeNull();
  });

  it('refuses a token signed with another secret', () => {
    vi.stubEnv('PAYGATE_SESSION_SECRET', SECRET);
    const token = seal('session', { sub: 'u1' }, 60);
    vi.stubEnv('PAYGATE_SESSION_SECRET', 'b'.repeat(64));
    expect(unseal('session', token)).toBeNull();
  });

  it('refuses an expired token', () => {
    vi.stubEnv('PAYGATE_SESSION_SECRET', SECRET);
    vi.useFakeTimers();
    const token = seal('session', { sub: 'u1' }, 60);
    vi.advanceTimersByTime(61_000);
    expect(unseal('session', token)).toBeNull();
  });

  it('refuses malformed tokens', () => {
    vi.stubEnv('PAYGATE_SESSION_SECRET', SECRET);
    for (const token of [undefined, '', 'abc', 'a.b.c', '.', 'e30.']) expect(unseal('session', token)).toBeNull();
  });

  it('requires a long secret, and a secret at all in live mode', () => {
    vi.stubEnv('PAYGATE_SESSION_SECRET', 'short');
    expect(() => seal('session', {}, 60)).toThrow(/at least 32/);
    vi.stubEnv('PAYGATE_SESSION_SECRET', '');
    vi.stubEnv('PAYGATE_MODE', 'live');
    expect(() => seal('session', {}, 60)).toThrow(/not set/);
  });
});

describe('wallet user IDs', () => {
  const address = '0x52908400098527886E0F7030069857D2E4169EE7';

  it('is a UUID, so existing uuid columns accept it', () => {
    expect(walletUserId('evm', address)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('ignores address case', () => {
    expect(walletUserId('evm', address)).toBe(walletUserId('evm', address.toLowerCase()));
  });

  it('differs between wallets', () => {
    expect(walletUserId('evm', address)).not.toBe(walletUserId('evm', '0x8617E340B3D01FA5F11F306F4090FD50E238070D'));
  });
});
