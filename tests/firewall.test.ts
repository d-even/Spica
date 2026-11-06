import { describe, expect, it } from 'vitest';
import { usdToMicros } from '@/lib/money';
import { NETWORKS } from '@/lib/networks';
import { DEFAULT_POLICY, evaluatePolicy, type PaymentRequest, type SpendingPolicy, type SpendState } from '@/server/firewall/policy';
import { MemoryStore } from '@/server/store/memory';
import { parseTaskBudget, parseTaskNetwork } from '@/server/agent/budget';

const policy: SpendingPolicy = {
  ...DEFAULT_POLICY,
  userId: 'user',
  perRequestLimitMicros: usdToMicros('0.50'),
  dailyLimitMicros: usdToMicros('1.00'),
  monthlyLimitMicros: usdToMicros('10.00'),
  approvalThresholdMicros: usdToMicros('0.10'),
};
const noSpend: SpendState = { spentTodayMicros: 0n, spentThisMonthMicros: 0n, spentThisTaskMicros: 0n };
const request = (amount: string, extra: Partial<PaymentRequest> = {}): PaymentRequest => ({
  amountMicros: usdToMicros(amount),
  asset: NETWORKS['arc-testnet'].tokenAsset,
  network: 'arc-testnet',
  providerKey: 'catalog:acme',
  ...extra,
});
const evaluate = (req: PaymentRequest, spend = noSpend, p = policy, humanApproved = false) =>
  evaluatePolicy(p, req, spend, { mainnetEnabled: false, humanApproved });
const code = (decision: ReturnType<typeof evaluate>) => (decision.outcome === 'deny' ? decision.code : decision.outcome);

describe('policy decisions', () => {
  it('auto-approves $0.02, the brief example A', () => {
    expect(evaluate(request('0.02')).outcome).toBe('allow');
  });

  it('sends $0.15 for approval when above the threshold, and allows it below', () => {
    expect(evaluate(request('0.15')).outcome).toBe('needs_approval');
    expect(evaluate(request('0.15'), noSpend, { ...policy, approvalThresholdMicros: usdToMicros('0.20') }).outcome).toBe('allow');
  });

  it('blocks $2.00 outright, and approval cannot override it', () => {
    expect(code(evaluate(request('2.00')))).toBe('per_request_limit');
    expect(code(evaluate(request('2.00'), noSpend, policy, true))).toBe('per_request_limit');
  });

  it('enforces the budget stated for the task', () => {
    const req = request('0.06', { taskBudgetMicros: usdToMicros('0.05') });
    expect(code(evaluate(req))).toBe('task_budget');
  });

  it('counts earlier spend in the task budget', () => {
    const req = request('0.02', { taskBudgetMicros: usdToMicros('0.05') });
    expect(code(evaluate(req, { ...noSpend, spentThisTaskMicros: usdToMicros('0.04') }))).toBe('task_budget');
  });

  it('allows spending exactly up to a limit, and not a micro-dollar over', () => {
    const atLimit = { ...noSpend, spentTodayMicros: usdToMicros('0.98') };
    expect(evaluate(request('0.02'), atLimit).outcome).toBe('allow');
    expect(code(evaluate(request('0.020001'), atLimit))).toBe('daily_limit');
  });

  it('enforces the monthly limit independently', () => {
    const spend = { ...noSpend, spentThisMonthMicros: usdToMicros('9.99') };
    expect(code(evaluate(request('0.02'), spend))).toBe('monthly_limit');
  });

  it('blocks a blocklisted provider', () => {
    expect(code(evaluate(request('0.02'), noSpend, { ...policy, blockedProviders: ['catalog:acme'] }))).toBe('provider_blocked');
  });

  it('applies the allowlist only when it has entries', () => {
    expect(code(evaluate(request('0.02'), noSpend, { ...policy, allowedProviders: ['catalog:other'] }))).toBe('provider_not_allowlisted');
    expect(evaluate(request('0.02'), noSpend, { ...policy, allowedProviders: ['catalog:acme'] }).outcome).toBe('allow');
  });

  it('refuses a network the person did not allow', () => {
    expect(code(evaluate(request('0.02'), noSpend, { ...policy, allowedNetworks: ['hedera-testnet'] }))).toBe('network_not_allowed');
  });

  it('refuses mainnet unless the server enabled it, whatever the policy says', () => {
    const allowing = { ...policy, allowedNetworks: ['arc-mainnet' as const] };
    const req = request('0.02', { network: 'arc-mainnet' });
    expect(code(evaluatePolicy(allowing, req, noSpend, { mainnetEnabled: false }))).toBe('mainnet_disabled');
    expect(evaluatePolicy(allowing, req, noSpend, { mainnetEnabled: true }).outcome).toBe('allow');
  });

  it('refuses any asset other than USDC on that network', () => {
    expect(code(evaluate(request('0.02', { asset: '0x000000000000000000000000000000000000dEaD' })))).toBe('unsupported_asset');
  });

  it('does not accept a token from another network', () => {
    expect(code(evaluate(request('0.02', { asset: NETWORKS['hedera-testnet'].tokenAsset })))).toBe('unsupported_asset');
  });

  it('refuses a quote above the listed price', () => {
    expect(code(evaluate(request('0.05', { listedAmountMicros: usdToMicros('0.02') })))).toBe('price_changed');
  });

  it('refuses a provider whose verified identity points elsewhere', () => {
    expect(code(evaluate(request('0.02', { identityStatus: 'mismatch' })))).toBe('identity_mismatch');
  });

  it('refuses zero and negative amounts', () => {
    expect(code(evaluate({ ...request('0.02'), amountMicros: 0n }))).toBe('invalid_amount');
    expect(code(evaluate({ ...request('0.02'), amountMicros: -1n }))).toBe('invalid_amount');
  });

  it('needs a person for everything when automatic payments are off', () => {
    expect(evaluate(request('0.01'), noSpend, { ...policy, autoPayEnabled: false }).outcome).toBe('needs_approval');
    expect(evaluate(request('0.01'), noSpend, { ...policy, autoPayEnabled: false }, true).outcome).toBe('allow');
  });
});

describe('atomic reservations', () => {
  const reserve = (store: MemoryStore, amount: string, dedupeHash: string, extra = {}) =>
    store.reserve({
      userId: 'user',
      taskId: 'task',
      amountMicros: usdToMicros(amount),
      dailyLimitMicros: usdToMicros('1.00'),
      monthlyLimitMicros: usdToMicros('10.00'),
      dedupeHash,
      requirementHash: 'req',
      ...extra,
    });

  it('stops 50 concurrent $0.30 requests from exceeding a $1.00 budget', async () => {
    const store = new MemoryStore();
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => reserve(store, '0.30', `d${i}`)));
    expect(results.filter((result) => result.ok)).toHaveLength(3);
    expect((await store.getSpendState('user', 'task')).spentTodayMicros).toBe(usdToMicros('0.90'));
  });

  it('stops concurrent requests from exceeding a task budget', async () => {
    const store = new MemoryStore();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => reserve(store, '0.02', `d${i}`, { taskBudgetMicros: usdToMicros('0.05') })),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(2);
  });

  it('treats an identical purchase as a duplicate', async () => {
    const store = new MemoryStore();
    const results = await Promise.all([reserve(store, '0.02', 'same'), reserve(store, '0.02', 'same')]);
    expect(results.map((result) => result.ok).sort()).toEqual([false, true]);
    expect(results.find((result) => !result.ok)).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('allows the same purchase again after the window', async () => {
    const store = new MemoryStore();
    await reserve(store, '0.02', 'same', { now: new Date('2026-11-05T10:00:00Z') });
    const later = await reserve(store, '0.02', 'same', { now: new Date('2026-11-05T10:02:00Z') });
    expect(later.ok).toBe(true);
  });

  it('lets a signing gate open exactly once, and only for the bound requirement', async () => {
    const store = new MemoryStore();
    const result = await reserve(store, '0.02', 'x');
    if (!result.ok) throw new Error('expected a reservation');
    expect(await store.beginSigning(result.reservationId, 'other')).toBe(false);
    const gates = await Promise.all([store.beginSigning(result.reservationId, 'req'), store.beginSigning(result.reservationId, 'req')]);
    expect(gates.filter(Boolean)).toHaveLength(1);
  });

  it('frees a released hold', async () => {
    const store = new MemoryStore();
    const result = await reserve(store, '0.90', 'a');
    if (!result.ok) throw new Error('expected a reservation');
    await store.releaseReservation(result.reservationId);
    expect((await reserve(store, '0.90', 'b')).ok).toBe(true);
  });

  it('keeps counting a payment whose outcome is unknown', async () => {
    const store = new MemoryStore();
    const result = await reserve(store, '0.90', 'a');
    if (!result.ok) throw new Error('expected a reservation');
    await store.beginSigning(result.reservationId, 'req');
    await store.releaseReservation(result.reservationId);
    expect((await reserve(store, '0.90', 'b')).ok).toBe(false);
    await store.releaseReservation(result.reservationId, { paymentNotSent: true });
    expect((await reserve(store, '0.90', 'c')).ok).toBe(true);
  });

  it('stops counting a hold that never reached signing, but never one that did', async () => {
    const store = new MemoryStore();
    const start = new Date('2026-11-05T10:00:00Z');
    await reserve(store, '0.90', 'abandoned', { now: start });
    const signed = await reserve(store, '0.50', 'signed', { now: start, dailyLimitMicros: usdToMicros('5.00') });
    if (!signed.ok) throw new Error('expected a reservation');
    await store.beginSigning(signed.reservationId, 'req');
    const state = await store.getSpendState('user', 'task', new Date('2026-11-05T10:10:00Z'));
    expect(state.spentTodayMicros).toBe(usdToMicros('0.50'));
  });

  it('resets the daily window but not the monthly one', async () => {
    const store = new MemoryStore();
    await reserve(store, '0.90', 'a', { now: new Date('2026-11-05T23:59:00Z') });
    await store.beginSigning((await store.reserve({ userId: 'other', taskId: 't', amountMicros: 1n, dailyLimitMicros: 2n, monthlyLimitMicros: 2n, dedupeHash: 'z', requirementHash: 'r' }) as { reservationId: string }).reservationId, 'r');
    const nextDay = new Date('2026-11-06T00:01:00Z');
    expect((await store.getSpendState('user', 'task', nextDay)).spentTodayMicros).toBe(0n);
  });
});

describe('human approvals', () => {
  const create = (store: MemoryStore, expiresAt = new Date(Date.now() + 60_000).toISOString()) =>
    store.createApproval({
      userId: 'user',
      taskId: 't',
      serviceId: 's',
      serviceName: 'S',
      providerName: 'P',
      amountMicros: 1n,
      network: 'arc-testnet',
      requirementHash: 'h',
      reason: 'r',
      request: { service: {} as never },
      expiresAt,
    });

  it('can be decided only once, even when raced', async () => {
    const store = new MemoryStore();
    const { id } = await create(store);
    const results = await Promise.all([store.decideApproval('user', id, 'approved'), store.decideApproval('user', id, 'rejected')]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('cannot be decided by another user', async () => {
    const store = new MemoryStore();
    const { id } = await create(store);
    expect(await store.decideApproval('intruder', id, 'approved')).toBeNull();
  });

  it('cannot be decided after it expires', async () => {
    const store = new MemoryStore();
    const { id } = await create(store, new Date(Date.now() - 1).toISOString());
    expect(await store.decideApproval('user', id, 'approved')).toBeNull();
  });
});

describe('task budget parsing', () => {
  it.each([
    ["Find today's cricket scores. My total budget is $0.05.", '0.05'],
    ['spend up to 2 USDC on weather', '2'],
    ['I can spend $1, but no more than $0.50', '0.50'],
  ])('reads %s', (message, amount) => {
    expect(parseTaskBudget(message)).toBe(usdToMicros(amount));
  });

  it('ignores prices that are not budgets', () => {
    expect(parseTaskBudget('What is the price of a $5 coffee?')).toBeUndefined();
    expect(parseTaskBudget('Find cricket scores')).toBeUndefined();
  });

  it.each([
    ['a weather API for $0.03', '0.03'],
    ['a weather API at 0.04 usdc', '0.04'],
    ['weather API, budget 0.05', '0.05'],
    ['a weather API at a cost of $0.02', '0.02'],
  ])('reads the cost in %s', (message, amount) => {
    expect(parseTaskBudget(message)).toBe(usdToMicros(amount));
  });

  it('reads a named network, and leaves it open otherwise', () => {
    expect(parseTaskNetwork('pay on Hedera')).toBe('hedera-testnet');
    expect(parseTaskNetwork('pay on arc')).toBe('arc-testnet');
    expect(parseTaskNetwork('either arc or hedera')).toBeUndefined();
    expect(parseTaskNetwork('search for architecture news')).toBeUndefined();
  });
});
