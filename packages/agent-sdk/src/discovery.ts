import type { HttpClient } from './client.js';
import { ValidationError } from './errors.js';
import type { DiscoverOptions, Price, Service, ServiceDetails } from './types.js';

interface Listing {
  id: string;
  name: string;
  description: string;
  category: string;
  provider: string;
  priceUsd: string | null;
  accepts: Service['accepts'];
}

const MICROS_PER_USD = 1_000_000;

/** Exact, with no float arithmetic: the dollar string is shifted six places. */
function usdToMicros(usd: string) {
  const [whole = '0', fraction = ''] = usd.split('.');
  return (BigInt(whole) * BigInt(MICROS_PER_USD) + BigInt(fraction.padEnd(6, '0').slice(0, 6))).toString();
}

export function microsToPrice(micros: string): Price {
  const value = BigInt(micros);
  const whole = value / BigInt(MICROS_PER_USD);
  const fraction = (value % BigInt(MICROS_PER_USD)).toString().padStart(6, '0').replace(/0+$/, '');
  return { usd: fraction ? `${whole}.${fraction}` : whole.toString(), micros };
}

const toService = (listing: Listing): Service => ({
  id: listing.id,
  name: listing.name,
  description: listing.description,
  category: listing.category,
  provider: listing.provider,
  price: listing.priceUsd === null ? null : { usd: listing.priceUsd, micros: usdToMicros(listing.priceUsd) },
  accepts: listing.accepts,
});

export function requireServiceId(serviceId: string) {
  if (typeof serviceId !== 'string' || !serviceId.trim()) throw new ValidationError('serviceId is required.', { code: 'invalid_service_id' });
  return encodeURIComponent(serviceId);
}

export async function discover(http: HttpClient, options: DiscoverOptions): Promise<Service[]> {
  const { query, category, maxPrice, limit } = options;
  if (maxPrice !== undefined && !/^\d+(\.\d{1,6})?$/.test(maxPrice)) {
    throw new ValidationError('maxPrice must be a dollar amount such as "0.05".', { code: 'invalid_max_price' });
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
    throw new ValidationError('limit must be a whole number from 1 to 50.', { code: 'invalid_limit' });
  }

  const search = new URLSearchParams({ network: http.network });
  if (query) search.set('query', query);
  if (category) search.set('category', category);
  if (maxPrice) search.set('maxUsdPrice', maxPrice);
  if (limit) search.set('limit', String(limit));
  const { items } = await http.json<{ items: Listing[] }>('GET', `/api/discover?${search}`);
  return items.map(toService);
}

export async function inspect(http: HttpClient, serviceId: string): Promise<ServiceDetails> {
  return http.json<ServiceDetails>('GET', `/api/sdk/v1/services/${requireServiceId(serviceId)}`);
}
