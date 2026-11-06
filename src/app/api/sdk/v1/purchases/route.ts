import { z } from 'zod';
import { agentRoute, purchaseForAgent } from '@/server/sdk';
import { getStore } from '@/server/store';

const body = z.object({
  serviceId: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().regex(/^[\w.:-]{8,200}$/, 'idempotencyKey must be 8 to 200 letters, numbers, dots, colons, dashes or underscores.'),
  // Arc carries payments. Hedera holds the audit trail.
  network: z.literal('arc-testnet').default('arc-testnet'),
  params: z
    .record(z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/, 'Parameter names may use letters, numbers, dots, dashes and underscores.'), z.string().max(200))
    .refine((value) => Object.keys(value).length <= 10, 'Up to 10 parameters.')
    .optional(),
});

export const POST = agentRoute(
  async (grant, request) => purchaseForAgent(getStore(), grant, body.parse(await request.json().catch(() => null))),
  { requests: 10, windowMs: 60_000 },
);
