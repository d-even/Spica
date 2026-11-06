import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { formatUsd } from '@/lib/money';
import { resolveService } from '@/server/discovery/catalog';
import { apiError, authed, toJson } from '@/server/http/api';
import { purchase, type PurchaseEvent } from '@/server/purchase';
import { getStore } from '@/server/store';

const body = z.object({
  params: z
    .record(z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/, 'Parameter names may use letters, numbers, dots, dashes and underscores.'), z.string().max(200))
    .refine((value) => Object.keys(value).length <= 10, 'Up to 10 parameters.')
    .optional(),
});

const MAX_DATA = 50_000;

/**
 * "Try API" from the marketplace. The browser names a service id and optional
 * query parameters, nothing else: endpoint, price and recipient come from the
 * server's catalog and the seller's 402, and the spending firewall runs exactly
 * as it does for the agent.
 */
export const POST = authed(
  async (user, request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const input = body.parse(await request.json().catch(() => ({})));
    const service = await resolveService(id);
    if (!service) return apiError('This listing is no longer available. Refresh the marketplace and try again.', 404);
    if (!service.purchasable) return apiError('This service cannot be paid on the networks enabled here.', 409);

    const store = getStore();
    const events: PurchaseEvent[] = [];
    const result = await purchase(
      {
        store,
        userId: user.id,
        agentId: await store.ensureAgent(user.id),
        taskId: `marketplace-${randomUUID()}`,
        emit: (event) => events.push(event),
      },
      { service, params: input.params },
    );

    if (result.outcome === 'needs_approval') {
      await store.appendActivity({
        userId: user.id,
        transactionId: null,
        eventType: 'approval_requested',
        eventData: { service: service.name, amount: formatUsd(result.approval.amountMicros), source: 'marketplace' },
      });
    }
    const trimmed =
      result.outcome === 'delivered'
        ? { ...result, data: result.data.slice(0, MAX_DATA), truncated: result.data.length > MAX_DATA }
        : result;
    return toJson({ ...trimmed, events });
  },
  { requests: 10, windowMs: 60_000 },
);
