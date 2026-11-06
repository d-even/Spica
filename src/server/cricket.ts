import 'server-only';
import { z } from 'zod';
import { mode } from '@/server/env';

const CRICKET_URL = 'https://api.cricapi.com/v1/currentMatches';

const feed = z.object({
  status: z.string(),
  data: z
    .array(
      z.object({
        name: z.string(),
        matchType: z.string().optional(),
        status: z.string().optional(),
        venue: z.string().optional(),
        date: z.string().optional(),
        score: z.array(z.object({ r: z.number(), w: z.number(), o: z.number(), inning: z.string() })).optional(),
      }),
    )
    .optional(),
});

/** CricketData allows 100 calls a day, and a slow response must not fail a sale. */
const FRESH_MS = 60_000;
const STALE_LIMIT_MS = 30 * 60_000;
let lastFeed: { at: number; feed: CricketFeed } | undefined;

export interface CricketFeed {
  source: string;
  sample: boolean;
  fetchedAt: string;
  matches: unknown[];
}

/** Returns null when real data is unavailable, so the seller does not charge for nothing. */
export async function loadCricketFeed(): Promise<CricketFeed | null> {
  const apiKey = process.env.CRICAPI_KEY;
  if (apiKey) {
    if (lastFeed && Date.now() - lastFeed.at < FRESH_MS) return lastFeed.feed;
    const stale = lastFeed && Date.now() - lastFeed.at < STALE_LIMIT_MS ? lastFeed.feed : null;
    const url = new URL(CRICKET_URL);
    url.searchParams.set('apikey', apiKey);
    url.searchParams.set('offset', '0');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000), cache: 'no-store' });
      const parsed = feed.parse(await response.json());
      if (parsed.status !== 'success' || !parsed.data) return stale;
      const loaded = { source: 'CricketData.org', sample: false, fetchedAt: new Date().toISOString(), matches: parsed.data };
      lastFeed = { at: Date.now(), feed: loaded };
      return loaded;
    } catch (error) {
      console.error('Cricket feed failed:', (error as Error).message);
      return stale;
    }
  }
  if (mode() === 'live') return null;
  return {
    source: 'PayGate sample data',
    sample: true,
    fetchedAt: new Date().toISOString(),
    matches: [
      {
        name: 'Sample Team A vs Sample Team B',
        status: 'Sample data, not a real match. Set CRICAPI_KEY for live scores.',
        score: [{ r: 142, w: 3, o: 18.2, inning: 'Sample Team A Inning 1' }],
      },
    ],
  };
}
