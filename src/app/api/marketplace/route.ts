import { z } from 'zod';
import { SELECTABLE_NETWORKS, type NetworkId } from '@/lib/networks';
import { filterLocal, localServices } from '@/server/discovery/catalog';
import { circleCatalogEnabled } from '@/server/env';
import { CATEGORIES, discover } from '@/server/discovery/circle';
import type { CatalogService } from '@/server/discovery/types';
import { open, toJson } from '@/server/http/api';
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
 * Public, like /api/discover: anyone can browse. Buying needs a session.
 * Provider listings first, then a page of the Circle catalog when it is switched on.
 * If Circle is unreachable the SPICA listings still show, with a note.
 */
export const GET = open(async (request) => {
  const input = query.parse(Object.fromEntries(new URL(request.url).searchParams));
  const store = getStore();

  const matchingLocal = input.source === 'circle' ? [] : filterLocal(await localServices(), input);
  // Circle paginates; SPICA's handful of listings ride on the first page.
  const local = input.offset === 0 ? matchingLocal : [];

  let external: CatalogService[] = [];
  let externalTotal = 0;
  let circleError: string | null = null;
  const askCircle = circleCatalogEnabled() && input.source !== 'paygate' && (!input.category || isCircleCategory(input.category));
  if (askCircle) {
    try {
      const page = await discover({ ...input, limit: PAGE_SIZE });
      external = page.services;
      externalTotal = page.total;
    } catch (error) {
      console.error('Discovery failed:', error);
      circleError = 'The Circle marketplace is unreachable right now. SPICA services are still listed.';
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
