import { NETWORKS } from '@/lib/networks';
import { resolveService } from '@/server/discovery/catalog';
import { apiError, open, toJson } from '@/server/http/api';
import { computeReputation } from '@/server/reputation';
import { getStore } from '@/server/store';

/** Public, like discovery: the same catalog entry, plus its measured reputation. */
export const GET = open(async (_request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const service = await resolveService(id);
  if (!service) return apiError('This service is not listed.', 404);
  const { status, score, sampleSize } = computeReputation(await getStore().listObservations(service.id));
  return toJson({
    id: service.id,
    name: service.name,
    description: service.description,
    category: service.category,
    provider: service.providerName,
    providerKey: service.providerKey,
    price: service.listedMicros === null ? null : { usd: service.listedUsd, micros: service.listedMicros },
    accepts: service.offers.map((offer) => ({ network: NETWORKS[offer.network].caip2, asset: offer.asset, amount: offer.amountMicros, payTo: offer.payTo })),
    purchasable: service.purchasable,
    gatewayCompatible: service.supportsGateway,
    reputation: { status, score, sampleSize },
  });
});
