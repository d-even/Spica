import { z } from 'zod';
import { apiError, toJson } from '@/server/http/api';
import { agentRoute, historyFor } from '@/server/sdk';
import { getStore } from '@/server/store';

const limit = z.coerce.number().int().min(1).max(100).default(20);

export const GET = agentRoute(async (grant, request) => {
  const search = new URL(request.url).searchParams;
  const page = await historyFor(getStore(), grant, limit.parse(search.get('limit') ?? undefined), search.get('cursor'));
  return page ? toJson(page) : apiError('That cursor is not valid.', 400);
});
