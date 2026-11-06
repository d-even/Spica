import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { describe, expect, it, vi } from 'vitest';
import {
  proofId,
  requirementsMatch,
  withPayment,
  type PaymentPayload,
  type PaymentRequirements,
  type ReplayGuard,
  type SellerAdapter,
} from 'paygate-x402';
import { toMirrorTransactionId } from '@/server/payments/hedera';
import { computeReputation, MIN_OBSERVATIONS } from '@/server/reputation';
import { isPrivateAddress } from '@/server/http/guard';
import { parsePaymentRequired, payableNetworks, selectRequirement } from '@/server/purchase';
import { decodeUsageCode, defaultUsageCode, developerApiCode, encodeUsageCode, isValidUsageCode } from '@/lib/usage-code';
import { formatUsd, microsToUsd, usdToMicros } from '@/lib/money';
import type { Observation } from '@/server/store/types';

const URL_ = 'https://seller.test/api/data';

const requirement: PaymentRequirements = {
  scheme: 'exact',
  network: 'eip155:5042002',
  asset: '0x3600000000000000000000000000000000000000',
  amount: '20000',
  payTo: '0x1111111111111111111111111111111111111111',
  maxTimeoutSeconds: 604900,
  extra: {},
};

function adapter(overrides: Partial<SellerAdapter> = {}): SellerAdapter {
  return {
    network: requirement.network,
    buildRequirement: async ({ amountAtomic, payTo }) => ({ ...requirement, amount: amountAtomic, payTo }),
    verify: async () => ({ isValid: true, payer: '0xbuyer' }),
    settle: async () => ({ success: true, transaction: 'transfer-1', network: 'eip155:5042002', payer: '0xbuyer' }),
    ...overrides,
  };
}

function replayGuard(): ReplayGuard {
  const claimed = new Set<string>();
  return {
    claim: async (id) => (claimed.has(id) ? false : (claimed.add(id), true)),
    release: async (id) => void claimed.delete(id),
  };
}

const proof = (accepted: PaymentRequirements = requirement, signature = '0xsigned'): string =>
  encodePaymentSignatureHeader({
    x402Version: 2,
    resource: { url: URL_, description: 'x', mimeType: 'application/json' },
    accepted,
    payload: { signature },
  } as PaymentPayload);

const data = () => vi.fn(async () => Response.json({ secret: 'paid data' }));

function protect(handler = data(), sellerAdapter = adapter(), guard = replayGuard()) {
  return {
    handler,
    route: withPayment(handler, {
      offers: [{ adapter: sellerAdapter, amountAtomic: requirement.amount, payTo: requirement.payTo }],
      replayGuard: guard,
    }),
  };
}

const call = (route: (r: Request) => Promise<Response>, header?: string) =>
  route(new Request(URL_, { headers: header ? { 'PAYMENT-SIGNATURE': header } : {} }));

describe('x402 middleware', () => {
  it('answers an unpaid request with 402 and readable terms, and no data', async () => {
    const { route, handler } = protect();
    const response = await call(route);
    expect(response.status).toBe(402);
    expect(handler).not.toHaveBeenCalled();
    const terms = decodePaymentRequiredHeader(response.headers.get('PAYMENT-REQUIRED')!);
    expect(terms.x402Version).toBe(2);
    expect(terms.accepts[0].amount).toBe('20000');
  });

  it('delivers data and a settlement receipt for a valid payment', async () => {
    const { route } = protect();
    const response = await call(route, proof());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ secret: 'paid data' });
    expect(response.headers.get('PAYMENT-RESPONSE')).toBeTruthy();
  });

  it('rejects a garbage proof', async () => {
    const { route, handler } = protect();
    expect((await call(route, 'not-base64-json')).status).toBe(402);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects a proof the facilitator says is invalid', async () => {
    const settle = vi.fn();
    const { route, handler } = protect(data(), adapter({ verify: async () => ({ isValid: false, invalidReason: 'invalid_signature' }), settle }));
    const response = await call(route, proof());
    expect(response.status).toBe(402);
    expect((await response.json()).error).toBe('invalid_signature');
    expect(handler).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it.each([
    ['a lower amount', { amount: '1' }],
    ['a different recipient', { payTo: '0x2222222222222222222222222222222222222222' }],
    ['a different token', { asset: '0x000000000000000000000000000000000000dEaD' }],
    ['another network', { network: 'hedera:testnet' as const }],
  ])('rejects a proof signed for %s', async (_name, change) => {
    const { route, handler } = protect();
    const response = await call(route, proof({ ...requirement, ...change }));
    expect(response.status).toBe(402);
    expect((await response.json()).error).toBe('requirement_mismatch');
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses to replay a settled proof', async () => {
    const { route, handler } = protect();
    expect((await call(route, proof())).status).toBe(200);
    const replay = await call(route, proof());
    expect(replay.status).toBe(402);
    expect((await replay.json()).error).toBe('duplicate_payment');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('settles a proof once when it is raced', async () => {
    const settle = vi.fn(adapter().settle);
    const { route } = protect(data(), adapter({ settle }));
    const statuses = (await Promise.all(Array.from({ length: 10 }, () => call(route, proof())))).map((r) => r.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it('does not charge when the handler fails, and allows a retry', async () => {
    const settle = vi.fn(adapter().settle);
    const handler = vi.fn(async () => new Response('down', { status: 503 }));
    handler.mockResolvedValueOnce(new Response('down', { status: 503 }));
    handler.mockResolvedValueOnce(Response.json({ ok: true }));
    const { route } = protect(handler, adapter({ settle }));
    expect((await call(route, proof())).status).toBe(503);
    expect(settle).not.toHaveBeenCalled();
    expect((await call(route, proof())).status).toBe(200);
  });

  it('withholds data when settlement fails', async () => {
    const { route } = protect(
      data(),
      adapter({ settle: async () => ({ success: false, errorReason: 'insufficient_balance', transaction: '', network: 'eip155:5042002' }) }),
    );
    const response = await call(route, proof());
    expect(response.status).toBe(402);
    expect(JSON.stringify(await response.json())).not.toContain('paid data');
  });

  it('treats differently signed payments as different proofs', async () => {
    const decode = (signature: string) => ({ payload: { signature } }) as unknown as PaymentPayload;
    expect(await proofId(decode('a'))).not.toBe(await proofId(decode('b')));
    expect(await proofId(decode('a'))).toBe(await proofId(decode('a')));
  });

  it('compares addresses without regard to case', () => {
    expect(requirementsMatch(requirement, { ...requirement, payTo: requirement.payTo.toUpperCase().replace('0X', '0x') })).toBe(true);
  });
});

describe('buyer quote handling', () => {
  const terms = {
    x402Version: 2,
    resource: { url: URL_, description: '', mimeType: '' },
    accepts: [
      { ...requirement, network: 'hedera:testnet' as const, amount: '10000' },
      { ...requirement, amount: '30000' },
      { ...requirement, network: 'eip155:8453' as const, amount: '1' },
    ],
  };

  it('chooses the cheapest offer on an enabled network', () => {
    expect(selectRequirement(terms as never, ['arc-testnet', 'hedera-testnet'])?.network).toBe('hedera-testnet');
    expect(selectRequirement(terms as never, ['arc-testnet'])?.requirement.amount).toBe('30000');
  });

  it('honours the networks a person allows when choosing an offer', () => {
    const networks = payableNetworks(['arc-testnet', 'hedera-testnet'], ['arc-testnet']);
    expect(networks).toEqual(['arc-testnet']);
    expect(selectRequirement(terms as never, networks)?.network).toBe('arc-testnet');
    expect(payableNetworks(['demo'], [])).toEqual(['demo']);
  });

  it('ignores a cheap offer on a network that is not enabled', () => {
    expect(selectRequirement(terms as never, ['demo'])).toBeNull();
  });

  it('refuses x402 v1 terms and unreadable bodies', () => {
    expect(parsePaymentRequired(new Headers(), JSON.stringify({ x402Version: 1, accepts: [] }))).toBeNull();
    expect(parsePaymentRequired(new Headers(), '<html>')).toBeNull();
  });
});

describe('hedera references', () => {
  it('converts a transaction ID for the mirror node', () => {
    expect(toMirrorTransactionId('0.0.1235@1700000000.000000000')).toBe('0.0.1235-1700000000-000000000');
  });
});

describe('reputation', () => {
  const observation = (over: Partial<Observation> = {}): Observation => ({
    serviceKey: 's',
    reachable: true,
    succeeded: true,
    paid: true,
    latencyMs: 400,
    quotedMicros: 20000n,
    createdAt: '',
    ...over,
  });

  it('says not enough data rather than inventing a score', () => {
    const result = computeReputation(Array.from({ length: MIN_OBSERVATIONS - 1 }, () => observation()));
    expect(result.status).toBe('not_enough_data');
    expect(result.score).toBeNull();
    expect(computeReputation([]).score).toBeNull();
  });

  it('scores a flawless record at 100', () => {
    expect(computeReputation(Array.from({ length: 10 }, () => observation())).score).toBe(100);
  });

  it('marks failures down and shows the measured breakdown', () => {
    const result = computeReputation([
      ...Array.from({ length: 5 }, () => observation()),
      ...Array.from({ length: 5 }, () => observation({ reachable: false, succeeded: false })),
    ]);
    expect(result.score).toBeLessThan(100);
    expect(result.components.find((item) => item.key === 'uptime')?.score).toBe(50);
  });

  it('excludes a measure with no data instead of scoring it zero', () => {
    const result = computeReputation(Array.from({ length: 6 }, () => observation({ paid: false, quotedMicros: null })));
    expect(result.components.find((item) => item.key === 'payments')?.score).toBeNull();
    expect(result.score).toBe(100);
  });
});

describe('private address guard', () => {
  it.each(['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '::1', '::ffff:10.0.0.1', 'fd00::1', 'fe80::1'])(
    'blocks %s',
    (address) => expect(isPrivateAddress(address)).toBe(true),
  );
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('allows %s', (address) => expect(isPrivateAddress(address)).toBe(false));
});

describe('money', () => {
  it('round-trips without floating point error', () => {
    expect(usdToMicros('0.1') + usdToMicros('0.2')).toBe(usdToMicros('0.3'));
    expect(microsToUsd(20000n)).toBe('0.02');
    expect(formatUsd(2000000n)).toBe('$2.00');
    expect(formatUsd(500n)).toBe('$0.0005');
  });
  it('rejects malformed amounts', () => {
    expect(() => usdToMicros('abc')).toThrow();
    expect(() => usdToMicros('-1')).toThrow();
  });
});

describe('usage code', () => {
  it('survives the paid response header, including non-ASCII text', () => {
    const code = 'const a = 1;\nconsole.log("héllo");\nrun(a);';
    expect(decodeUsageCode(encodeUsageCode(code))).toBe(code);
  });

  it('refuses more than three lines and empty headers', () => {
    expect(isValidUsageCode('1\n2\n3')).toBe(true);
    expect(isValidUsageCode('1\n2\n3\n4')).toBe(false);
    expect(decodeUsageCode(Buffer.from('1\n2\n3\n4').toString('base64'))).toBeNull();
    expect(decodeUsageCode(null)).toBeNull();
  });

  it('generates three valid lines when a provider set none', () => {
    const code = defaultUsageCode('https://paygate.test/api/x402/abc');
    expect(code.split('\n')).toHaveLength(3);
    expect(isValidUsageCode(code)).toBe(true);
    expect(code).toContain('https://paygate.test/api/x402/abc');
  });
});

describe('developer code', () => {
  it('is three runnable lines carrying the URL and key', () => {
    const code = developerApiCode('https://paygate.test/api/v1/abc', 'pg_key');
    expect(code.split('\n')).toHaveLength(3);
    expect(code).toContain('https://paygate.test/api/v1/abc');
    expect(code).toContain('Bearer pg_key');
  });
});

