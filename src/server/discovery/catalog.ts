import 'server-only';
import { microsToUsd } from '@/lib/money';
import { NETWORKS, type NetworkId } from '@/lib/networks';
import { activeNetworks, mode, publicUrl } from '@/server/env';
import { getStore } from '@/server/store';
import type { ServiceRecord } from '@/server/store/types';
import { discover, recentlyDiscovered } from './circle';
import type { CatalogService } from './types';

/**
 * Services PayGate sells itself. The Circle catalog has no cricket API, so the
 * end-to-end journey runs against these real x402 endpoints. `cricket-pro` is
 * the expensive option the firewall is expected to refuse.
 */
const BUILTIN = [
  {
    id: 'cricket-live',
    name: 'Cricket Live Scores',
    description: 'Current cricket matches with scores and match status.',
    priceMicros: '20000',
  },
  {
    id: 'cricket-pro',
    name: 'Cricket Pro Feed',
    description: 'The same cricket feed at a premium price.',
    priceMicros: '2000000',
  },
] as const;

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
  return BUILTIN.map((service) => ({
    id: service.id,
    source: 'builtin' as const,
    name: service.name,
    description: service.description,
    category: 'SPORTS',
    providerName: mode() === 'demo' ? 'PayGate Demo Provider' : 'PayGate',
    providerKey: 'paygate:builtin',
    providerEns: null,
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
    inputSchema: null,
    purchasable: networks.length > 0,
    supportsGateway: false,
  }));
}

export async function registeredToCatalog(service: ServiceRecord): Promise<CatalogService | null> {
  const provider = await getStore().getProvider(service.providerId);
  if (!provider) return null;
  const networks = service.supportedNetworks.filter((network) => activeNetworks().includes(network));
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
    providerEns: provider.ensName,
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

/** Everything PayGate sells itself: built-in demo services and provider-registered APIs. */
export async function localServices(): Promise<CatalogService[]> {
  const local = [...builtinServices()];
  for (const service of await getStore().listServices({ enabledOnly: true })) {
    const entry = await registeredToCatalog(service);
    if (entry) local.push(entry);
  }
  return local;
}

/** The same filters Circle discovery applies, for PayGate's own listings. */
export function filterLocal(
  services: CatalogService[],
  input: { query?: string; category?: string; maxUsdPrice?: string; network?: NetworkId },
) {
  const cap = input.maxUsdPrice ? Number(input.maxUsdPrice) : null;
  return services.filter(
    (service) =>
      (!input.query || matches(service, input.query)) &&
      (!input.category || service.category.toUpperCase() === input.category.toUpperCase()) &&
      (cap === null || (service.listedUsd !== null && Number(service.listedUsd) <= cap)) &&
      (!input.network || service.offers.some((offer) => offer.network === input.network)),
  );
}

/**
 * Finds a service a person picked in the marketplace. PayGate listings are read
 * fresh from the store; Circle listings must have been seen by this server recently.
 */
export async function resolveService(id: string): Promise<CatalogService | null> {
  if (isBuiltinId(id)) return builtinServices().find((service) => service.id === id) ?? null;
  if (!id.startsWith('cat_')) {
    const record = await getStore().getService(id).catch(() => null);
    return record?.enabled ? registeredToCatalog(record) : null;
  }
  return recentlyDiscovered(id);
}

const matches = (service: CatalogService, query: string) =>
  query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .some((word) => `${service.name} ${service.description} ${service.category}`.toLowerCase().includes(word));

/** PayGate services first, then the Circle catalog filtered to payable networks. */
export async function findServices(input: { query: string; category?: string; maxUsdPrice?: string; limit?: number }) {
  const local = await localServices();
  const relevant = input.query ? local.filter((service) => matches(service, input.query)) : local;

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
