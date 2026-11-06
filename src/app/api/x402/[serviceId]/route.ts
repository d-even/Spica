import { connection } from 'next/server';
import { withPayment } from 'paygate-x402';
import { registeredToCatalog } from '@/server/discovery/catalog';
import type { CatalogService } from '@/server/discovery/types';
import { apiError } from '@/server/http/api';
import { allowRequest } from '@/server/http/rate-limit';
import { getAdapter } from '@/server/payments/registry';
import { deliverFromProvider } from '@/server/provider-call';
import type { ServiceCredential } from '@/server/secrets';
import { getStore } from '@/server/store';

interface ResolvedService {
  service: CatalogService;
  /** The provider's real API. */
  upstream: string;
  ownerUserId: string | null;
  usageCode: string | null;
  credential: ServiceCredential | null;
}

async function resolve(serviceId: string): Promise<ResolvedService | null> {
  const store = getStore();
  const record = await store.getService(serviceId).catch(() => null);
  if (!record?.enabled) return null;
  const [service, provider, credential] = await Promise.all([
    registeredToCatalog(record),
    store.getProvider(record.providerId),
    record.apiKeyHash ? store.getServiceCredential(serviceId) : null,
  ]);
  return service && provider ? { service, upstream: record.endpoint, ownerUserId: provider.ownerUserId, usageCode: record.usageCode, credential } : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  await connection();
  const { serviceId } = await params;
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!allowRequest(`x402:${client}`, 120, 60_000)) return apiError('Too many requests.', 429);

  try {
    const resolved = await resolve(serviceId);
    if (!resolved?.service.purchasable) return apiError('Service not found.', 404);
    const { service, upstream, ownerUserId, usageCode, credential } = resolved;
    const store = getStore();

    const handler = withPayment(() => deliverFromProvider(upstream, usageCode, credential, new URL(request.url).searchParams), {
      offers: service.offers.map((offer) => ({
        adapter: getAdapter(offer.network),
        amountAtomic: offer.amountMicros,
        payTo: offer.payTo,
      })),
      replayGuard: { claim: (id) => store.claimProof(id), release: (id) => store.releaseProof(id) },
      description: service.description,
      onEvent: async (event) => {
        if (!ownerUserId || event.type === 'payment_required') return;
        await store.appendActivity({
          userId: ownerUserId,
          transactionId: null,
          eventType: event.type === 'settled' ? 'sale' : 'sale_failed',
          eventData:
            event.type === 'settled'
              ? {
                  serviceId,
                  amountMicros: event.requirement.amount,
                  network: event.requirement.network,
                  reference: event.settlement.transaction,
                  latencyMs: event.latencyMs,
                }
              : { serviceId, reason: event.type === 'rejected' ? event.reason : `upstream ${event.status}` },
        });
      },
    });
    return await handler(request);
  } catch (error) {
    console.error('Seller route failed:', error);
    return apiError('This service is temporarily unavailable.', 503);
  }
}
