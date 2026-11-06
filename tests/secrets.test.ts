import { beforeAll, describe, expect, it } from 'vitest';
import { applyCredential, hashSecret, openSecret, sealSecret } from '@/server/secrets';
import { auditProof, settlementProof } from '@/lib/proof';
import { hashscanTransaction } from '@/lib/networks';

describe('provider API keys', () => {
  beforeAll(() => {
    process.env.PAYGATE_ENCRYPTION_KEY = 'ab'.repeat(32);
  });

  it('encrypts so only this server can read the key', () => {
    const sealed = sealSecret('provider-key');
    expect(sealed).not.toContain('provider-key');
    expect(sealSecret('provider-key')).not.toBe(sealed);
    expect(openSecret(sealed)).toBe('provider-key');
  });

  it('refuses a stored key that was changed', () => {
    const parts = sealSecret('provider-key').split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => openSecret(parts.join('.'))).toThrow();
  });

  it('hashes one way, the same every time', () => {
    expect(hashSecret('provider-key')).toBe(hashSecret('provider-key'));
    expect(hashSecret('provider-key')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret('provider-key')).not.toBe(hashSecret('other-key'));
  });

  it('puts the key where the provider asked', () => {
    const sealedKey = sealSecret('secret');
    const bearer: Record<string, string> = {};
    applyCredential(new URL('https://api.test/x'), bearer, { sealedKey, placement: 'bearer', name: null });
    expect(bearer.authorization).toBe('Bearer secret');

    const header: Record<string, string> = {};
    applyCredential(new URL('https://api.test/x'), header, { sealedKey, placement: 'header', name: 'x-api-key' });
    expect(header['x-api-key']).toBe('secret');
  });

  it('never lets a buyer replace the key in a query parameter', () => {
    const url = new URL('https://api.test/x?apikey=buyer-value');
    applyCredential(url, {}, { sealedKey: sealSecret('secret'), placement: 'query', name: 'apikey' });
    expect(url.searchParams.getAll('apikey')).toEqual(['secret']);
  });
});

describe('payment proof links', () => {
  it('links an Arc payment only once it is final', () => {
    const hash = `0x${'a'.repeat(64)}`;
    expect(settlementProof({ network: 'arc-testnet', status: 'verified', reference: hash })?.url).toBe(`https://explorer.testnet.arc.io/tx/${hash}`);
    expect(settlementProof({ network: 'arc-testnet', status: 'settling', reference: 'gateway-id' })).toBeNull();
    expect(settlementProof({ network: 'demo', status: 'verified', reference: 'simulated_1' })).toBeNull();
  });

  it('formats HashScan links the way HashScan opens them', () => {
    expect(hashscanTransaction('0.0.11332446@1793976335.345765493')).toBe('https://hashscan.io/testnet/transaction/0.0.11332446-1793976335-345765493');
    expect(settlementProof({ network: 'hedera-testnet', status: 'verified', reference: '0.0.1@2.3' })?.url).toBe('https://hashscan.io/testnet/transaction/0.0.1-2-3');
    expect(auditProof('verified', '26', '0.0.1@2.3').label).toContain('#26');
  });
});
