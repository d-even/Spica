'use client';

import { Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote } from '@/components/ui';
import { signInWithArc, walletErrorMessage } from '@/components/wallet';

export default function Login() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function connectArc() {
    setBusy(true);
    setError(undefined);
    try {
      await signInWithArc();
      router.push('/dashboard');
    } catch (cause) {
      setError(walletErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm" title="Sign in to PayGate">
        <p className="mb-4 text-sm text-ink-2">
          Connect your wallet and sign a message to prove it is yours. Signing is free and sends no transaction.
        </p>

        <div className="space-y-3">
          <div className="rounded-xl border border-line p-3">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium">Arc Testnet</p>
              <Badge tone="good">Available</Badge>
            </div>
            <Button className="w-full" onClick={connectArc} disabled={busy}>
              <Wallet size={16} aria-hidden />
              {busy ? 'Check your wallet…' : 'Connect wallet'}
            </Button>
          </div>

          <div className="rounded-xl border border-line p-3">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium">Hedera Testnet</p>
              <Badge>Coming soon</Badge>
            </div>
            <Button variant="ghost" className="w-full" disabled>
              <Wallet size={16} aria-hidden />
              Connect wallet
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
      </Card>
    </main>
  );
}
