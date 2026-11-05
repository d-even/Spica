import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { NETWORKS, networkByCaip2, type NetworkId } from '@/lib/networks';
import { microsToUsd } from '@/lib/money';
import type { CatalogService } from './types';

/** Circle Agent Marketplace discovery. Public, no key. See developers.circle.com/agent-stack/agent-marketplace. */
const DISCOVERY_URL = process.env.CIRCLE_DISCOVERY_URL ?? 'https://api.circle.com/v2/x402/discovery/resources';
const CACHE_TTL_MS = 60_000;

const accept = z.object({
  scheme: z.string(),
  network: z.string(),
  asset: z.string(),
  amount: z.string().regex(/^\d+$/),
  payTo: z.string(),
});

const listing = z.object({
  resource: z.string().url(),
  type: z.string().optional(),
  accepts: z.array(accept).default([]),
  metadata: z
    .object({
      provider: z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        website: z.string().optional(),
      }).partial().optional(),
      method: z.string().optional(),
      description: z.string().optional(),
      input: z.unknown().optional(),
      siwx: z.boolean().optional(),
      supportsCircleGateway: z.boolean().optional(),
      supportsVanillax402: z.boolean().optional(),
    })
    .partial()
    .optional(),
});

const page = z.object({
  items: z.array(z.unknown()).default([]),
  pagination: z.object({ total: z.number().optional() }).partial().optional(),
});

export const CATEGORIES = [
  'SOCIAL_INTELLIGENCE',
  'FINANCIAL_ANALYSIS',
  'WEB_SEARCH_RESEARCH',
  'PREDICTION_MARKETS',
  'CREATIVE',
  'INFRASTRUCTURE',
] as const;

export interface DiscoveryQuery {
  query?: string;
  category?: string;
  /** One network to filter on. Omit to see the whole catalog. */
  network?: NetworkId;
  maxUsdPrice?: string;
  limit?: number;
  offset?: number;
}

export interface DiscoveryPage {
  services: CatalogService[];
  total: number;
}

const providerSlug = (name: string) => `catalog:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

export function toCatalogService(raw: unknown): CatalogService | null {
  const parsed = listing.safeParse(raw);
  if (!parsed.success) return null;
  const { resource, accepts, metadata, type } = parsed.data;
  if (type && type !== 'http') return null;

  const offers = accepts.flatMap((item) => {
    const network = networkByCaip2(item.network);
    return network && network.id !== 'demo' ? [{ network: network.id, amountMicros: item.amount, payTo: item.payTo, asset: item.asset }] : [];
  });
  const prices = accepts.map((item) => BigInt(item.amount));
  const cheapest = prices.length ? prices.reduce((low, value) => (value < low ? value : low)) : null;
  const providerName = metadata?.provider?.name ?? new URL(resource).hostname;

  return {
    id: `cat_${createHash('sha256').update(resource).digest('hex').slice(0, 16)}`,
    source: 'circle',
    name: metadata?.description?.split('. ')[0]?.slice(0, 80) ?? new URL(resource).pathname,
    description: metadata?.description ?? metadata?.provider?.description ?? '',
    category: metadata?.provider?.category ?? 'OTHER',
    providerName,
    providerKey: providerSlug(providerName),
    providerEns: null,
    endpoint: resource,
    method: metadata?.method ?? 'GET',
    offers,
    listedMicros: cheapest?.toString() ?? null,
    listedUsd: cheapest === null ? null : microsToUsd(cheapest),
    allNetworks: accepts.map((item) => item.network),
    inputSchema: metadata?.input ?? null,
    // Path templates and browser sign-in cannot be called by the agent.
    purchasable: !resource.includes('{') && !metadata?.siwx && offers.length > 0,
    supportsGateway: metadata?.supportsCircleGateway ?? false,
  };
}

const cache = new Map<string, { at: number; page: DiscoveryPage }>();

export async function discover(query: DiscoveryQuery): Promise<DiscoveryPage> {
  const params = new URLSearchParams({ type: 'http', limit: String(Math.min(query.limit ?? 24, 200)), offset: String(query.offset ?? 0) });
  if (query.query) params.set('query', query.query);
  if (query.category) params.set('category', query.category);
  if (query.network) params.set('network', NETWORKS[query.network].caip2);
  if (query.maxUsdPrice) params.set('maxUsdPrice', query.maxUsdPrice);

  const key = params.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.page;

  const response = await fetch(`${DISCOVERY_URL}?${key}`, {
    signal: AbortSignal.timeout(15_000),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Discovery returned HTTP ${response.status}`);

  const body = page.parse(await response.json());
  const services = body.items.flatMap((item) => toCatalogService(item) ?? []);
  const result = { services, total: body.pagination?.total ?? services.length };
  cache.set(key, { at: Date.now(), page: result });
  return result;
}
