'use client';

import { Loader2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { openFresh, signInWithArc, walletErrorMessage } from '@/components/wallet';
import { NotificationToast } from './NotificationToast';

/** Where to go after signing in. Only paths on this site, so the link cannot send someone elsewhere. */
function nextPath() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && /^\/[a-z]/i.test(next) ? next : '/dashboard';
}

export function LoginForm() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();

  async function connect() {
    setBusy(true);
    setError(undefined);
    try {
      await signInWithArc();
      setDone(true);
      openFresh(nextPath());
    } catch (cause) {
      setError(walletErrorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="s-display">Connect your wallet</h1>
      <p className="mt-1 text-sm text-ink-2">Sign in with your wallet to manage your agent and its spending.</p>

      <div className="mt-5 space-y-3">
        {error && <NotificationToast tone="bad" title={error} />}
        {done && <NotificationToast title="You're in. Opening your dashboard…" />}
        <button type="button" className="s-btn w-full" onClick={connect} disabled={busy || done}>
          {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Wallet size={17} aria-hidden />}
          {busy ? 'Check your wallet…' : 'Connect wallet'}
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-ink-3">Arc Testnet. Signing is free and sends no transaction.</p>
    </>
  );
}
