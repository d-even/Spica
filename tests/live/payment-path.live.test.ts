/**
 * Runs PayGate's real signer, adapters and middleware against real Circle
 * Gateway and a real Hedera facilitator, using throwaway keys with no funds.
 * Nothing can settle, so a correct run ends in a clean refusal from the network.
 *   npx vitest run --config vitest.live.config.mts
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import { PrivateKey } from '@hiero-ledger/sdk';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { withPayment, type PaymentRequired } from 'paygate-x402';
import { NETWORKS } from '@/lib/networks';
import { ArcPaymentAdapter } from '@/server/payments/arc';
import { HederaPaymentAdapter } from '@/server/payments/hedera';
import { requirementHash, signPayment } from '@/server/signer';
import { MemoryStore } from '@/server/store/memory';

const RESOURCE = 'https://paygate.test/api/x402/cricket-live';
const resource = { url: RESOURCE, description: 'Live path check', mimeType: 'application/json' };

const reservationFor = async (store: MemoryStore, hash: string) => {
  const result = await store.reserve({
    userId: 'user',
    taskId: 'task',
    amountMicros: 20000n,
    dailyLimitMicros: 1_000_000n,
    monthlyLimitMicros: 10_000_000n,
    dedupeHash: hash,
    requirementHash: hash,
  });
  if (!result.ok) throw new Error('expected a reservation');
  return result.reservationId;
};

describe('Arc: signer to middleware to Circle Gateway', () => {
  const adapter = new ArcPaymentAdapter('arc-testnet');
  const seller = privateKeyToAccount(generatePrivateKey()).address;

  beforeAll(() => {
    process.env.AGENT_PRIVATE_KEY = generatePrivateKey();
  });

  it('signs a payment Gateway reads, then withholds data because the wallet is empty', async () => {
    const handler = vi.fn(async () => Response.json({ matches: ['paid data'] }));
    const claimed = new Set<string>();
    const route = withPayment(handler, {
      offers: [{ adapter, amountAtomic: '20000', payTo: seller }],
      replayGuard: {
        claim: async (id) => (claimed.has(id) ? false : (claimed.add(id), true)),
        release: async (id) => void claimed.delete(id),
      },
    });

    const quote = await route(new Request(RESOURCE));
    expect(quote.status).toBe(402);
    const terms = (await quote.json()) as PaymentRequired;
    expect(terms.accepts[0].extra?.name).toBe('GatewayWalletBatched');

    const store = new MemoryStore();
    const requirement = terms.accepts[0];
    const reservationId = await reservationFor(store, requirementHash(requirement, RESOURCE));
    const payload = await signPayment(store, { reservationId, paymentRequired: terms, requirement, resource: RESOURCE });

    const paid = await route(new Request(RESOURCE, { headers: { 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payload) } }));
    const body = await paid.text();

    expect(handler).toHaveBeenCalledTimes(1); // Signature verified, so the handler ran.
    expect(paid.status).toBe(402); // Settlement failed, so the buyer got nothing.
    expect(body).toContain('insufficient_balance');
    expect(body).not.toContain('paid data');
  }, 60_000);

  it('refuses to sign without a reservation', async () => {
    const requirement = await adapter.buildRequirement({ amountAtomic: '20000', payTo: seller });
    const terms = { x402Version: 2, resource, accepts: [requirement] } as PaymentRequired;
    await expect(
      signPayment(new MemoryStore(), { reservationId: 'none', paymentRequired: terms, requirement, resource: RESOURCE }),
    ).rejects.toThrow('Signing refused');
  });

  it('refuses to sign a different amount than was reserved', async () => {
    const store = new MemoryStore();
    const reserved = await adapter.buildRequirement({ amountAtomic: '20000', payTo: seller });
    const reservationId = await reservationFor(store, requirementHash(reserved, RESOURCE));
    const bigger = { ...reserved, amount: '2000000' };
    const terms = { x402Version: 2, resource, accepts: [bigger] } as PaymentRequired;
    await expect(
      signPayment(store, { reservationId, paymentRequired: terms, requirement: bigger, resource: RESOURCE }),
    ).rejects.toThrow('Signing refused');
  });
});

describe('Hedera: signer to facilitator', () => {
  const adapter = new HederaPaymentAdapter('hedera-testnet');

  beforeAll(() => {
    process.env.HEDERA_FACILITATOR_URL ??= 'https://api.testnet.blocky402.com';
    process.env.HEDERA_AGENT_ACCOUNT_ID = '0.0.7162785';
    process.env.HEDERA_AGENT_PRIVATE_KEY = PrivateKey.generateECDSA().toStringRaw();
  });

  it('builds real terms and gets a structured refusal, not a format error', async () => {
    const requirement = await adapter.buildRequirement({ amountAtomic: '20000', payTo: '0.0.7162786' });
    expect(requirement.asset).toBe(NETWORKS['hedera-testnet'].tokenAsset);
    expect(requirement.extra?.feePayer).toMatch(/^0\.0\.\d+$/);

    const store = new MemoryStore();
    const reservationId = await reservationFor(store, requirementHash(requirement, RESOURCE));
    const terms = { x402Version: 2, resource, accepts: [requirement] } as PaymentRequired;
    const payload = await signPayment(store, { reservationId, paymentRequired: terms, requirement, resource: RESOURCE });

    expect(typeof payload.payload.transaction).toBe('string');
    const verdict = await adapter.verify(payload, requirement);
    console.log('Hedera verdict:', verdict);
    expect(verdict.isValid).toBe(false); // The key does not own this account.
  }, 60_000);
});
