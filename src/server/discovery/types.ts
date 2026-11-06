import type { NetworkId } from '@/lib/networks';

export interface CatalogOffer {
  network: NetworkId;
  amountMicros: string;
  payTo: string;
  asset: string;
}

/** A purchasable service from any source, in one shape. JSON-safe. */
export interface CatalogService {
  id: string;
  source: 'circle' | 'paygate' | 'builtin';
  name: string;
  description: string;
  category: string;
  providerName: string;
  providerKey: string;
  endpoint: string;
  method: string;
  offers: CatalogOffer[];
  listedMicros: string | null;
  listedUsd: string | null;
  allNetworks: string[];
  inputSchema: unknown;
  purchasable: boolean;
  supportsGateway: boolean;
}
