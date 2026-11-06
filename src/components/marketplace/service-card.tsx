'use client';

import { ShieldCheck, Zap } from 'lucide-react';
import { Badge } from '@/components/ui';
import { formatUsd } from '@/lib/money';
import { networkByCaip2 } from '@/lib/networks';
import { categoryMeta, hostOf, type Service } from './meta';

export function TrustBadge({ service }: { service: Service }) {
  const { reputation } = service;
  if (reputation.status !== 'scored' || reputation.score === null) return <Badge>New</Badge>;
  const tone = reputation.score >= 80 ? 'good' : reputation.score >= 50 ? 'warn' : 'bad';
  return (
    <Badge tone={tone}>
      <ShieldCheck size={12} aria-hidden /> {reputation.score} trust
    </Badge>
  );
}

export function ServiceCard({ service, onTry }: { service: Service; onTry: (service: Service) => void }) {
  const { Icon, label } = categoryMeta(service.category);
  const networks = [...new Set(service.allNetworks.flatMap((id) => networkByCaip2(id)?.label ?? []))];

  return (
    <article className="rise group flex h-full flex-col rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-accent/40">
      <div className="flex items-start justify-between gap-2">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-2" title={label}>
          <Icon size={18} aria-hidden />
        </span>
        <div className="flex flex-wrap justify-end gap-1.5">
          {service.source !== 'circle' && (
            <Badge tone="info">
              <Zap size={12} aria-hidden /> PayGate
            </Badge>
          )}
          <TrustBadge service={service} />
        </div>
      </div>

      <h3 className="mt-3 line-clamp-1 text-sm font-semibold">{service.name}</h3>
      <p className="truncate font-mono text-xs text-ink-3">{hostOf(service.endpoint)}</p>
      <p className="mt-2 line-clamp-2 flex-1 text-sm text-ink-2">{service.description || 'No description provided.'}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge>{label}</Badge>
        {networks.slice(0, 2).map((network) => (
          <Badge key={network}>{network}</Badge>
        ))}
        {networks.length > 2 && <Badge>+{networks.length - 2}</Badge>}
        {service.supportsGateway && <Badge tone="good">Nanopayments</Badge>}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3 border-t border-line pt-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-3">Price per call</p>
          <p className="text-base font-semibold tabular-nums">
            {service.listedMicros ? formatUsd(service.listedMicros) : '—'} <span className="text-xs font-normal text-ink-3">USDC</span>
          </p>
        </div>
        <button
          onClick={() => onTry(service)}
          className="inline-flex min-h-9 items-center rounded-xl bg-ink px-3.5 text-sm font-medium text-bg transition hover:opacity-90"
          aria-label={`Try ${service.name}`}
        >
          Try API
        </button>
      </div>
      {!service.purchasable && <p className="mt-2 text-xs text-warn">Not payable on the networks enabled here.</p>}
    </article>
  );
}
