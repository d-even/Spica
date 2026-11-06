import { connection, NextResponse } from 'next/server';
import { z } from 'zod';
import { NETWORKS, SELECTABLE_NETWORKS, type NetworkId } from '@/lib/networks';
import { filterLocal, localServices } from '@/server/discovery/catalog';
import { discover } from '@/server/discovery/circle';
import type { CatalogService } from '@/server/discovery/types';
import { circleCatalogEnabled } from '@/server/env';
import { apiError } from '@/server/http/api';
import { allowRequest } from '@/server/http/rate-limit';

const query = z.object({
  query: z.string().max(100).optional(),
  category: z.string().trim().max(40).optional(),
  maxUsdPrice: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  network: z.enum(SELECTABLE_NETWORKS as [NetworkId, ...NetworkId[]]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const toListing = (service: CatalogService) => ({
  id: service.id,
  name: service.name,
  description: service.description,
  category: service.category,
  provider: service.providerName,
  source: service.source === 'circle' ? 'circle' : 'paygate',
  // Call this URL: it answers 402 with x402 payment terms.
  resource: service.endpoint,
  method: service.method,
  priceUsd: service.listedUsd,
  accepts: service.offers.map((offer) => ({
    network: NETWORKS[offer.network].caip2,
    asset: offer.asset,
    amount: offer.amountMicros,
    payTo: offer.payTo,
  })),
  inputSchema: service.inputSchema,
});

/**
 * Public, read-only discovery for agents: provider listings as x402 endpoints,
 * cheapest first. No account needed to look.
 * Example: GET /api/discover?query=weather&maxUsdPrice=0.01
 */
export async function GET(request: Request) {
  await connection();
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!allowRequest(`discover:${client}`, 60, 60_000)) return apiError('Too many requests.', 429);

  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? 'Invalid query.', 400);
  const input = parsed.data;

  const local = filterLocal(await localServices(), input).filter((service) => service.purchasable);
  let external: CatalogService[] = [];
  let circle: 'ok' | 'unavailable' | 'off' = 'off';
  if (circleCatalogEnabled()) {
    try {
      external = (await discover({ ...input, limit: input.limit })).services.filter((service) => service.purchasable);
      circle = 'ok';
    } catch {
      circle = 'unavailable';
    }
  }

  const price = (service: CatalogService) => (service.listedMicros === null ? Number.POSITIVE_INFINITY : Number(service.listedMicros));
  const items = [...local, ...external].sort((a, b) => price(a) - price(b)).slice(0, input.limit).map(toListing);
  return NextResponse.json({ x402Version: 2, items, sources: { paygate: 'ok', circle } });
}
