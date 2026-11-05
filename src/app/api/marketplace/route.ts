import { z } from 'zod';
import { SELECTABLE_NETWORKS, type NetworkId } from '@/lib/networks';
import { builtinServices } from '@/server/discovery/catalog';
import { CATEGORIES, discover } from '@/server/discovery/circle';
import { apiError, authed, toJson } from '@/server/http/api';
import { computeReputation } from '@/server/reputation';
import { getStore } from '@/server/store';

const query = z.object({
  query: z.string().max(100).optional(),
  category: z.enum(CATEGORIES).optional(),
  network: z.enum(SELECTABLE_NETWORKS as [NetworkId, ...NetworkId[]]).optional(),
  offset: z.coerce.number().int().min(0).default(0),
});

const PAGE_SIZE = 24;

export const GET = authed(async (_user, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const input = query.parse(params);
  const store = getStore();

  const local = input.offset === 0 && !input.category ? builtinServices() : [];
  try {
    const page = await discover({ ...input, limit: PAGE_SIZE });
    const services = await Promise.all(
      [...local, ...page.services].map(async (service) => ({
        ...service,
        reputation: computeReputation(await store.listObservations(service.id)),
      })),
    );
    return toJson({ services, total: page.total, pageSize: PAGE_SIZE });
  } catch (error) {
    console.error('Discovery failed:', error);
    return apiError('The marketplace is unavailable right now. Try again shortly.', 502);
  }
});
