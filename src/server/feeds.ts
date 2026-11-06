import 'server-only';

const CACHE_LIMIT = 200;
const STALE_LIMIT_MS = 30 * 60_000;

/** Third-party APIs PayGate resells. Their keys stay here, and never reach a buyer. */
export const FEEDS = {
  'weather-live': {
    source: 'WeatherAPI.com',
    param: 'q',
    fallback: 'auto:ip',
    freshMs: 5 * 60_000,
    url: (key: string, value: string) =>
      `https://api.weatherapi.com/v1/forecast.json?${new URLSearchParams({ key, q: value, days: '3' })}`,
    read: (body: Record<string, unknown>) => (body.location && body.current ? body : null),
  },
  'news-live': {
    source: 'GNews',
    param: 'q',
    fallback: '',
    freshMs: 5 * 60_000,
    url: (key: string, value: string) =>
      value
        ? `https://gnews.io/api/v4/search?${new URLSearchParams({ apikey: key, q: value, lang: 'en', max: '10' })}`
        : `https://gnews.io/api/v4/top-headlines?${new URLSearchParams({ apikey: key, lang: 'en', max: '10' })}`,
    read: (body: Record<string, unknown>) => (Array.isArray(body.articles) ? { articles: body.articles } : null),
  },
  // Alpha Vantage answers 200 with a notice when its daily limit is reached, so
  // only a real price counts. A small free plan is also why results are kept longer.
  'finance-quote': {
    source: 'Alpha Vantage',
    param: 'symbol',
    fallback: 'IBM',
    freshMs: 15 * 60_000,
    url: (key: string, value: string) =>
      `https://www.alphavantage.co/query?${new URLSearchParams({ function: 'GLOBAL_QUOTE', symbol: value, apikey: key })}`,
    read: (body: Record<string, unknown>) => {
      const quote = body['Global Quote'] as Record<string, string> | undefined;
      return quote?.['05. price'] ? { quote } : null;
    },
  },
} as const;

export type FeedId = keyof typeof FEEDS;

const KEYS: Record<FeedId, string> = {
  'weather-live': 'WEATHERAPI_KEY',
  'news-live': 'NEWS_API_KEY',
  'finance-quote': 'ALPHA_VANTAGE_KEY',
};

export const isFeedId = (id: string): id is FeedId => id in FEEDS;
export const feedKeyName = (id: FeedId) => KEYS[id];

const cache = new Map<string, { at: number; result: unknown }>();

/** Returns null when real data is unavailable, so the seller does not charge for nothing. */
export async function loadFeed(id: FeedId, query: URLSearchParams) {
  const spec = FEEDS[id];
  const key = process.env[KEYS[id]];
  if (!key) return null;

  const value = query.get(spec.param)?.trim().slice(0, 100) || spec.fallback;
  const cacheKey = `${id}|${value.toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < spec.freshMs) return hit.result;
  const stale = hit && Date.now() - hit.at < STALE_LIMIT_MS ? hit.result : null;

  try {
    const response = await fetch(spec.url(key, value), { signal: AbortSignal.timeout(12_000), cache: 'no-store' });
    const data = response.ok ? spec.read((await response.json()) as Record<string, unknown>) : null;
    if (!data) {
      console.error(`${id} returned no data (HTTP ${response.status}).`);
      return stale;
    }
    const result = { source: spec.source, fetchedAt: new Date().toISOString(), data };
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(cacheKey, { at: Date.now(), result });
    return result;
  } catch (error) {
    // The name only: a fetch error can carry the URL, and the URL holds the key.
    console.error(`${id} failed: ${(error as Error).name}`);
    return stale;
  }
}
