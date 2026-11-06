import 'server-only';
import { createPublicClient, http, isAddress } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';

/**
 * ENS answers one question: does this name point at this address? It says
 * nothing about whether an API is good. That is the reputation engine's job,
 * and the two are kept apart everywhere in the product.
 */
export type IdentityStatus = 'match' | 'mismatch' | 'none';

export interface ProviderIdentity {
  status: IdentityStatus;
  ensName: string | null;
  resolvedAddress: string | null;
  detail: string;
}

const client = createPublicClient({ chain: mainnet, transport: http(process.env.ENS_RPC_URL) });

export async function resolveEnsName(name: string): Promise<string | null> {
  try {
    return await client.getEnsAddress({ name: normalize(name) });
  } catch (error) {
    console.error('ENS forward resolution failed:', (error as Error).message);
    return null;
  }
}

/** Reverse record, confirmed forward so that a spoofed reverse record is ignored. */
export async function reverseResolve(address: string): Promise<string | null> {
  if (!isAddress(address)) return null;
  try {
    const name = await client.getEnsName({ address });
    if (!name) return null;
    const forward = await resolveEnsName(name);
    return forward?.toLowerCase() === address.toLowerCase() ? name : null;
  } catch (error) {
    console.error('ENS reverse resolution failed:', (error as Error).message);
    return null;
  }
}

/** Compares a claimed name with the address money would actually go to. */
export async function checkProviderIdentity(claimedName: string | null, payTo: string): Promise<ProviderIdentity> {
  if (!claimedName) {
    const name = await reverseResolve(payTo);
    return name
      ? { status: 'match', ensName: name, resolvedAddress: payTo, detail: 'Primary ENS name for the payment address.' }
      : { status: 'none', ensName: null, resolvedAddress: null, detail: 'No ENS name for this provider.' };
  }
  const resolved = await resolveEnsName(claimedName);
  if (!resolved) {
    return { status: 'mismatch', ensName: claimedName, resolvedAddress: null, detail: 'The ENS name does not resolve.' };
  }
  return resolved.toLowerCase() === payTo.toLowerCase()
    ? { status: 'match', ensName: claimedName, resolvedAddress: resolved, detail: 'The ENS name resolves to the payment address.' }
    : { status: 'mismatch', ensName: claimedName, resolvedAddress: resolved, detail: 'The ENS name resolves to a different address.' };
}
