'use client';

import { stringToHex } from 'viem';
import { api } from './api';

interface WalletProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

const REJECTED_BY_USER = 4001;

/** Proves ownership with a free signature. It sends no transaction. */
export async function signInWithWallet() {
  const wallet = (window as Window & { ethereum?: WalletProvider }).ethereum;
  if (!wallet) throw new Error('No wallet found. Install a browser wallet such as MetaMask, then reload this page.');

  const [address] = (await wallet.request({ method: 'eth_requestAccounts' })) as string[];
  const chainId = Number(await wallet.request({ method: 'eth_chainId' }));
  const { message } = await api<{ message: string }>('/api/auth/challenge', {
    method: 'POST',
    body: JSON.stringify({ address, chainId }),
  });
  const signature = await wallet.request({ method: 'personal_sign', params: [stringToHex(message), address] });
  await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ message, signature }) });
}

/**
 * A full page load, because the router keeps pages alive in memory. Without it,
 * a page keeps the signed-out state it had, or one wallet's data after sign-out.
 */
export const openFresh = (path: string) => window.location.assign(path);

export function walletErrorMessage(cause: unknown) {
  const { code, message } = cause as { code?: number; message: string };
  return code === REJECTED_BY_USER ? 'The request was cancelled in your wallet.' : message;
}
