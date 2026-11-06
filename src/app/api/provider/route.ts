import { isAddress } from 'viem';
import { z } from 'zod';
import { createENSSubdomain, getSubdomainForWallet } from '@/lib/subdomain';
import { apiError, authed, toJson } from '@/server/http/api';
import { resolveEnsName } from '@/server/identity/ens';
import { computeReputation } from '@/server/reputation';
import { getStore } from '@/server/store';

const body = z.object({
  name: z.string().trim().min(2, 'Enter a provider name.').max(80),
  walletAddress: z.string().refine((value) => isAddress(value), 'Enter a valid wallet address.'),
  ensName: z.string().trim().toLowerCase().max(255).optional().or(z.literal('')),
  hederaAccount: z.string().regex(/^\d+\.\d+\.\d+$/, 'Use the form 0.0.1234.').optional().or(z.literal('')),
  paygateLabel: z.string().regex(/^[a-z0-9]{3,32}$/, 'Use 3 to 32 lowercase letters or numbers.').optional().or(z.literal('')),
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
  const paygateId = await getSubdomainForWallet(provider.walletAddress as `0x${string}`);
  return toJson({ provider, paygateId, services: withReputation, sales });
});

export const PUT = authed(async (user, request) => {
  const input = body.parse(await request.json());
  const ensName = input.ensName || null;

  if (ensName) {
    const resolved = await resolveEnsName(ensName);
    if (resolved?.toLowerCase() !== input.walletAddress.toLowerCase()) {
      return apiError('That ENS name does not resolve to this wallet address.', 400);
    }
  }
  const provider = await getStore().saveProvider({
    ownerUserId: user.id,
    name: input.name,
    ensName,
    walletAddress: input.walletAddress,
    hederaAccount: input.hederaAccount || null,
  });

  let paygateId: string | null = null;
  if (input.paygateLabel) {
    if (!process.env.ADMIN_PRIVATE_KEY) return apiError('PayGate IDs are not enabled on this server.', 400);
    paygateId = await createENSSubdomain(input.paygateLabel, input.walletAddress as `0x${string}`);
    if (!paygateId) return apiError('That PayGate ID is taken or could not be created.', 400);
  }
  return toJson({ ...provider, paygateId });
});
