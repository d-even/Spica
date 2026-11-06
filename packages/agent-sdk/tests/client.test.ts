import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError, ConnectionError, NotFoundError, PolicyDeniedError, RateLimitError, SPICA, ServerError, SpicaError, ValidationError } from '../src/index.js';
import type { ServiceDetails } from '../src/index.js';
import { MockBackend } from './mock-backend.js';

const KEY = 'spica_test_key';
const backend = new MockBackend();
let spica: SPICA;

const listing = {
  id: 'svc-1',
  name: 'Weather',
  description: 'Forecasts',
  category: 'WEATHER',
  provider: 'Acme',
  priceUsd: '0.01',
  accepts: [{ network: 'eip155:5042002', asset: '0x36', amount: '10000', payTo: '0xabc' }],
};

const details = (id: string, usd: string, micros: string, score: number | null, purchasable = true): ServiceDetails => ({
  id,
  name: id,
  description: '',
  category: 'DATA',
  provider: 'Acme',
  providerKey: 'paygate:1',
  price: { usd, micros },
  accepts: [],
  purchasable,
  gatewayCompatible: true,
  reputation: { status: score === null ? 'not_enough_data' : 'scored', score, sampleSize: score === null ? 0 : 12 },
});

beforeEach(async () => {
  await backend.start();
  backend.requests.length = 0;
  spica = new SPICA({ apiKey: KEY, baseUrl: backend.url });
});
afterEach(async () => {
  await backend.stop();
  vi.unstubAllEnvs();
});

describe('new SPICA', () => {
  it('reads its settings from the environment', async () => {
    vi.stubEnv('SPICA_API_KEY', 'spica_from_env');
    vi.stubEnv('SPICA_BASE_URL', backend.url);
    backend.respond('GET /api/sdk/v1/budget', 200, {});
    await new SPICA().getBudget();
    expect(backend.requests[0]?.authorization).toBe('Bearer spica_from_env');
  });

  it('needs a server address', () => {
    vi.stubEnv('SPICA_BASE_URL', '');
    expect(() => new SPICA({ apiKey: KEY })).toThrow(ValidationError);
  });

  it('refuses plain http off this machine, which would expose the key', () => {
    expect(() => new SPICA({ apiKey: KEY, baseUrl: 'http://api.example.com' })).toThrow(/https/);
    expect(() => new SPICA({ apiKey: KEY, baseUrl: 'https://api.example.com' })).not.toThrow();
    expect(() => new SPICA({ apiKey: KEY, baseUrl: 'http://localhost:3000' })).not.toThrow();
  });

  it('refuses any network but Arc Testnet', () => {
    expect(() => new SPICA({ apiKey: KEY, baseUrl: backend.url, network: 'base' as never })).toThrow(ValidationError);
  });

  it('keeps the API key out of errors', async () => {
    const offline = new SPICA({ apiKey: KEY, baseUrl: 'http://127.0.0.1:1' });
    const error = await offline.getBudget().catch((cause: Error) => cause);
    expect(error).toBeInstanceOf(ConnectionError);
    expect(String((error as Error).message)).not.toContain(KEY);
  });
});

describe('discover', () => {
  it('returns typed services and sends the filters', async () => {
    backend.respond('GET /api/discover', 200, { items: [listing] });
    const [service] = await spica.discover({ query: 'weather', category: 'WEATHER', maxPrice: '0.05', limit: 5 });
    expect(service).toMatchObject({ id: 'svc-1', provider: 'Acme', price: { usd: '0.01', micros: '10000' } });
    const url = new URL(backend.requests[0]!.path, backend.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ network: 'arc-testnet', query: 'weather', category: 'WEATHER', maxUsdPrice: '0.05', limit: '5' });
  });

  it('is public, so it sends no key', async () => {
    backend.respond('GET /api/discover', 200, { items: [] });
    await spica.discover();
    expect(backend.requests[0]?.authorization).toBeUndefined();
  });

  it('keeps an unpriced listing as null, not zero', async () => {
    backend.respond('GET /api/discover', 200, { items: [{ ...listing, priceUsd: null }] });
    expect((await spica.discover())[0]?.price).toBeNull();
  });

  it('rejects bad filters before calling the server', async () => {
    await expect(spica.discover({ maxPrice: 'cheap' })).rejects.toBeInstanceOf(ValidationError);
    await expect(spica.discover({ limit: 51 })).rejects.toBeInstanceOf(ValidationError);
    expect(backend.requests).toHaveLength(0);
  });
});

describe('inspect', () => {
  it('returns the service with its reputation', async () => {
    backend.respond('GET /api/sdk/v1/services/svc-1', 200, details('svc-1', '0.01', '10000', 91));
    expect((await spica.inspect('svc-1')).reputation.score).toBe(91);
  });

  it('throws NotFoundError for an unknown service', async () => {
    await expect(spica.inspect('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a blank id as a failed promise, so .catch() sees it', async () => {
    await expect(spica.inspect(' ')).rejects.toBeInstanceOf(ValidationError);
  });

  it('encodes the id, so it cannot reach another route', async () => {
    await spica.inspect('../budget').catch(() => {});
    expect(backend.requests[0]?.path).toBe('/api/sdk/v1/services/..%2Fbudget');
  });
});

describe('compare', () => {
  it('orders by cost and names the cheapest and the best measured', async () => {
    const result = await spica.compare([details('dear', '0.05', '50000', 95), details('cheap', '0.01', '10000', null), details('mid', '0.02', '20000', 70)]);
    expect(result.services.map((row) => row.id)).toEqual(['cheap', 'mid', 'dear']);
    expect(result).toMatchObject({ cheapestId: 'cheap', highestScoredId: 'dear' });
  });

  it('never names a service that cannot be paid as cheapest', async () => {
    const result = await spica.compare([details('free-but-blocked', '0.001', '1000', null, false), details('ok', '0.02', '20000', null)]);
    expect(result.cheapestId).toBe('ok');
    expect(result.services[0]?.id).toBe('ok');
  });

  it('compares exact amounts, not floats', async () => {
    const result = await spica.compare([details('b', '0.000002', '2', null), details('a', '0.000001', '1', null)]);
    expect(result.cheapestId).toBe('a');
  });

  it('looks up services passed by id, and pays nothing', async () => {
    backend.respond('GET /api/sdk/v1/services/one', 200, details('one', '0.01', '10000', null));
    expect((await spica.compare(['one'])).cheapestId).toBe('one');
    expect(backend.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('invents no score when nothing has enough data', async () => {
    expect((await spica.compare([details('a', '0.01', '10000', null)])).highestScoredId).toBeNull();
  });

  it('rejects an empty or oversized list', async () => {
    await expect(spica.compare([])).rejects.toBeInstanceOf(ValidationError);
    await expect(spica.compare(Array.from({ length: 11 }, () => 'x'))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('quote', () => {
  const terms = { x402Version: 2, accepts: [{ network: 'hedera:testnet', amount: '5000', asset: '0.0.1', payTo: '0.0.2' }, { network: 'eip155:5042002', amount: '10000', asset: '0x36', payTo: '0xabc', maxTimeoutSeconds: 604900 }] };

  it("reads the seller's 402 and picks the configured network", async () => {
    backend.respond('GET /api/x402/svc-1', 402, terms);
    expect(await spica.quote({ serviceId: 'svc-1' })).toEqual({
      serviceId: 'svc-1',
      network: 'arc-testnet',
      price: { usd: '0.01', micros: '10000' },
      asset: '0x36',
      payTo: '0xabc',
      maxTimeoutSeconds: 604900,
    });
  });

  it('sends no key and no payment', async () => {
    backend.respond('GET /api/x402/svc-1', 402, terms);
    await spica.quote({ serviceId: 'svc-1' });
    expect(backend.requests).toHaveLength(1);
    expect(backend.requests[0]).toMatchObject({ method: 'GET', authorization: undefined });
  });

  it('refuses a service with no terms on this network', async () => {
    backend.respond('GET /api/x402/svc-1', 402, { accepts: [terms.accepts[0]] });
    await expect(spica.quote({ serviceId: 'svc-1' })).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it('does not call an ordinary answer a quote', async () => {
    backend.respond('GET /api/x402/svc-1', 200, {});
    await expect(spica.quote({ serviceId: 'svc-1' })).rejects.toMatchObject({ code: 'no_quote' });
  });

  it('throws NotFoundError for an unknown service', async () => {
    await expect(spica.quote({ serviceId: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('getBudget', () => {
  it('sends the key and returns the limits', async () => {
    backend.respond('GET /api/sdk/v1/budget', 200, { autoPayEnabled: true, remainingToday: { usd: '0.9', micros: '900000' } });
    expect((await spica.getBudget()).remainingToday.usd).toBe('0.9');
    expect(backend.requests[0]?.authorization).toBe(`Bearer ${KEY}`);
  });

  it('needs a key', async () => {
    vi.stubEnv('SPICA_API_KEY', '');
    await expect(new SPICA({ baseUrl: backend.url }).getBudget()).rejects.toBeInstanceOf(AuthenticationError);
    expect(backend.requests).toHaveLength(0);
  });

  it('offers no way to change a limit', () => {
    const methods = Object.getOwnPropertyNames(SPICA.prototype);
    expect(methods.sort()).toEqual(['compare', 'constructor', 'discover', 'getBudget', 'history', 'inspect', 'purchase', 'quote']);
  });
});

describe('history', () => {
  it('passes paging through and returns the page', async () => {
    backend.respond('GET /api/sdk/v1/history', 200, { items: [{ id: 'tx-1', status: 'settled', auditUrls: [] }], nextCursor: 'abc' });
    const page = await spica.history({ limit: 10, cursor: 'xyz' });
    expect(page).toMatchObject({ nextCursor: 'abc', items: [{ id: 'tx-1' }] });
    expect(backend.requests[0]?.path).toBe('/api/sdk/v1/history?limit=10&cursor=xyz');
  });

  it('rejects a bad limit', async () => {
    await expect(spica.history({ limit: 0 })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('errors', () => {
  it('maps each status to a class that keeps code and status', async () => {
    backend.respond('GET /api/sdk/v1/budget', 401, { error: 'Bad key.' });
    await expect(spica.getBudget()).rejects.toMatchObject({ name: 'AuthenticationError', status: 401, message: 'Bad key.' });
    backend.respond('GET /api/sdk/v1/budget', 429, { error: 'Slow down.' });
    await expect(spica.getBudget()).rejects.toBeInstanceOf(RateLimitError);
    backend.respond('GET /api/sdk/v1/budget', 500, { error: 'Boom.' });
    await expect(spica.getBudget()).rejects.toBeInstanceOf(ServerError);
  });

  it('copes with a response that is not JSON', async () => {
    backend.respondText('GET /api/sdk/v1/budget', 502, '<html>Bad gateway</html>');
    await expect(spica.getBudget()).rejects.toBeInstanceOf(ServerError);
  });

  it('makes every error a SpicaError', async () => {
    await expect(spica.inspect('nope')).rejects.toBeInstanceOf(SpicaError);
  });
});
