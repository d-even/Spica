import { networkByCaip2 } from '@/lib/networks';
import { localServices } from '@/server/discovery/catalog';
import { open, toJson } from '@/server/http/api';

/** Public directory: everyone with a live listing, built from those listings. */
export const GET = open(async () => {
  const providers = new Map<string, { id: string; name: string; services: unknown[]; networks: Set<string>; gateway: boolean }>();
  for (const service of await localServices()) {
    const entry = providers.get(service.providerKey) ?? { id: service.providerKey, name: service.providerName, services: [], networks: new Set<string>(), gateway: false };
    const networks = [...new Set(service.allNetworks.flatMap((id) => networkByCaip2(id)?.label ?? []))];
    networks.forEach((network) => entry.networks.add(network));
    entry.gateway ||= service.supportsGateway;
    entry.services.push({
      id: service.id,
      name: service.name,
      description: service.description,
      category: service.category,
      listedMicros: service.listedMicros,
      networks,
      purchasable: service.purchasable,
    });
    providers.set(service.providerKey, entry);
  }
  return toJson({ providers: [...providers.values()].map((entry) => ({ ...entry, networks: [...entry.networks] })) });
});
