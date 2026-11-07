'use client';

import { Check, Plus, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui';
import { categoryMeta, hostOf, type Service } from '@/components/marketplace/meta';
import { formatUsd } from '@/lib/money';
import { networkByCaip2 } from '@/lib/networks';

/** Measured from real calls only. A listing with no history says so. */
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

export function ApiCard({ service, compared, onDetails, onQuote, onCompare }: {
  service: Service;
  compared: boolean;
  onDetails: (service: Service) => void;
  onQuote: (service: Service) => void;
  onCompare: (service: Service) => void;
}) {
  const { Icon, label } = categoryMeta(service.category);
  const networks = [...new Set(service.allNetworks.flatMap((id) => networkByCaip2(id)?.label ?? []))];

  return (
    <article className="s-card s-api">
      <div className="flex items-start justify-between gap-2">
        <span className="s-api-icon" title={label}><Icon size={20} aria-hidden /></span>
        <TrustBadge service={service} />
      </div>
      <h3 className="mt-3 line-clamp-1">{service.name}</h3>
      <p className="truncate text-sm text-ink-2">by {service.providerName}</p>
      <p className="mt-2 line-clamp-2 flex-1 text-sm text-ink-2">{service.description || `Served from ${hostOf(service.endpoint)}.`}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="s-tag s-tag-yellow">{label}</span>
        {networks.slice(0, 2).map((network) => <span key={network} className="s-tag">{network}</span>)}
        {service.supportsGateway && <span className="s-tag s-tag-mint">Circle Gateway</span>}
      </div>

      <div className="mt-4 flex items-end justify-between gap-2 border-t-2 border-line pt-3">
        <p>
          <span className="s-price">{service.listedMicros ? formatUsd(service.listedMicros) : '—'}</span>{' '}
          <span className="text-xs font-semibold text-ink-3">USDC / call</span>
        </p>
        <button type="button" className="s-chip" style={{ minHeight: 32 }} aria-pressed={compared} onClick={() => onCompare(service)}>
          {compared ? <Check size={13} aria-hidden /> : <Plus size={13} aria-hidden />} Compare
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="s-btn s-btn-sm s-btn-plain" onClick={() => onDetails(service)} aria-label={`Details for ${service.name}`}>Details</button>
        <button type="button" className="s-btn s-btn-sm" onClick={() => onQuote(service)} aria-label={`Get a quote for ${service.name}`} disabled={!service.purchasable}>Get Quote</button>
      </div>
      {!service.purchasable && <p className="mt-2 text-xs font-medium text-warn">Not payable on the networks enabled here.</p>}
    </article>
  );
}
