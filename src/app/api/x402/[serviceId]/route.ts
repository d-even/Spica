import { connection, NextResponse } from 'next/server';
import { withPayment } from 'paygate-x402';
import { loadCricketFeed } from '@/server/cricket';
import { builtinServices, isBuiltinId, registeredToCatalog } from '@/server/discovery/catalog';
import type { CatalogService } from '@/server/discovery/types';
import { apiError } from '@/server/http/api';
import { assertPublicUrl, safeFetch } from '@/server/http/guard';
import { allowRequest } from '@/server/http/rate-limit';
import { getAdapter } from '@/server/payments/registry';
import { getStore } from '@/server/store';

interface ResolvedService {
  service: CatalogService;
  /** The provider's real API. Null for built-in services. */
  upstream: string | null;
  ownerUserId: string | null;
}

async function resolve(serviceId: string): Promise<ResolvedService | null> {
  if (isBuiltinId(serviceId)) {
    const service = builtinServices().find((item) => item.id === serviceId);
    return service ? { service, upstream: null, ownerUserId: null } : null;
  }
  const store = getStore();
  const record = await store.getService(serviceId).catch(() => null);
  if (!record?.enabled) return null;
  const [service, provider] = await Promise.all([registeredToCatalog(record), store.getProvider(record.providerId)]);
  return service && provider ? { service, upstream: record.endpoint, ownerUserId: provider.ownerUserId } : null;
}

/** Data is produced before settlement, so a failure here charges nobody. */
async function deliver(upstream: string | null): Promise<Response> {
  if (upstream === null) {
    const feed = await loadCricketFeed();
    return feed ? NextResponse.json(feed) : NextResponse.json({ error: 'Cricket data is unavailable.' }, { status: 503 });
  }
  const response = await safeFetch(await assertPublicUrl(upstream), { headers: { accept: 'application/json' } });
  return new Response(response.text, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  await connection();
  const { serviceId } = await params;
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!allowRequest(`x402:${client}`, 120, 60_000)) return apiError('Too many requests.', 429);

  try {
    const resolved = await resolve(serviceId);
    if (!resolved?.service.purchasable) return apiError('Service not found.', 404);
    const { service, upstream, ownerUserId } = resolved;
    const store = getStore();

    const handler = withPayment(() => deliver(upstream), {
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
