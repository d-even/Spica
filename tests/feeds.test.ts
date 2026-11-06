import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEEDS, loadFeed } from '@/server/feeds';

describe('resold API responses', () => {
  it('treats an Alpha Vantage limit notice and an unknown symbol as no data', () => {
    expect(FEEDS['finance-quote'].read({ Information: 'rate limit reached' })).toBeNull();
    expect(FEEDS['finance-quote'].read({ 'Global Quote': {} })).toBeNull();
    expect(FEEDS['finance-quote'].read({ 'Global Quote': { '05. price': '1.00' } })).not.toBeNull();
  });

  it('requires real weather and news content', () => {
    expect(FEEDS['weather-live'].read({ error: { message: 'bad location' } })).toBeNull();
    expect(FEEDS['news-live'].read({ errors: ['limit'] })).toBeNull();
    expect(FEEDS['news-live'].read({ articles: [] })).toEqual({ articles: [] });
  });
});

describe('loadFeed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('never returns the provider key, and caches by query', async () => {
    vi.stubEnv('WEATHERAPI_KEY', 'secret-weather-key');
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify({ location: { url }, current: {} })));
    vi.stubGlobal('fetch', fetcher);

    const query = new URLSearchParams({ q: 'Pune' });
    await loadFeed('weather-live', query);
    await loadFeed('weather-live', query);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('q=Pune');
  });

  it('does not charge for nothing when the key is missing or the call fails', async () => {
    expect(await loadFeed('finance-quote', new URLSearchParams())).toBeNull();
    vi.stubEnv('ALPHA_VANTAGE_KEY', 'key');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('https://x?apikey=key'); }));
    expect(await loadFeed('finance-quote', new URLSearchParams({ symbol: 'NOPE' }))).toBeNull();
  });
});
