import { z } from 'zod';
import { usdToMicros } from '@/lib/money';
import { SELECTABLE_NETWORKS, type NetworkId } from '@/lib/networks';
import { authed, toJson } from '@/server/http/api';
import { getStore } from '@/server/store';

const usd = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter an amount like 0.50').transform(usdToMicros);

const body = z
  .object({
    perRequestLimit: usd,
    dailyLimit: usd,
    monthlyLimit: usd,
    approvalThreshold: usd,
    autoPayEnabled: z.boolean(),
    allowedNetworks: z.array(z.enum(SELECTABLE_NETWORKS as [NetworkId, ...NetworkId[]])),
    allowedProviders: z.array(z.string().max(120)).max(200),
    blockedProviders: z.array(z.string().max(120)).max(200),
  })
  .refine((value) => value.perRequestLimit <= value.dailyLimit, { message: 'The per-request limit cannot exceed the daily limit.' })
  .refine((value) => value.dailyLimit <= value.monthlyLimit, { message: 'The daily limit cannot exceed the monthly limit.' });

export const GET = authed(async (user) => toJson(await getStore().getPolicy(user.id)));

export const PUT = authed(async (user, request) => {
  const input = body.parse(await request.json());
  const policy = {
    userId: user.id,
    perRequestLimitMicros: input.perRequestLimit,
    dailyLimitMicros: input.dailyLimit,
    monthlyLimitMicros: input.monthlyLimit,
    approvalThresholdMicros: input.approvalThreshold,
    autoPayEnabled: input.autoPayEnabled,
    allowedNetworks: input.allowedNetworks,
    allowedProviders: input.allowedProviders,
    blockedProviders: input.blockedProviders,
  };
  const store = getStore();
  await store.savePolicy(policy);
  await store.appendActivity({ userId: user.id, transactionId: null, eventType: 'policy_updated', eventData: {} });
  return toJson(policy);
});
