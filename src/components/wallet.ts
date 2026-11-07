'use client';

import { createWalletClient, custom, type EIP1193Provider } from 'viem';
import { arcTestnet } from 'viem/chains';
import { createSiweMessage } from 'viem/siwe';
import { api } from './api';

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

/** A message that is safe to show as is. */
export class WalletError extends Error {}

const USER_REJECTED = 4001;
const SIGN_IN_TTL_MS = 10 * 60_000;

/** viem wraps provider errors, so look down the cause chain for the EIP-1193 code. */
function providerCode(error: unknown): number | undefined {
  let current = error as { code?: unknown; cause?: unknown } | undefined;
  while (current) {
    if (typeof current.code === 'number') return current.code;
    current = current.cause as typeof current;
  }
  return undefined;
}

export function walletErrorMessage(error: unknown): string {
  if (error instanceof WalletError) return error.message;
  if (providerCode(error) === USER_REJECTED) return 'You cancelled the request in your wallet.';
  const viemError = error as { shortMessage?: string; message?: string };
  return viemError.shortMessage ?? viemError.message ?? 'Something went wrong.';
}

/**
 * Sign-In with Ethereum on Arc Testnet: connect, switch (adding Arc Testnet to
 * the wallet if it is missing), then sign a message carrying a server nonce.
 * Signing is free and sends no transaction.
 */
export async function signInWithArc(): Promise<string> {
  const provider = window.ethereum;
  if (!provider) throw new WalletError('No browser wallet found. Install MetaMask, Rabby or another wallet, then try again.');
  const wallet = createWalletClient({ chain: arcTestnet, transport: custom(provider) });

  const [address] = await wallet.requestAddresses();
  if (!address) throw new WalletError('Your wallet did not share an account.');

  if ((await wallet.getChainId()) !== arcTestnet.id) {
    try {
      await wallet.switchChain({ id: arcTestnet.id });
    } catch (error) {
      if (providerCode(error) === USER_REJECTED) throw error;
      // Most wallets answer 4902 for an unknown chain; some use other codes, so add it either way.
      await wallet.addChain({ chain: arcTestnet });
      if ((await wallet.getChainId()) !== arcTestnet.id) await wallet.switchChain({ id: arcTestnet.id });
    }
  }

  const { nonce } = await api<{ nonce: string }>('/api/auth/nonce', { method: 'POST' });
  const issuedAt = new Date();
  const message = createSiweMessage({
    address,
    chainId: arcTestnet.id,
    domain: window.location.host,
    uri: window.location.origin,
    version: '1',
    nonce,
    statement: 'Sign in to SPICA. This is free and does not send a transaction.',
    issuedAt,
    expirationTime: new Date(issuedAt.getTime() + SIGN_IN_TTL_MS),
  });
  const signature = await wallet.signMessage({ account: address, message });

  await api('/api/auth/wallet', { method: 'POST', body: JSON.stringify({ chain: 'arc-testnet', message, signature }) });
  return address;
}

/**
 * A full page load, because the router keeps pages alive in memory. Without it,
 * a page keeps the signed-out state it had, or one wallet's data after sign-out.
 */
export const openFresh = (path: string) => window.location.assign(path);
