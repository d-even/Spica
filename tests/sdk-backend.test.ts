import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issueAgentKey, issueApiKey, readAgentKey, readApiKey } from '@/server/api-keys';
import { budgetFor, historyFor, purchaseForAgent, type SdkPurchase } from '@/server/sdk';
import { MemoryStore } from '@/server/store/memory';
import type { SpendStore, TransactionRecord } from '@/server/store/types';

const mocks = vi.hoisted(() => ({ purchase: vi.fn(), resolveService: vi.fn() }));
vi.mock('@/server/purchase', () => ({ purchase: mocks.purchase }));
vi.mock('@/server/discovery/catalog', () => ({ resolveService: mocks.resolveService }));
vi.mock('@/server/audit/record', () => ({ auditPayment: vi.fn() }));

const USER = '00000000-0000-4000-8000-00000000000a';
const grant = { userId: USER, agentId: 'agent-1' };
const service = { id: 'svc-1', name: 'Weather', purchasable: true, listedMicros: '10000' };
const input: SdkPurchase = { serviceId: 'svc-1', idempotencyKey: 'order-1234', network: 'arc-testnet' };
const LIMITS = { dailyLimitMicros: 1_000_000n, monthlyLimitMicros: 10_000_000n };

let store: SpendStore;

const taskOf = async () => {
  await purchaseForAgent(store, grant, input);
  return mocks.purchase.mock.calls.at(-1)![0] as { taskId: string; taskBudgetMicros: bigint };
};

const transaction = (status: TransactionRecord['status'], taskId: string, overrides: Partial<TransactionRecord> = {}): Omit<TransactionRecord, 'id' | 'createdAt'> => ({
  userId: USER,
  agentId: 'agent-1',
  taskId,
  providerKey: 'paygate:1',
  providerName: 'Acme',
  serviceId: 'svc-1',
  serviceName: 'Weather',
  resource: 'https://example.com',
  amountMicros: 10_000n,
  token: '0x36',
  network: 'arc-testnet',
  reference: '0xabc',
  payer: null,
  payTo: '0xdef',
  status,
  statusDetail: null,
  ...overrides,
});

beforeEach(() => {
  vi.stubEnv('PAYGATE_SESSION_SECRET', 'a-test-secret-that-is-long-enough-for-signing');
  store = new MemoryStore();
  mocks.purchase.mockReset();
  mocks.resolveService.mockReset();
  mocks.resolveService.mockResolvedValue(service);
});

describe('agent keys', () => {
  it('round trip', () => {
    expect(readAgentKey(issueAgentKey(grant)!.key)).toEqual(grant);
  });

  it('expire after 30 days', () => {
    const issued = issueAgentKey(grant, 0)!;
    expect(readAgentKey(issued.key, 29 * 86_400_000)).toEqual(grant);
    expect(readAgentKey(issued.key, 31 * 86_400_000)).toBeNull();
  });

  it('are not accepted as service keys, or the reverse', () => {
    const agent = issueAgentKey(grant)!.key;
    const service = issueApiKey({ ...grant, serviceId: 's', taskId: 't' })!;
    expect(readApiKey(agent)).toBeNull();
    expect(readAgentKey(service)).toBeNull();
    expect(readAgentKey(`spica_${service.slice(3)}`)).toBeNull();
  });

  it('refuse tampering', () => {
    const key = issueAgentKey(grant)!.key;
    expect(readAgentKey(`${key.slice(0, -2)}xx`)).toBeNull();
  });
});

describe('one key, one payment', () => {
  /** Runs against the real reservation logic, which is what makes this hold. */
  const reserve = (taskId: string, budget: bigint, now?: Date) =>
    store.reserve({ userId: USER, taskId, amountMicros: 10_000n, taskBudgetMicros: budget, dedupeHash: crypto.randomUUID(), requirementHash: 'hash', ...LIMITS, ...(now ? { now } : {}) });

  beforeEach(() => mocks.purchase.mockResolvedValue({ outcome: 'denied', code: 'provider_blocked', reason: 'Blocked.' }));

  it('gives each key a budget of exactly one payment', async () => {
    const { taskId, taskBudgetMicros } = await taskOf();
    expect(taskBudgetMicros).toBe(10_000n);
    expect(await reserve(taskId, taskBudgetMicros)).toMatchObject({ ok: true });
    expect(await reserve(taskId, taskBudgetMicros)).toEqual({ ok: false, reason: 'task_budget' });
  });

  it('still refuses a second payment long after the first started signing', async () => {
    const { taskId, taskBudgetMicros } = await taskOf();
    const first = await reserve(taskId, taskBudgetMicros, new Date());
    await store.beginSigning((first as { reservationId: string }).reservationId, 'hash');
    expect(await reserve(taskId, taskBudgetMicros, new Date(Date.now() + 86_400_000))).toEqual({ ok: false, reason: 'task_budget' });
  });

  it('frees the key only when no payment was sent', async () => {
    const { taskId, taskBudgetMicros } = await taskOf();
    const first = await reserve(taskId, taskBudgetMicros);
    await store.releaseReservation((first as { reservationId: string }).reservationId, { paymentNotSent: true });
    expect(await reserve(taskId, taskBudgetMicros)).toMatchObject({ ok: true });
  });

  it('uses a separate task per key, and per user', async () => {
    const first = await taskOf();
    await purchaseForAgent(store, grant, { ...input, idempotencyKey: 'order-5678' });
    await purchaseForAgent(store, { ...grant, userId: '00000000-0000-4000-8000-00000000000b' }, input);
    const tasks = new Set(mocks.purchase.mock.calls.map(([context]) => context.taskId));
    expect(tasks.size).toBe(3);
    expect(tasks.has(first.taskId)).toBe(true);
  });

  it('keeps the original key out of the task id', async () => {
    expect((await taskOf()).taskId).not.toContain(input.idempotencyKey);
  });
});

describe('purchaseForAgent', () => {
  const body = async (response: Response) => [response.status, await response.json()] as const;
  const delivered = (status: TransactionRecord['status'], taskId: string) => store.insertTransaction(transaction(status, taskId));

  it.each([
    ['verified', 'settled'],
    ['settling', 'settling'],
    ['simulated', 'simulated'],
    ['unverified', 'uncertain'],
    ['failed', 'failed'],
  ] as const)('reports %s as %s', async (stored, reported) => {
    mocks.purchase.mockResolvedValue({ outcome: 'delivered', data: '{}', free: false, transaction: { ...(await delivered(stored, 'other')), id: 'tx' } });
    const [, result] = await body(await purchaseForAgent(store, grant, input));
    expect(result.status).toBe(reported);
  });

  it('calls no answer settled unless the record is verified', async () => {
    const unconfirmed = ['settling', 'unverified', 'failed', 'simulated'] as const;
    for (const status of unconfirmed) {
      mocks.purchase.mockResolvedValue({ outcome: 'delivered', data: '{}', free: false, transaction: await delivered(status, 'other') });
      const [, result] = await body(await purchaseForAgent(store, grant, { ...input, idempotencyKey: `order-${status}` }));
      expect(result.status).not.toBe('settled');
    }
  });

  it('reports a free API, with no payment', async () => {
    mocks.purchase.mockResolvedValue({ outcome: 'delivered', data: 'ok', free: true, transaction: null });
    expect(await body(await purchaseForAgent(store, grant, input))).toEqual([200, { status: 'free', serviceId: 'svc-1', data: 'ok', replayed: false }]);
  });

  it('replays an earlier payment without buying again', async () => {
    const { taskId } = await (mocks.purchase.mockResolvedValue({ outcome: 'denied', code: 'x', reason: 'x' }), taskOf());
    mocks.purchase.mockClear();
    await delivered('verified', taskId);
    const [status, result] = await body(await purchaseForAgent(store, grant, input));
    expect([status, result.status, result.replayed, result.data]).toEqual([200, 'settled', true, null]);
    expect(mocks.purchase).not.toHaveBeenCalled();
  });

  it('never buys again after a failed or unknown payment under the same key', async () => {
    for (const stored of ['failed', 'unverified'] as const) {
      const key = `order-${stored}`;
      mocks.purchase.mockResolvedValue({ outcome: 'denied', code: 'x', reason: 'x' });
      await purchaseForAgent(store, grant, { ...input, idempotencyKey: key });
      const { taskId } = mocks.purchase.mock.calls.at(-1)![0];
      mocks.purchase.mockClear();
      await delivered(stored, taskId);
      await purchaseForAgent(store, grant, { ...input, idempotencyKey: key });
      expect(mocks.purchase).not.toHaveBeenCalled();
    }
  });

  it('refuses a key reused for a different service', async () => {
    const { taskId } = await (mocks.purchase.mockResolvedValue({ outcome: 'denied', code: 'x', reason: 'x' }), taskOf());
    await delivered('verified', taskId);
    const [status, result] = await body(await purchaseForAgent(store, grant, { ...input, serviceId: 'svc-2' }));
    expect([status, result.code]).toEqual([409, 'idempotency_conflict']);
  });

  it('returns pending approval, and replays it without asking twice', async () => {
    mocks.purchase.mockImplementation(async (context) => ({
      outcome: 'needs_approval',
      approval: await store.createApproval({
        userId: USER,
        taskId: context.taskId,
        serviceId: 'svc-1',
        serviceName: 'Weather',
        providerName: 'Acme',
        amountMicros: 400_000n,
        network: 'arc-testnet',
        requirementHash: 'hash',
        reason: 'Above your approval threshold',
        request: { service: service as never },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    }));
    const [status, first] = await body(await purchaseForAgent(store, grant, input));
    expect([status, first.status, first.replayed]).toEqual([202, 'pending_approval', false]);
    const [, again] = await body(await purchaseForAgent(store, grant, input));
    expect([again.status, again.replayed, again.approvalId]).toEqual(['pending_approval', true, first.approvalId]);
    expect(mocks.purchase).toHaveBeenCalledTimes(1);
  });

  it('turns a firewall refusal into a 403 with its code', async () => {
    mocks.purchase.mockResolvedValue({ outcome: 'denied', code: 'daily_limit', reason: 'Over the daily limit.' });
    expect(await body(await purchaseForAgent(store, grant, input))).toEqual([403, { error: 'Over the daily limit.', code: 'daily_limit' }]);
  });

  it.each(['task_budget', 'duplicate'])('reports %s as a duplicate request', async (code) => {
    mocks.purchase.mockResolvedValue({ outcome: 'denied', code, reason: 'x' });
    const [status, result] = await body(await purchaseForAgent(store, grant, input));
    expect([status, result.code]).toEqual([409, 'duplicate_request']);
  });

  it('calls a failure with no record uncertain, since it cannot vouch for it', async () => {
    mocks.purchase.mockResolvedValue({ outcome: 'failed', reason: 'The connection dropped.' });
    expect((await body(await purchaseForAgent(store, grant, input)))[1].status).toBe('uncertain');
  });

  it('refuses unknown and unpayable services before any purchase', async () => {
    mocks.resolveService.mockResolvedValueOnce(null);
    expect((await purchaseForAgent(store, grant, input)).status).toBe(404);
    mocks.resolveService.mockResolvedValueOnce({ ...service, purchasable: false });
    expect((await purchaseForAgent(store, grant, input)).status).toBe(409);
    mocks.resolveService.mockResolvedValueOnce({ ...service, listedMicros: null });
    expect((await purchaseForAgent(store, grant, input)).status).toBe(409);
    expect(mocks.purchase).not.toHaveBeenCalled();
  });

  it('takes the price from the catalog, never from the caller', async () => {
    mocks.purchase.mockResolvedValue({ outcome: 'denied', code: 'x', reason: 'x' });
    await purchaseForAgent(store, grant, { ...input, price: '0', payTo: '0xevil' } as SdkPurchase);
    const [context, request] = mocks.purchase.mock.calls[0]!;
    expect(context.taskBudgetMicros).toBe(10_000n);
    expect(request.service).toBe(service);
  });
});

describe('budgetFor', () => {
  it('reports limits and what is left, never below zero', async () => {
    const budget = await budgetFor(store, grant);
    expect(budget.dailyLimit).toEqual({ usd: '1', micros: '1000000' });
    expect(budget.remainingToday).toEqual(budget.dailyLimit);
    await store.reserve({ userId: USER, taskId: 't', amountMicros: 400_000n, dedupeHash: 'd', requirementHash: 'h', ...LIMITS });
    expect((await budgetFor(store, grant)).spentToday.micros).toBe('400000');
    expect((await budgetFor(store, grant)).remainingToday.micros).toBe('600000');
  });

  it('exposes no provider lists', async () => {
    expect(Object.keys(await budgetFor(store, grant))).not.toContain('allowedProviders');
  });
});

describe('historyFor', () => {
  it('pages through payments, and shows only this user', async () => {
    for (let index = 0; index < 3; index++) await store.insertTransaction(transaction('verified', `t${index}`));
    await store.insertTransaction(transaction('verified', 'other', { userId: '00000000-0000-4000-8000-00000000000b' }));
    const first = (await historyFor(store, grant, 2, null))!;
    expect(first.items).toHaveLength(2);
    const second = (await historyFor(store, grant, 2, first.nextCursor))!;
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('shows only proof that exists', async () => {
    await store.insertTransaction(transaction('failed', 't', { reference: null }));
    expect((await historyFor(store, grant, 5, null))!.items[0]).toMatchObject({ status: 'failed', proofUrl: null, auditUrls: [] });
  });

  it('refuses a bad cursor', async () => {
    expect(await historyFor(store, grant, 5, 'bm90LWEtbnVtYmVy')).toBeNull();
  });
});
