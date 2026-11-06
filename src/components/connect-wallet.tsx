'use client';

import { Wallet, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './ui';

/** The standard EIP-1193 provider that browser wallets inject. */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: 'accountsChanged', listener: (accounts: string[]) => void): void;
  removeListener?(event: 'accountsChanged', listener: (accounts: string[]) => void): void;
}

const injected = (): Eip1193Provider | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { ethereum?: Eip1193Provider }).ethereum;

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * Connects a browser wallet to read its address, nothing more. SPICA only
 * needs an address to receive payments, so this never asks the wallet to sign
 * or send anything.
 */
export function ConnectWallet({ address, onChange }: { address: string; onChange: (address: string) => void }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);

  // Follow account switches in the wallet while connected.
  useEffect(() => {
    const wallet = injected();
    if (!connected || !wallet?.on) return;
    const listener = (accounts: string[]) => {
      if (accounts[0]) onChange(accounts[0]);
      else setConnected(false);
    };
    wallet.on('accountsChanged', listener);
    return () => wallet.removeListener?.('accountsChanged', listener);
  }, [connected, onChange]);

  async function connect() {
    const wallet = injected();
    setError(undefined);
    if (!wallet) {
      setError('No browser wallet found. Install MetaMask or another wallet, or paste your address below.');
      return;
    }
    setBusy(true);
    try {
      const accounts = (await wallet.request({ method: 'eth_requestAccounts' })) as string[];
      if (!accounts[0]) throw new Error('The wallet did not share an address.');
      onChange(accounts[0]);
      setConnected(true);
    } catch (cause) {
      const code = (cause as { code?: number }).code;
      setError(code === 4001 ? 'Connection cancelled in the wallet.' : (cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {connected && address ? (
        <div className="flex min-h-10 items-center justify-between gap-2 rounded-xl border border-line bg-good-bg px-3 text-sm text-good">
          <span className="flex min-w-0 items-center gap-2">
            <Wallet size={15} aria-hidden />
            <span className="truncate font-mono" title={address}>
              {short(address)}
            </span>
            <span className="text-xs">Connected</span>
          </span>
          <button type="button" onClick={() => setConnected(false)} aria-label="Disconnect wallet" className="rounded-lg p-1 hover:bg-surface/50">
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : (
        <Button type="button" variant="ghost" className="w-full" onClick={connect} disabled={busy}>
          <Wallet size={15} aria-hidden /> {busy ? 'Check your wallet…' : address ? 'Use a different wallet' : 'Connect wallet'}
        </Button>
      )}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
