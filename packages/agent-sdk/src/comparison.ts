import type { HttpClient } from './client.js';
import { inspect } from './discovery.js';
import { ValidationError } from './errors.js';
import type { Comparison, ComparisonRow, ServiceDetails } from './types.js';

const MAX_SERVICES = 10;

const toRow = ({ id, name, provider, price, purchasable, gatewayCompatible, reputation }: ServiceDetails): ComparisonRow => ({
  id,
  name,
  provider,
  price,
  purchasable,
  gatewayCompatible,
  reputation,
});

const micros = (row: ComparisonRow) => (row.price ? BigInt(row.price.micros) : null);

function byCost(a: ComparisonRow, b: ComparisonRow) {
  if (a.purchasable !== b.purchasable) return a.purchasable ? -1 : 1;
  const [left, right] = [micros(a), micros(b)];
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function compare(http: HttpClient, services: (string | ServiceDetails)[]): Promise<Comparison> {
  if (!Array.isArray(services) || services.length === 0) throw new ValidationError('Pass at least one service.', { code: 'invalid_services' });
  if (services.length > MAX_SERVICES) throw new ValidationError(`Compare up to ${MAX_SERVICES} services at a time.`, { code: 'invalid_services' });

  const details = await Promise.all(services.map((service) => (typeof service === 'string' ? inspect(http, service) : service)));
  const rows = details.map(toRow).sort(byCost);
  const scored = rows.filter((row) => row.reputation.score !== null).sort((a, b) => (b.reputation.score ?? 0) - (a.reputation.score ?? 0));
  const cheapest = rows.find((row) => row.purchasable && row.price);
  return { services: rows, cheapestId: cheapest?.id ?? null, highestScoredId: scored[0]?.id ?? null };
}
