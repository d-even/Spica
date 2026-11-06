import 'server-only';
import { microsToUsd } from '@/lib/money';
import { NETWORKS, type NetworkId } from '@/lib/networks';
import { activeNetworks, circleCatalogEnabled, mode, publicUrl } from '@/server/env';
import { getStore } from '@/server/store';
import type { ServiceRecord } from '@/server/store/types';
import { discover, recentlyDiscovered } from './circle';
import type { CatalogService } from './types';

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
    // Arc payments settle through Circle Gateway.
    supportsGateway: offers.some((offer) => NETWORKS[offer.network].family === 'arc'),
  };
}

/** Every API providers have listed. This is the marketplace. */
export async function localServices(): Promise<CatalogService[]> {
  const services = await getStore().listServices({ enabledOnly: true });
  const entries = await Promise.all(services.map(registeredToCatalog));
  return entries.filter((entry) => entry !== null);
}

/** The same filters Circle discovery applies, for SPICA's own listings. */
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
 * Finds a service a person picked in the marketplace. SPICA listings are read
 * fresh from the store; Circle listings must have been seen by this server recently.
 */
export async function resolveService(id: string): Promise<CatalogService | null> {
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

/** Provider listings, then the Circle catalog when it is switched on. */
export async function findServices(input: { query: string; category?: string; maxUsdPrice?: string; limit?: number }) {
  const local = await localServices();
  const relevant = filterLocal(local, { query: input.query || undefined, maxUsdPrice: input.maxUsdPrice });

  const live = circleCatalogEnabled() ? activeNetworks().filter((network) => network !== 'demo') : [];
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
