'use client';

import { LogOut, Wallet } from 'lucide-react';
import { useState } from 'react';
import { api, useApi } from './api';
import { openFresh, signInWithWallet, walletErrorMessage } from './wallet';

const shorten = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Connects a wallet, or shows the connected one. Works signed in or out, in the app and on the landing page. */
export function WalletButton({ connectClassName, connectedClassName, afterConnect }: { connectClassName: string; connectedClassName: string; afterConnect?: string }) {
  const { data, reload } = useApi<{ wallet: string | null }>('/api/auth/me');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function connect() {
    setBusy(true);
    setError(undefined);
    try {
      await signInWithWallet();
      openFresh(afterConnect ?? window.location.pathname);
    } catch (cause) {
      setError(walletErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api('/api/auth/logout', { method: 'POST' });
      // App pages need a session, so a signed-out person goes to sign in.
      if (afterConnect) await reload();
      else openFresh('/login');
    } finally {
      setBusy(false);
    }
  }

  if (data?.wallet) {
    return (
      <span className={`inline-flex items-center gap-1.5 ${connectedClassName}`}>
        <Wallet size={14} aria-hidden />
        <span className="font-mono text-xs">{shorten(data.wallet)}</span>
        <button type="button" disabled={busy} onClick={disconnect} aria-label="Disconnect wallet" title="Disconnect wallet" className="ml-1 rounded-md p-1.5 opacity-70 hover:opacity-100 disabled:opacity-40">
          <LogOut size={14} aria-hidden />
        </button>
      </span>
    );
  }

  return (
    <span className="relative inline-flex">
      <button type="button" disabled={busy || !data} onClick={connect} className={`inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60 ${connectClassName}`}>
        <Wallet size={14} aria-hidden /> {busy ? 'Check your wallet' : 'Connect wallet'}
      </button>
      {error && (
        <span role="alert" className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-line bg-surface p-2.5 text-xs text-ink shadow-lg">
          {error}
        </span>
      )}
    </span>
  );
}
