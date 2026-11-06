import { isAddress } from 'viem';
import { z } from 'zod';
import { authed, toJson } from '@/server/http/api';
import { computeReputation } from '@/server/reputation';
import { getStore } from '@/server/store';

const body = z.object({
  name: z.string().trim().min(2, 'Enter a provider name.').max(80),
  walletAddress: z.string().trim().refine((value) => isAddress(value), 'Connect a wallet or enter a valid 0x address.'),
  hederaAccount: z.string().trim().regex(/^\d+\.\d+\.\d+$/, 'Use the form 0.0.1234.').optional().or(z.literal('')),
});

export const GET = authed(async (user) => {
  const store = getStore();
  const provider = await store.getProviderByOwner(user.id);
  if (!provider) return toJson({ provider: null, services: [], sales: [] });

  const [services, activity] = await Promise.all([store.listServices({ providerId: provider.id }), store.listActivity(user.id, 500)]);
  const withReputation = await Promise.all(
    services.map(async (service) => ({
      ...service,
      reputation: computeReputation(await store.listObservations(service.id)),
    })),
  );
  const sales = activity.filter((event) => event.eventType === 'sale' || event.eventType === 'sale_failed');
  return toJson({ provider, services: withReputation, sales });
});

/**
 * Saves the provider profile. Arc payments go to the connected wallet and
 * Hedera payments to the Hedera account. No name service is involved.
 */
export const PUT = authed(async (user, request) => {
  const input = body.parse(await request.json());
  const provider = await getStore().saveProvider({
    ownerUserId: user.id,
    name: input.name,
    ensName: null,
    walletAddress: input.walletAddress,
    hederaAccount: input.hederaAccount || null,
  });
  return toJson(provider);
});
