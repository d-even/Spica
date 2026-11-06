'use client';

import { Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { stringToHex } from 'viem';
import { api } from '@/components/api';
import { Button, Card, ErrorNote } from '@/components/ui';

interface WalletProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

const REJECTED_BY_USER = 4001;

async function signIn() {
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

export default function Login() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function connect() {
    setBusy(true);
    setError(undefined);
    try {
      await signIn();
      router.push('/dashboard');
    } catch (cause) {
      const { code, message } = cause as { code?: number; message: string };
      setError(code === REJECTED_BY_USER ? 'The request was cancelled in your wallet.' : message);
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
