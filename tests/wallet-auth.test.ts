import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createChallenge, readToken, signToken, verifyChallenge, walletUserId } from '@/server/wallet-auth';

const SECRET = 'a'.repeat(32);
const domain = 'paygate.test';
const wallet = privateKeyToAccount(generatePrivateKey());
const challenge = () => createChallenge({ address: wallet.address, chainId: 5042002, domain, uri: `https://${domain}` });

describe('wallet sign-in', () => {
  it('accepts a challenge signed by the wallet it names', async () => {
    const { message, nonce } = challenge();
    const signature = await wallet.signMessage({ message });
    expect(await verifyChallenge({ message, signature, domain, nonce })).toBe(wallet.address);
  });

  it('refuses a signature from a different wallet', async () => {
    const { message, nonce } = challenge();
    const signature = await privateKeyToAccount(generatePrivateKey()).signMessage({ message });
    expect(await verifyChallenge({ message, signature, domain, nonce })).toBeNull();
  });

  it('refuses a message rewritten to name another wallet', async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const { message, nonce } = challenge();
    const signature = await wallet.signMessage({ message });
    expect(await verifyChallenge({ message: message.replace(wallet.address, other.address), signature, domain, nonce })).toBeNull();
  });

  it('refuses the wrong nonce, the wrong domain and an expired challenge', async () => {
    const { message, nonce } = challenge();
    const signature = await wallet.signMessage({ message });
    expect(await verifyChallenge({ message, signature, domain, nonce: `${nonce}0` })).toBeNull();
    expect(await verifyChallenge({ message, signature, domain: 'evil.test', nonce })).toBeNull();
    const later = new Date(Date.now() + 6 * 60_000);
    expect(await verifyChallenge({ message, signature, domain, nonce, now: later })).toBeNull();
  });

  it('refuses a malformed signature without throwing', async () => {
    const { message, nonce } = challenge();
    expect(await verifyChallenge({ message, signature: '0x1234', domain, nonce })).toBeNull();
  });

  it('builds challenges for a local development host', () => {
    const { message } = createChallenge({ address: wallet.address, chainId: 1, domain: 'localhost:3000', uri: 'http://localhost:3000' });
    expect(message).toContain('localhost:3000 wants you');
  });
});

describe('signed tokens', () => {
  const expiresAt = Date.now() + 60_000;

  it('round-trips a value until it expires', () => {
    const token = signToken('session', wallet.address, expiresAt, SECRET);
    expect(readToken('session', token, SECRET)).toBe(wallet.address);
    expect(readToken('session', token, SECRET, expiresAt)).toBeNull();
  });

  it('refuses tampering, another secret and another purpose', () => {
    const token = signToken('session', wallet.address, expiresAt, SECRET);
    const [, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ value: '0xattacker', expiresAtMs: expiresAt })).toString('base64url');
    expect(readToken('session', `${forged}.${signature}`, SECRET)).toBeNull();
    expect(readToken('session', token, 'b'.repeat(32))).toBeNull();
    expect(readToken('challenge', token, SECRET)).toBeNull();
    expect(readToken('session', 'garbage', SECRET)).toBeNull();
  });
});

describe('wallet user ids', () => {
  it('gives one stable uuid per wallet, whatever the address casing', () => {
    expect(walletUserId(wallet.address)).toBe(walletUserId(wallet.address.toLowerCase()));
    expect(walletUserId(wallet.address)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(walletUserId(wallet.address)).not.toBe(walletUserId(privateKeyToAccount(generatePrivateKey()).address));
  });
});
