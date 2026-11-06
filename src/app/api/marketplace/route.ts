import { z } from 'zod';
import { SELECTABLE_NETWORKS, type NetworkId } from '@/lib/networks';
import { filterLocal, localServices } from '@/server/discovery/catalog';
import { CATEGORIES, discover } from '@/server/discovery/circle';
import type { CatalogService } from '@/server/discovery/types';
import { authed, toJson } from '@/server/http/api';
import { computeReputation } from '@/server/reputation';
import { getStore } from '@/server/store';

const query = z.object({
  query: z.string().max(100).optional(),
  category: z.string().trim().max(40).optional(),
  source: z.enum(['paygate', 'circle']).optional(),
  network: z.enum(SELECTABLE_NETWORKS as [NetworkId, ...NetworkId[]]).optional(),
  maxUsdPrice: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Max price must be a dollar amount.').optional(),
  offset: z.coerce.number().int().min(0).default(0),
});

const PAGE_SIZE = 24;
const isCircleCategory = (value: string): value is (typeof CATEGORIES)[number] => (CATEGORIES as readonly string[]).includes(value);

/**
 * PayGate's own listings first, then a page of the Circle Agent Marketplace.
 * If Circle is unreachable the PayGate listings still show, with a note.
 */
export const GET = authed(async (_user, request) => {
  const input = query.parse(Object.fromEntries(new URL(request.url).searchParams));
  const store = getStore();

  const matchingLocal = input.source === 'circle' ? [] : filterLocal(await localServices(), input);
  // Circle paginates; PayGate's handful of listings ride on the first page.
  const local = input.offset === 0 ? matchingLocal : [];

  let external: CatalogService[] = [];
  let externalTotal = 0;
  let circleError: string | null = null;
  const askCircle = input.source !== 'paygate' && (!input.category || isCircleCategory(input.category));
  if (askCircle) {
    try {
      const page = await discover({ ...input, limit: PAGE_SIZE });
      external = page.services;
      externalTotal = page.total;
    } catch (error) {
      console.error('Discovery failed:', error);
      circleError = 'The Circle marketplace is unreachable right now. PayGate services are still listed.';
    }
  }

  const services = await Promise.all(
    [...local, ...external].map(async (service) => ({
      ...service,
      reputation: computeReputation(await store.listObservations(service.id)),
    })),
  );
  return toJson({
    services,
    total: matchingLocal.length + externalTotal,
    localCount: matchingLocal.length,
    externalTotal,
    pageSize: PAGE_SIZE,
    circleError,
  });
});
