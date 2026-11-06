import { categoryMeta } from '@/components/marketplace/meta';
import { formatUsd } from '@/lib/money';

export interface ProviderService {
  id: string;
  name: string;
  description: string;
  category: string;
  listedMicros: string | null;
  networks: string[];
  purchasable: boolean;
}

export interface Provider {
  id: string;
  name: string;
  services: ProviderService[];
  networks: string[];
  gateway: boolean;
}

/** The cheapest call this provider offers, for a "from" price. */
export function fromPrice(provider: Provider) {
  const prices = provider.services.flatMap((service) => (service.listedMicros === null ? [] : [BigInt(service.listedMicros)]));
  return prices.length ? prices.reduce((low, price) => (price < low ? price : low)) : null;
}

export function ProviderAvatar({ name }: { name: string }) {
  return <span className="s-avatar" aria-hidden>{name.trim().charAt(0).toUpperCase() || '?'}</span>;
}

export function ProviderCard({ provider, onOpen }: { provider: Provider; onOpen: (provider: Provider) => void }) {
  const lowest = fromPrice(provider);
  const categories = [...new Set(provider.services.map((service) => categoryMeta(service.category).label))];
  const count = provider.services.length;
  return (
    <article className="s-card s-provider">
      <div className="s-provider-top">
        <ProviderAvatar name={provider.name} />
        <div className="min-w-0">
          <h2 className="s-display truncate text-[26px]">{provider.name}</h2>
          <p className="text-sm font-semibold">{count} API{count === 1 ? '' : 's'} listed</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="line-clamp-2 flex-1 text-sm text-ink-2">Offers {provider.services.slice(0, 3).map((service) => service.name).join(', ')}{count > 3 ? ' and more' : ''}.</p>
        <div className="flex flex-wrap gap-1.5">
          {categories.slice(0, 3).map((category) => <span key={category} className="s-tag s-tag-yellow">{category}</span>)}
          {provider.networks.map((network) => <span key={network} className="s-tag">{network}</span>)}
          {provider.gateway && <span className="s-tag s-tag-mint">Circle Gateway</span>}
        </div>
        <div className="flex items-end justify-between gap-2 border-t-2 border-line pt-3">
          <p>
            <span className="block text-xs font-semibold text-ink-3">From</span>
            <span className="s-price">{lowest === null ? '—' : formatUsd(lowest)}</span>
          </p>
          <button type="button" className="s-btn s-btn-sm" onClick={() => onOpen(provider)} aria-label={`View ${provider.name}`}>View provider</button>
        </div>
      </div>
    </article>
  );
}
