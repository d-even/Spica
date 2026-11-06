import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Service } from '@/components/marketplace/meta';
import { fetchQuote } from '@/components/marketplace/quote';

const service = { id: 'abc', source: 'paygate', allNetworks: [], offers: [] } as unknown as Service;

const answer = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

afterEach(() => vi.unstubAllGlobals());

describe('fetchQuote', () => {
  it('reads the terms from the 402 answer', async () => {
    answer(402, { accepts: [{ network: 'eip155:5042002', amount: '10000', payTo: '0xabc' }] });
    await expect(fetchQuote(service)).resolves.toEqual({
      status: 'ready',
      terms: [{ network: 'Arc Testnet', amountAtomic: '10000', payTo: '0xabc' }],
    });
  });

  it('never calls an answer other than 402 a quote', async () => {
    answer(200, { accepts: [{ network: 'eip155:5042002', amount: '10000', payTo: '0xabc' }] });
    await expect(fetchQuote(service)).resolves.toMatchObject({ status: 'failed' });
  });

  it('fails cleanly on an empty quote or a network error', async () => {
    answer(402, { accepts: [] });
    await expect(fetchQuote(service)).resolves.toMatchObject({ status: 'failed' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    await expect(fetchQuote(service)).resolves.toMatchObject({ status: 'failed' });
  });
});
