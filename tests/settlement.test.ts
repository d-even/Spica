import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshTransaction, refreshTransactions } from '@/server/settlement';
import { MemoryStore } from '@/server/store/memory';
import type { TransactionRecord } from '@/server/store/types';

const confirm = vi.fn();
vi.mock('@/server/payments/registry', () => ({ getAdapter: () => ({ confirm }) }));

const sample = {
  userId: 'user',
  agentId: 'agent',
  taskId: 'task',
  providerKey: 'provider',
  providerName: 'Provider',
  serviceId: 'service',
  serviceName: 'Service',
  resource: 'https://paygate.test/x',
  amountMicros: 20000n,
  token: 'USDC',
  network: 'arc-testnet',
  reference: 'gateway-id',
  payer: '0xbuyer',
  payTo: '0xseller',
  status: 'settling',
  statusDetail: 'Batch settlement pending',
} satisfies Omit<TransactionRecord, 'id' | 'createdAt'>;

const verified = { status: 'verified', reference: '0xhash', payer: '0xbuyer', detail: 'Settled onchain by Circle Gateway.' };
const stillSettling = { status: 'settling', reference: 'gateway-id', payer: '0xbuyer', detail: 'Batch settlement pending' };

describe('settling payments', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
    confirm.mockReset();
  });

  it('marks a completed payment verified and saves the onchain reference', async () => {
    const transaction = await store.insertTransaction(sample);
    confirm.mockResolvedValue(verified);
    const [result] = await refreshTransactions(store, [transaction]);
    expect(result.status).toBe('verified');
    expect((await store.getTransaction('user', transaction.id))?.reference).toBe('0xhash');
  });

  it('leaves a payment settling while the batch is pending, and when a lookup fails', async () => {
    const pending = await store.insertTransaction(sample);
    confirm.mockResolvedValue(stillSettling);
    expect((await refreshTransactions(store, [pending]))[0].status).toBe('settling');

    const unreachable = await store.insertTransaction(sample);
    confirm.mockRejectedValue(new Error('network down'));
    expect((await refreshTransaction(store, unreachable)).status).toBe('settling');
  });

  it('never re-checks a finished payment', async () => {
    const done = await store.insertTransaction({ ...sample, status: 'verified' });
    await refreshTransactions(store, [done]);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks Circle about one payment at most every 15 seconds', async () => {
    const transaction = await store.insertTransaction(sample);
    confirm.mockResolvedValue(stillSettling);
    const start = Date.now();
    await refreshTransaction(store, transaction, start);
    await refreshTransaction(store, transaction, start + 5_000);
    expect(confirm).toHaveBeenCalledTimes(1);
    await refreshTransaction(store, transaction, start + 16_000);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('caps one page load and keeps every row', async () => {
    const rows = await Promise.all(Array.from({ length: 12 }, () => store.insertTransaction(sample)));
    confirm.mockResolvedValue(verified);
    const result = await refreshTransactions(store, rows);
    expect(confirm).toHaveBeenCalledTimes(8);
    expect(result).toHaveLength(12);
    expect(result.filter((row) => row.status === 'verified')).toHaveLength(8);
  });
});

describe('SupabaseStore.updateTransactionStatus', () => {
  it('writes the same columns as a new transaction', async () => {
    const written: Record<string, unknown>[] = [];
    const single = async () => ({ data: { id: 'id', amount_micros: 1, status: 'verified' }, error: null });
    const chain = { update: (row: Record<string, unknown>) => (written.push(row), chain), eq: () => chain, select: () => chain, single };
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => chain }) }));
    const { SupabaseStore } = await import('@/server/store/supabase');

    await new SupabaseStore('https://db.test', 'key').updateTransactionStatus('id', { status: 'verified', statusDetail: 'done', reference: '0xhash', payer: '0xbuyer' });
    expect(written[0]).toEqual({ status: 'verified', status_detail: 'done', tx_hash: '0xhash', from_address: '0xbuyer', verified: true });
  });
});
