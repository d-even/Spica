'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/components/api';
import { categoryMeta } from '@/components/marketplace/meta';
import { ProviderAvatar, ProviderCard, type Provider } from '@/components/spica/ProviderCard';
import { SPICARobot } from '@/components/spica/SPICARobot';
import { ErrorNote } from '@/components/ui';
import { formatUsd } from '@/lib/money';

function ProviderDialog({ provider, onClose }: { provider: Provider | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (provider && !dialog?.open) dialog?.showModal();
    if (!provider && dialog?.open) dialog.close();
  }, [provider]);

  return (
    <dialog ref={ref} className="s-dialog" aria-labelledby="provider-title" onClose={onClose} onClick={(event) => event.target === ref.current && ref.current?.close()}>
      {provider && (
        <>
          <div className="flex items-center gap-3 border-b-[3px] border-[#111] bg-[var(--yellow)] px-5 py-3">
            <ProviderAvatar name={provider.name} />
            <div className="min-w-0 flex-1">
              <h2 id="provider-title" className="s-display truncate text-3xl">{provider.name}</h2>
              <p className="text-sm font-semibold">
                Pays on {provider.networks.join(', ') || 'no enabled network'}
                {provider.gateway ? ' · Circle Gateway' : ''}
              </p>
              <p className="truncate font-mono text-xs" title={provider.id}>ID: {provider.id}</p>
            </div>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded-lg p-1.5 hover:bg-white/50"><X size={20} aria-hidden /></button>
          </div>
          <ul className="divide-y-2 divide-line">
            {provider.services.map((service) => (
              <li key={service.id} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="font-bold">{service.name}</p>
                  {service.description && <p className="mt-0.5 text-sm text-ink-2">{service.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="s-tag s-tag-yellow">{categoryMeta(service.category).label}</span>
                    {service.networks.map((network) => <span key={network} className="s-tag">{network}</span>)}
                    {!service.purchasable && <span className="s-tag">Not payable here</span>}
                  </div>
                </div>
                <p className="shrink-0 text-right">
                  <span className="s-price">{service.listedMicros ? formatUsd(service.listedMicros) : '—'}</span>
                  <span className="block text-xs font-semibold text-ink-3">USDC / call</span>
                </p>
              </li>
            ))}
          </ul>
          <div className="border-t-2 border-line p-4">
            <Link href="/marketplace" className="s-btn s-btn-sm">Open marketplace</Link>
          </div>
        </>
      )}
    </dialog>
  );
}

export default function Providers() {
  const { data, error } = useApi<{ providers: Provider[] }>('/api/providers');
  const [selected, setSelected] = useState<Provider | null>(null);

  return (
    <div className="s-wrap pb-20">
      <header className="s-page-head">
        <span className="s-eyebrow">Provider directory</span>
        <h1 className="s-display mt-3">Providers</h1>
        <p className="s-lead mt-2">The people and teams behind the APIs on SPICA. See what each one offers, what it costs, and how it gets paid.</p>
        <Link href="/provider" className="s-btn mt-5">Become a provider</Link>
      </header>

      {error && <ErrorNote>{error}</ErrorNote>}
      {!data && !error && <div className="s-grid" aria-hidden>{Array.from({ length: 3 }, (_, index) => <div key={index} className="s-skeleton" />)}</div>}
      {data?.providers.length === 0 && (
        <div className="s-card s-empty">
          <div className="s-crop-top w-24"><SPICARobot /></div>
          <h2 className="s-display text-3xl">No providers yet</h2>
          <p className="text-sm text-ink-2">Providers appear here once they list an API.</p>
          <Link href="/provider" className="s-btn mt-1">List your API</Link>
        </div>
      )}
      {!!data?.providers.length && (
        <div className="s-grid">
          {data.providers.map((provider) => <ProviderCard key={provider.id} provider={provider} onOpen={setSelected} />)}
        </div>
      )}
      <ProviderDialog provider={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
