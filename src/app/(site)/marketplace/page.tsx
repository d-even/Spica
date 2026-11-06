'use client';

import { Bot, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useApi } from '@/components/api';
import { CompareDialog } from '@/components/marketplace/compare-dialog';
import { CATEGORY_LIST, type Service } from '@/components/marketplace/meta';
import { fetchQuote, type Quote } from '@/components/marketplace/quote';
import { CopyButton, TryDialog } from '@/components/marketplace/try-dialog';
import { ApiCard } from '@/components/spica/ApiCard';
import { NotificationToast } from '@/components/spica/NotificationToast';
import { SPICARobot } from '@/components/spica/SPICARobot';
import { ErrorNote } from '@/components/ui';
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

const COMPARE_LIMIT = 3;

type Sort = 'cheapest' | 'trusted' | 'name';

const priceOf = (service: Service) => (service.listedMicros === null ? Number.POSITIVE_INFINITY : Number(service.listedMicros));

function sortServices(services: Service[], sort: Sort) {
  const copy = [...services];
  if (sort === 'cheapest') copy.sort((a, b) => priceOf(a) - priceOf(b));
  if (sort === 'trusted') copy.sort((a, b) => (b.reputation.score ?? -1) - (a.reputation.score ?? -1));
  if (sort === 'name') copy.sort((a, b) => a.name.localeCompare(b.name));
  return copy;
}

export default function Marketplace() {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [network, setNetwork] = useState('');
  const [maxUsdPrice, setMaxUsdPrice] = useState('');
  const [sort, setSort] = useState<Sort>('cheapest');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Service | null>(null);
  const [quote, setQuote] = useState<Quote>();
  const [compared, setCompared] = useState<Service[]>([]);
  const [comparing, setComparing] = useState(false);
  const [toast, setToast] = useState<string>();

  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (category) params.set('category', category);
  if (network) params.set('network', network);
  if (maxUsdPrice) params.set('maxUsdPrice', maxUsdPrice);
  if (offset) params.set('offset', String(offset));

  const { data, error, stale } = useApi<MarketplacePage>(`/api/marketplace?${params}`);
  const services = useMemo(() => (data ? sortServices(data.services, sort) : []), [data, sort]);
  const filtered = !!(query || category || network || maxUsdPrice);

  const agentRoute = `/api/discover?query=${encodeURIComponent(query || 'weather')}${maxUsdPrice ? `&maxUsdPrice=${maxUsdPrice}` : '&maxUsdPrice=0.01'}`;
  const agentUrl = typeof window === 'undefined' ? agentRoute : `${window.location.origin}${agentRoute}`;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), 3_000);
    return () => clearTimeout(timer);
  }, [toast]);

  const change = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setOffset(0);
  };

  function search(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setQuery(draft.trim());
  }

  function openDetails(service: Service) {
    setQuote(undefined);
    setSelected(service);
  }

  async function requestQuote(service: Service) {
    setSelected(service);
    setQuote({ status: 'loading' });
    setQuote(await fetchQuote(service));
  }

  function toggleCompare(service: Service) {
    if (compared.some((item) => item.id === service.id)) {
      setCompared(compared.filter((item) => item.id !== service.id));
    } else if (compared.length >= COMPARE_LIMIT) {
      setToast(`Compare up to ${COMPARE_LIMIT} services at a time.`);
    } else {
      setCompared([...compared, service]);
    }
  }

  return (
    <div className="s-wrap pb-24">
      {toast && <NotificationToast tone="warn" title={toast} fixed />}

      <header className="s-page-head">
        <span className="s-eyebrow">API discovery</span>
        <h1 className="s-display mt-3">Marketplace</h1>
        <p className="s-lead mt-2">Find APIs your agents can pay for per call in USDC.{data ? ` ${data.total.toLocaleString()} listed.` : ''}</p>
      </header>

      <form onSubmit={search} className="flex gap-2">
        <label className="s-search">
          <span className="sr-only">Search services</span>
          <Search size={18} aria-hidden />
          <input className="s-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Search services" />
        </label>
        <button type="submit" className="s-btn">Search</button>
      </form>

      <div className="s-chips mt-3" role="group" aria-label="Category">
        {CATEGORY_LIST.map(({ value, label, Icon }) => (
          <button key={value} type="button" className="s-chip" aria-pressed={category === value} onClick={() => change(setCategory)(value)}>
            <Icon size={14} aria-hidden /> {label}
          </button>
        ))}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button type="button" className="s-chip s-chip-network" aria-pressed={network === 'arc-testnet'} onClick={() => change(setNetwork)(network === 'arc-testnet' ? '' : 'arc-testnet')}>
          Arc Testnet
        </button>
        <select aria-label="Maximum price" className="s-select" value={maxUsdPrice} onChange={(event) => change(setMaxUsdPrice)(event.target.value)}>
          {PRICE_CAPS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="Network" className="s-select" value={network} onChange={(event) => change(setNetwork)(event.target.value)}>
          <option value="">All networks</option>
          {SELECTABLE_NETWORKS.map((id) => <option key={id} value={id}>{NETWORKS[id].label}</option>)}
        </select>
        <select aria-label="Sort" className="s-select sm:ml-auto" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          <option value="cheapest">Cheapest first</option>
          <option value="trusted">Most trusted</option>
          <option value="name">Name</option>
        </select>
      </div>

      <section aria-label="Results" aria-busy={stale} className={`mt-6 transition-opacity ${stale ? 'opacity-50' : ''}`}>
        {error && <ErrorNote>{error}</ErrorNote>}
        {data?.circleError && <p className="mb-3 rounded-xl bg-warn-bg p-3 text-sm text-warn">{data.circleError}</p>}
        {!data && !error && <div className="s-grid" aria-hidden>{Array.from({ length: 6 }, (_, index) => <div key={index} className="s-skeleton" />)}</div>}
        {data && services.length === 0 && (
          <div className="s-card s-empty">
            <div className="s-crop-top w-24"><SPICARobot /></div>
            {filtered ? (
              <>
                <h2 className="s-display text-3xl">No services match</h2>
                <p className="text-sm text-ink-2">Try a different search or clear the filters.</p>
              </>
            ) : (
              <>
                <h2 className="s-display text-3xl">No APIs are listed yet</h2>
                <p className="text-sm text-ink-2">Providers add their own APIs here. Yours could be the first.</p>
                <Link href="/provider" className="s-btn mt-1">List your API</Link>
              </>
            )}
          </div>
        )}
        {services.length > 0 && (
          <div className="s-grid">
            {services.map((service) => (
              <ApiCard
                key={service.id}
                service={service}
                compared={compared.some((item) => item.id === service.id)}
                onDetails={openDetails}
                onQuote={requestQuote}
                onCompare={toggleCompare}
              />
            ))}
          </div>
        )}
        {data && data.externalTotal > data.pageSize && (
          <div className="mt-6 flex items-center justify-between">
            <button type="button" className="s-btn s-btn-sm s-btn-plain" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.pageSize))}>Previous</button>
            <span className="text-xs text-ink-3">Page {Math.floor(offset / data.pageSize) + 1} of {Math.ceil(data.externalTotal / data.pageSize)}</span>
            <button type="button" className="s-btn s-btn-sm s-btn-plain" disabled={offset + data.pageSize >= data.externalTotal} onClick={() => setOffset(offset + data.pageSize)}>Next</button>
          </div>
        )}
      </section>

      <div className="mt-8 flex max-w-full items-center gap-2 rounded-xl border-2 border-dashed border-[#111] bg-surface-2 py-1.5 pl-3 pr-1.5">
        <Bot size={14} className="shrink-0" aria-hidden />
        <span className="shrink-0 font-mono text-[11px] font-bold uppercase">Agent discovery</span>
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink-2">GET {agentRoute}</code>
        <CopyButton text={agentUrl} label="Copy discovery URL" />
      </div>

      {compared.length > 0 && !comparing && (
        <div className="s-tray">
          <span>{compared.length} of {COMPARE_LIMIT} selected</span>
          <span className="flex items-center gap-1.5">
            <button type="button" className="s-btn s-btn-sm s-btn-plain" disabled={compared.length < 2} onClick={() => setComparing(true)}>Compare</button>
            <button type="button" className="grid size-9 place-items-center rounded-lg hover:bg-white/50" aria-label="Clear comparison" onClick={() => setCompared([])}><X size={17} aria-hidden /></button>
          </span>
        </div>
      )}

      <TryDialog service={selected} quote={quote} onQuote={requestQuote} onClose={() => setSelected(null)} />
      <CompareDialog open={comparing} services={compared} onClose={() => setComparing(false)} />
    </div>
  );
}
