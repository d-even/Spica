import type { Observation } from '@/server/store/types';

export const MIN_OBSERVATIONS = 5;

export interface ReputationComponent {
  key: 'uptime' | 'success' | 'payments' | 'latency' | 'pricing';
  label: string;
  /** 0 to 100, or null when this measure has no data yet. */
  score: number | null;
  weight: number;
  detail: string;
}

export interface Reputation {
  status: 'not_enough_data' | 'scored';
  score: number | null;
  sampleSize: number;
  components: ReputationComponent[];
}

const percent = (part: number, whole: number) => Math.round((part / whole) * 100);

/** 100 at 500 ms or faster, 0 at 5 s or slower, linear in between. */
export function latencyScore(averageMs: number) {
  return Math.round(Math.min(100, Math.max(0, ((5000 - averageMs) / 4500) * 100)));
}

/**
 * Derives a score from SPICA's own measurements only. There is no self-reported
 * input and no default: below MIN_OBSERVATIONS the result is "not enough data".
 * Measures without data are excluded, and the remaining weights rescale.
 */
export function computeReputation(observations: Observation[]): Reputation {
  const total = observations.length;
  const attempts = observations.filter((item) => item.reachable);
  const paid = observations.filter((item) => item.paid);
  const paidOk = paid.filter((item) => item.succeeded);
  const quotes = observations.flatMap((item) => (item.quotedMicros === null ? [] : [item.quotedMicros.toString()]));

  const counts = new Map<string, number>();
  for (const quote of quotes) counts.set(quote, (counts.get(quote) ?? 0) + 1);
  const commonestQuote = Math.max(0, ...counts.values());
  const averageLatency = attempts.length ? attempts.reduce((sum, item) => sum + item.latencyMs, 0) / attempts.length : 0;

  const components: ReputationComponent[] = [
    {
      key: 'uptime',
      label: 'Uptime',
      score: total ? percent(attempts.length, total) : null,
      weight: 0.25,
      detail: `${attempts.length} of ${total} calls reached the service`,
    },
    {
      key: 'success',
      label: 'Successful requests',
      score: attempts.length ? percent(attempts.filter((item) => item.succeeded).length, attempts.length) : null,
      weight: 0.3,
      detail: `${attempts.filter((item) => item.succeeded).length} of ${attempts.length} requests succeeded`,
    },
    {
      key: 'payments',
      label: 'Payment history',
      score: paid.length ? percent(paidOk.length, paid.length) : null,
      weight: 0.2,
      detail: `${paidOk.length} of ${paid.length} paid calls delivered data`,
    },
    {
      key: 'latency',
      label: 'Response time',
      score: attempts.length ? latencyScore(averageLatency) : null,
      weight: 0.15,
      detail: attempts.length ? `${Math.round(averageLatency)} ms on average` : 'No responses measured',
    },
    {
      key: 'pricing',
      label: 'Pricing consistency',
      score: quotes.length ? percent(commonestQuote, quotes.length) : null,
      weight: 0.1,
      detail: `${counts.size} distinct price${counts.size === 1 ? '' : 's'} across ${quotes.length} quotes`,
    },
  ];

  if (total < MIN_OBSERVATIONS) return { status: 'not_enough_data', score: null, sampleSize: total, components };

  const scored = components.filter((component) => component.score !== null);
  const weight = scored.reduce((sum, component) => sum + component.weight, 0);
  const score = Math.round(scored.reduce((sum, component) => sum + component.score! * component.weight, 0) / weight);
  return { status: 'scored', score, sampleSize: total, components };
}
