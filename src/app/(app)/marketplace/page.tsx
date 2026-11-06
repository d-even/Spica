'use client';

import { Bot, Search, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useApi } from '@/components/api';
import { CATEGORY_LIST, type Service } from '@/components/marketplace/meta';
import { ServiceCard } from '@/components/marketplace/service-card';
import { CopyButton, TryDialog } from '@/components/marketplace/try-dialog';
import { Button, Empty, ErrorNote, Select } from '@/components/ui';
import { NETWORKS, SELECTABLE_NETWORKS } from '@/lib/networks';

interface MarketplacePage {
  services: Service[];
  total: number;
  localCount: number;
  externalTotal: number;
  pageSize: number;
  circleError: string | null;
}

const PRICE_CAPS: [string, string][] = [
  ['', 'Any price'],
  ['0.001', 'Up to $0.001'],
  ['0.01', 'Up to $0.01'],
  ['0.1', 'Up to $0.10'],
  ['1', 'Up to $1.00'],
];

const SOURCES: [string, string][] = [
  ['', 'All sources'],
  ['paygate', 'PayGate'],
  ['circle', 'Circle marketplace'],
];

type Sort = 'cheapest' | 'trusted' | 'name';

const priceOf = (service: Service) => (service.listedMicros === null ? Number.POSITIVE_INFINITY : Number(service.listedMicros));

function sortServices(services: Service[], sort: Sort) {
  const copy = [...services];
  if (sort === 'cheapest') copy.sort((a, b) => priceOf(a) - priceOf(b));
  if (sort === 'trusted') copy.sort((a, b) => (b.reputation.score ?? -1) - (a.reputation.score ?? -1));
  if (sort === 'name') copy.sort((a, b) => a.name.localeCompare(b.name));
  return copy;
}

function Skeletons() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="h-56 animate-pulse rounded-2xl border border-line bg-surface" />
      ))}
    </div>
  );
}

export default function Marketplace() {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [source, setSource] = useState('');
  const [network, setNetwork] = useState('');
  const [maxUsdPrice, setMaxUsdPrice] = useState('');
  const [sort, setSort] = useState<Sort>('cheapest');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Service | null>(null);

  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (category) params.set('category', category);
  if (source) params.set('source', source);
  if (network) params.set('network', network);
  if (maxUsdPrice) params.set('maxUsdPrice', maxUsdPrice);
  if (offset) params.set('offset', String(offset));

  const { data, error } = useApi<MarketplacePage>(`/api/marketplace?${params}`);
  const services = useMemo(() => (data ? sortServices(data.services, sort) : []), [data, sort]);

  const agentRoute = `/api/discover?query=${encodeURIComponent(query || 'weather')}${maxUsdPrice ? `&maxUsdPrice=${maxUsdPrice}` : '&maxUsdPrice=0.01'}`;
  const agentUrl = typeof window === 'undefined' ? agentRoute : `${window.location.origin}${agentRoute}`;

  const change = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setOffset(0);
  };

  function search(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setQuery(draft.trim());
  }

  const filters = (
    <>
      <Select aria-label="Source" value={source} onChange={(event) => change(setSource)(event.target.value)}>
        {SOURCES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Select aria-label="Maximum price" value={maxUsdPrice} onChange={(event) => change(setMaxUsdPrice)(event.target.value)}>
        {PRICE_CAPS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Select aria-label="Network" value={network} onChange={(event) => change(setNetwork)(event.target.value)}>
        <option value="">All networks</option>
        {SELECTABLE_NETWORKS.map((id) => (
          <option key={id} value={id}>
            {NETWORKS[id].label}
          </option>
        ))}
      </Select>
    </>
  );

  return (
    <>
      {/* Hero */}
      <section className="relative mb-8 overflow-hidden rounded-3xl border border-line bg-surface px-5 py-10 text-center shadow-card sm:px-10 sm:py-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{ background: 'radial-gradient(60% 60% at 50% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%)' }}
        />
        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-good" />
            </span>
            Live marketplace
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">
            The App Store for <span className="text-accent">AI Agents</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-ink-2 sm:text-base">
            Discover and pay for APIs per call in USDC, on Arc and Hedera.
            {data ? ` ${data.total.toLocaleString()} services listed.` : ''} No subscriptions, no API keys.
          </p>

          <form onSubmit={search} className="mx-auto mt-6 flex max-w-xl gap-2">
            <label className="relative flex-1">
              <span className="sr-only">Search services</span>
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Search APIs — weather, finance, models…"
                className="min-h-12 w-full rounded-2xl border border-line bg-surface pl-9 pr-3 text-sm shadow-card placeholder:text-ink-3"
              />
            </label>
            <Button type="submit" className="min-h-12 rounded-2xl px-5">
              Search
            </Button>
          </form>

          <div className="mx-auto mt-5 inline-flex max-w-full items-center gap-2 rounded-xl border border-dashed border-line bg-surface-2 py-1.5 pl-3 pr-1.5 text-left">
            <Bot size={14} className="shrink-0 text-ink-3" aria-hidden />
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-ink-3">Agent discovery</span>
            <code className="min-w-0 truncate font-mono text-xs text-ink-2">GET {agentRoute}</code>
            <CopyButton text={agentUrl} label="Copy discovery URL" />
          </div>
        </div>
      </section>

      {/* Mobile: category chips + collapsible filters */}
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden">
        {CATEGORY_LIST.map(({ value, label, Icon }) => (
          <button
            key={value}
            onClick={() => change(setCategory)(value)}
            aria-pressed={category === value}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${category === value ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink-2'}`}
          >
            <Icon size={14} aria-hidden /> {label}
          </button>
        ))}
      </div>
      <details className="mb-4 lg:hidden">
        <summary className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink-2">
          <SlidersHorizontal size={14} aria-hidden /> Filters
        </summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">{filters}</div>
      </details>

      <div className="lg:grid lg:grid-cols-[210px_1fr] lg:gap-6">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-6">
            <nav aria-label="Categories">
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Category</p>
              <ul className="space-y-0.5">
                {CATEGORY_LIST.map(({ value, label, Icon }) => (
                  <li key={value}>
                    <button
                      onClick={() => change(setCategory)(value)}
                      aria-current={category === value ? 'true' : undefined}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition ${category === value ? 'bg-surface font-medium text-ink shadow-card' : 'text-ink-2 hover:bg-surface'}`}
                    >
                      <Icon size={15} aria-hidden /> {label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="space-y-2">
              <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Filters</p>
              {filters}
            </div>
          </div>
        </aside>

        <section aria-labelledby="results-title" className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="results-title" className="flex items-baseline gap-2 text-lg font-semibold">
              APIs
              {data && <span className="text-xs font-medium uppercase tracking-wide text-ink-3">{data.total.toLocaleString()} results</span>}
            </h2>
            <label className="flex items-center gap-2 text-xs text-ink-3">
              Sort
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
                className="min-h-9 rounded-xl border border-line bg-surface px-2 text-sm text-ink"
              >
                <option value="cheapest">Cheapest first</option>
                <option value="trusted">Most trusted</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}
          {data?.circleError && <p className="mb-3 rounded-xl bg-warn-bg p-3 text-sm text-warn">{data.circleError}</p>}
          {!data && !error && <Skeletons />}
          {data &&
            (services.length === 0 ? (
              <Empty>No services match. Try a different search or clear the filters.</Empty>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {services.map((service) => (
                  <ServiceCard key={service.id} service={service} onTry={setSelected} />
                ))}
              </div>
            ))}

          {data && data.externalTotal > data.pageSize && (
            <div className="mt-6 flex items-center justify-between">
              <Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.pageSize))}>
                Previous
              </Button>
              <span className="text-xs text-ink-3">
                Page {Math.floor(offset / data.pageSize) + 1} of {Math.ceil(data.externalTotal / data.pageSize)}
              </span>
              <Button variant="ghost" disabled={offset + data.pageSize >= data.externalTotal} onClick={() => setOffset(offset + data.pageSize)}>
                Next
              </Button>
            </div>
          )}
        </section>
      </div>

      <TryDialog service={selected} onClose={() => setSelected(null)} />
    </>
  );
}
