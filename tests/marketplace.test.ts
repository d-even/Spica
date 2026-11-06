import { describe, expect, it } from 'vitest';
import { categoryMeta, paramFields } from '@/components/marketplace/meta';
import { filterLocal } from '@/server/discovery/catalog';
import type { CatalogService } from '@/server/discovery/types';

const service = (overrides: Partial<CatalogService>): CatalogService => ({
  id: 'svc',
  source: 'paygate',
  name: 'Weather Now',
  description: 'Current weather for a city.',
  category: 'Other',
  providerName: 'Acme',
  providerKey: 'paygate:acme',
  providerEns: null,
  endpoint: 'https://example.com/api/x402/svc',
  method: 'GET',
  offers: [{ network: 'hedera-testnet', amountMicros: '1000', payTo: '0.0.123', asset: '0.0.429274' }],
  listedMicros: '1000',
  listedUsd: '0.001',
  allNetworks: ['hedera:testnet'],
  inputSchema: null,
  purchasable: true,
  supportsGateway: false,
  ...overrides,
});

describe('filterLocal', () => {
  const weather = service({ id: 'weather' });
  const cricket = service({
    id: 'cricket',
    name: 'Cricket Pro',
    description: 'Scores',
    category: 'SPORTS',
    listedMicros: '2000000',
    listedUsd: '2',
    offers: [{ network: 'arc-testnet', amountMicros: '2000000', payTo: '0xabc', asset: '0x36' }],
  });
  const all = [weather, cricket];

  it('matches any search word against name, description and category', () => {
    expect(filterLocal(all, { query: 'weather' }).map((s) => s.id)).toEqual(['weather']);
    expect(filterLocal(all, { query: 'sports' }).map((s) => s.id)).toEqual(['cricket']);
  });

  it('filters by category regardless of case', () => {
    expect(filterLocal(all, { category: 'sports' }).map((s) => s.id)).toEqual(['cricket']);
    expect(filterLocal(all, { category: 'OTHER' }).map((s) => s.id)).toEqual(['weather']);
  });

  it('applies the price cap and drops unpriced listings', () => {
    expect(filterLocal(all, { maxUsdPrice: '0.01' }).map((s) => s.id)).toEqual(['weather']);
    expect(filterLocal([service({ listedUsd: null, listedMicros: null })], { maxUsdPrice: '1' })).toEqual([]);
  });

  it('filters by payable network', () => {
    expect(filterLocal(all, { network: 'arc-testnet' }).map((s) => s.id)).toEqual(['cricket']);
  });
});

describe('paramFields', () => {
  it('reads top-level JSON Schema properties with required flags and examples', () => {
    const fields = paramFields({
      properties: { city: { description: 'City name', example: 'Mumbai' }, units: { default: 'metric' } },
      required: ['city'],
    });
    expect(fields).toEqual([
      { name: 'city', required: true, description: 'City name', example: 'Mumbai' },
      { name: 'units', required: false, description: undefined, example: 'metric' },
    ]);
  });

  it('finds query parameters nested under queryParams', () => {
    expect(paramFields({ queryParams: { properties: { q: {} } } }).map((f) => f.name)).toEqual(['q']);
  });

  it('returns nothing for shapes it does not understand', () => {
    expect(paramFields(null)).toEqual([]);
    expect(paramFields('text')).toEqual([]);
    expect(paramFields({ type: 'object' })).toEqual([]);
  });
});

describe('categoryMeta', () => {
  it('falls back to a readable label for unknown categories', () => {
    expect(categoryMeta('FINANCIAL_ANALYSIS').label).toBe('Finance');
    expect(categoryMeta('Weather').label).toBe('Weather');
  });
});
