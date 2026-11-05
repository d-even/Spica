import { z } from 'zod';
import { usdToMicros } from '@/lib/money';
import { SELECTABLE_NETWORKS, type NetworkId } from '@/lib/networks';
import { apiError, authed, toJson } from '@/server/http/api';
import { assertPublicUrl } from '@/server/http/guard';
import { getStore } from '@/server/store';

const body = z.object({
  name: z.string().trim().min(2, 'Enter a service name.').max(80),
  description: z.string().trim().max(500),
  endpoint: z.string().url('Enter the full URL of your API.'),
  category: z.string().trim().max(40).default('Other'),
  price: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter a price like 0.02').transform(usdToMicros),
  supportedNetworks: z
    .array(z.enum(SELECTABLE_NETWORKS as [NetworkId, ...NetworkId[]]))
    .min(1, 'Choose at least one payment network.'),
});

export const POST = authed(async (user, request) => {
  const input = body.parse(await request.json());
  const store = getStore();
  const provider = await store.getProviderByOwner(user.id);
  if (!provider) return apiError('Set up your provider profile first.', 400);
  if (input.price <= 0n) return apiError('The price must be above zero.', 400);

  try {
    await assertPublicUrl(input.endpoint);
  } catch (error) {
    return apiError((error as Error).message, 400);
  }
  const needsHedera = input.supportedNetworks.some((network) => network.startsWith('hedera'));
  if (needsHedera && !provider.hederaAccount) return apiError('Add a Hedera account to your profile first.', 400);

  const service = await store.createService({
    providerId: provider.id,
    name: input.name,
    description: input.description,
    endpoint: input.endpoint,
    category: input.category,
    priceMicros: input.price,
    supportedNetworks: input.supportedNetworks,
    enabled: true,
  });
  return toJson(service);
});
