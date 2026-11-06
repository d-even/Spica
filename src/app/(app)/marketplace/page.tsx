'use client';

import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useApi, type ReputationDto } from '@/components/api';
import { Badge, Button, Card, Empty, ErrorNote, Input, Loading, PageHeader, Select } from '@/components/ui';
import type { CatalogService } from '@/server/discovery/types';
import { formatUsd } from '@/lib/money';
import { NETWORKS, SELECTABLE_NETWORKS, networkByCaip2 } from '@/lib/networks';

type Service = CatalogService & { reputation: ReputationDto };

const CATEGORIES: [string, string][] = [
  ['', 'All categories'],
  ['FINANCIAL_ANALYSIS', 'Finance'],
  ['WEB_SEARCH_RESEARCH', 'Search and research'],
  ['SOCIAL_INTELLIGENCE', 'Social'],
  ['PREDICTION_MARKETS', 'Prediction markets'],
  ['CREATIVE', 'Creative'],
  ['INFRASTRUCTURE', 'Infrastructure'],
];

function ServiceCard({ service }: { service: Service }) {
  const networks = [...new Set(service.allNetworks.flatMap((id) => networkByCaip2(id)?.label ?? []))];
  const { reputation } = service;
  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-sm font-semibold">{service.name}</h2>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{service.listedMicros ? formatUsd(service.listedMicros) : 'Unpriced'}</span>
      </div>
      <p className="mt-1 line-clamp-3 flex-1 text-sm text-ink-2">{service.description || 'No description provided.'}</p>
      <dl className="mt-3 space-y-1 text-xs text-ink-3">
        <div className="flex justify-between gap-2">
          <dt>Provider</dt>
          <dd className="truncate text-ink-2">{service.providerName}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Provider ID</dt>
          <dd className="truncate font-mono">{service.providerKey}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Reputation</dt>
          <dd className="text-ink-2">{reputation.status === 'scored' ? `${reputation.score} / 100 from ${reputation.sampleSize} calls` : 'Not enough data'}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {networks.slice(0, 3).map((label) => (
          <Badge key={label}>{label}</Badge>
        ))}
        {!service.purchasable && <Badge tone="warn">Not payable here</Badge>}
        {service.source !== 'circle' && <Badge tone="info">PayGate</Badge>}
      </div>
    </Card>
  );
}

export default function Marketplace() {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [network, setNetwork] = useState('');
  const [offset, setOffset] = useState(0);

  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (category) params.set('category', category);
  if (network) params.set('network', network);
  if (offset) params.set('offset', String(offset));

  const { data, error } = useApi<{ services: Service[]; total: number; pageSize: number }>(`/api/marketplace?${params}`);

  function search(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setQuery(draft.trim());
  }

  return (
    <>
      <PageHeader title="Marketplace" description="Live paid APIs from the Circle Agent Marketplace, plus services sold through PayGate." />
      <form onSubmit={search} className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_200px_180px_auto]">
        <Input aria-label="Search services" placeholder="Search services" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <Select aria-label="Category" value={category} onChange={(event) => { setCategory(event.target.value); setOffset(0); }}>
          {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select aria-label="Network" value={network} onChange={(event) => { setNetwork(event.target.value); setOffset(0); }}>
          <option value="">All networks</option>
          {SELECTABLE_NETWORKS.map((id) => <option key={id} value={id}>{NETWORKS[id].label}</option>)}
        </Select>
        <Button type="submit" variant="ghost"><Search size={15} aria-hidden /> Search</Button>
      </form>

      {error && <ErrorNote>{error}</ErrorNote>}
      {!data && !error && <Loading />}
      {data && (
        <>
          <p className="mb-3 text-xs text-ink-3">{data.total.toLocaleString()} services in the catalog</p>
          {data.services.length === 0 ? (
            <Empty>No services match that search.</Empty>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.services.map((service) => <ServiceCard key={service.id} service={service} />)}
            </div>
          )}
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.pageSize))}>Previous</Button>
            <Button variant="ghost" disabled={offset + data.pageSize >= data.total} onClick={() => setOffset(offset + data.pageSize)}>Next</Button>
          </div>
        </>
      )}
    </>
  );
}
