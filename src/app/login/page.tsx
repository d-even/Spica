'use client';

import { Wallet } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, ErrorNote } from '@/components/ui';
import { openFresh, signInWithWallet, walletErrorMessage } from '@/components/wallet';

export default function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function connect() {
    setBusy(true);
    setError(undefined);
    try {
      await signInWithWallet();
      openFresh('/dashboard');
    } catch (cause) {
      setError(walletErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm" title="Sign in to PayGate">
        <div className="space-y-4">
          <p className="text-sm text-ink-2">Sign a message with your wallet to prove it is yours. This is free and sends no transaction.</p>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button className="w-full" disabled={busy} onClick={connect}>
            <Wallet size={16} aria-hidden /> {busy ? 'Check your wallet' : 'Connect wallet'}
          </Button>
        </div>
      </Card>
    </main>
  );
}
