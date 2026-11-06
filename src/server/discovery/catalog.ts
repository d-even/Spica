import 'server-only';
import { microsToUsd, usdToMicros } from '@/lib/money';
import { NETWORKS, type NetworkId } from '@/lib/networks';
import { activeNetworks, mode, publicUrl } from '@/server/env';
import { feedKeyName, isFeedId } from '@/server/feeds';
import { getStore } from '@/server/store';
import type { ServiceRecord } from '@/server/store/types';
import { discover } from './circle';
import type { CatalogService } from './types';

/**
 * Services PayGate sells itself. The Circle catalog has no cricket API, so the
 * end-to-end journey runs against these real x402 endpoints.
 */
const BUILTIN: { id: string; name: string; description: string; priceMicros: string; input?: Record<string, string> }[] = [
  {
    id: 'weather-live',
    name: 'Weather Forecast',
    description: 'Current weather and a 3-day forecast for any city.',
    priceMicros: '10000',
    input: { q: 'City name, for example Pune' },
  },
  {
    id: 'news-live',
    name: 'News Headlines',
    description: 'Top news headlines, or news articles about any topic.',
    priceMicros: '20000',
    input: { q: 'Optional topic, for example bitcoin' },
  },
  {
    id: 'finance-quote',
    name: 'Stock Quotes',
    description: 'Finance data: the latest stock market price for a ticker symbol.',
    priceMicros: '10000',
    input: { symbol: 'Ticker symbol, for example IBM' },
  },
  {
    id: 'cricket-live',
    name: 'Cricket Live Scores',
    description: 'Current cricket matches with scores and match status.',
    priceMicros: '20000',
  },
];

export const isBuiltinId = (id: string) => BUILTIN.some((service) => service.id === id);

/** Where a built-in service gets paid on one network, if it can be paid there at all. */
export function builtinPayTo(network: NetworkId): string | null {
  if (network === 'demo') return 'demo-provider';
  const family = NETWORKS[network].family;
  if (family === 'arc') return process.env.PAYGATE_SELLER_ADDRESS ?? null;
  if (family === 'hedera') return process.env.HEDERA_SELLER_ACCOUNT_ID ?? null;
  return null;
}

export function builtinServices(): CatalogService[] {
  const networks = activeNetworks().filter((network) => builtinPayTo(network));
  // A resold API with no key on this server cannot deliver, so it is not listed.
  const available = BUILTIN.filter((service) => !isFeedId(service.id) || process.env[feedKeyName(service.id)]);
  return available.map((service) => ({
    id: service.id,
    source: 'builtin' as const,
    name: service.name,
    description: service.description,
    category: 'SPORTS',
    providerName: mode() === 'demo' ? 'PayGate Demo Provider' : 'PayGate',
    providerKey: 'paygate:builtin',
    endpoint: `${publicUrl()}/api/x402/${service.id}`,
    method: 'GET',
    offers: networks.map((network) => ({
      network,
      amountMicros: service.priceMicros,
      payTo: builtinPayTo(network)!,
      asset: NETWORKS[network].tokenAsset,
    })),
    listedMicros: service.priceMicros,
    listedUsd: microsToUsd(service.priceMicros),
    allNetworks: networks.map((network) => NETWORKS[network].caip2),
    inputSchema: service.input ?? null,
    purchasable: networks.length > 0,
    supportsGateway: false,
  }));
}

export async function registeredToCatalog(service: ServiceRecord): Promise<CatalogService | null> {
  const provider = await getStore().getProvider(service.providerId);
  if (!provider) return null;
  // Demo mode has one simulated rail, so every service is offered on it.
  const networks = mode() === 'demo' ? (['demo'] as NetworkId[]) : service.supportedNetworks.filter((network) => activeNetworks().includes(network));
  const payTo = (network: NetworkId) => (NETWORKS[network].family === 'hedera' ? provider.hederaAccount : provider.walletAddress);
  const offers = networks.flatMap((network) => {
    const address = payTo(network);
    return address
      ? [{ network, amountMicros: service.priceMicros.toString(), payTo: address, asset: NETWORKS[network].tokenAsset }]
      : [];
  });
  return {
    id: service.id,
    source: 'paygate',
    name: service.name,
    description: service.description,
    category: service.category,
    providerName: provider.name,
    providerKey: `paygate:${provider.id}`,
    endpoint: `${publicUrl()}/api/x402/${service.id}`,
    method: 'GET',
    offers,
    listedMicros: service.priceMicros.toString(),
    listedUsd: microsToUsd(service.priceMicros),
    allNetworks: service.supportedNetworks.map((network) => NETWORKS[network].caip2),
    inputSchema: null,
    purchasable: offers.length > 0,
    supportsGateway: false,
  };
}

const matches = (service: CatalogService, query: string) =>
  query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .some((word) => `${service.name} ${service.description} ${service.category}`.toLowerCase().includes(word));

/** Built-in and provider-registered services. The agent and the marketplace both read this. */
export async function localServices(query?: string) {
  const local = [...builtinServices()];
  const registered = await getStore().listServices({ enabledOnly: true });
  for (const service of registered) {
    const entry = await registeredToCatalog(service);
    if (entry) local.push(entry);
  }
  return query ? local.filter((service) => matches(service, query)) : local;
}

/** PayGate services first, then the Circle catalog filtered to payable networks. */
export async function findServices(input: { query: string; category?: string; maxUsdPrice?: string; limit?: number }) {
  const local = await localServices(input.query);
  const relevant = input.maxUsdPrice
    ? local.filter((service) => service.listedMicros !== null && BigInt(service.listedMicros) <= usdToMicros(input.maxUsdPrice!))
    : local;

  const live = activeNetworks().filter((network) => network !== 'demo');
  const pages = await Promise.allSettled(
    live.map((network) => discover({ ...input, network, limit: input.limit ?? 10 })),
  );
  const external = pages.flatMap((page) => (page.status === 'fulfilled' ? page.value.services : []));
  const failures = pages.flatMap((page) => (page.status === 'rejected' ? [String(page.reason)] : []));

  const seen = new Set<string>();
  const services = [...relevant, ...external].filter((service) => {
    if (seen.has(service.id)) return false;
    seen.add(service.id);
    return true;
  });
  return { services, failures };
}
