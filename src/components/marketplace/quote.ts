import { networkByCaip2 } from '@/lib/networks';
import type { Service } from './meta';

export interface QuoteTerm {
  network: string;
  amountAtomic: string;
  payTo: string;
}

export type Quote = { status: 'loading' } | { status: 'ready'; terms: QuoteTerm[] } | { status: 'failed'; message: string };

const fromOffers = (service: Service): QuoteTerm[] =>
  service.offers.map((offer) => ({ network: networkByCaip2(service.allNetworks[0] ?? '')?.label ?? offer.network, amountAtomic: offer.amountMicros, payTo: offer.payTo }));

/**
 * Asks the seller for its live terms. Calling an x402 endpoint without payment
 * answers 402 with the terms, and nothing is charged. Circle listings live on
 * other origins, so those show the terms from their catalog entry.
 */
export async function fetchQuote(service: Service): Promise<Quote> {
  if (service.source === 'circle') return { status: 'ready', terms: fromOffers(service) };
  try {
    const response = await fetch(`/api/x402/${encodeURIComponent(service.id)}`, { cache: 'no-store' });
    if (response.status !== 402) return { status: 'failed', message: 'The provider did not return a quote. Try again shortly.' };
    const body = (await response.json()) as { accepts?: { network: string; amount: string; payTo: string }[] };
    const terms = (body.accepts ?? []).map(({ network, amount, payTo }) => ({ network: networkByCaip2(network)?.label ?? network, amountAtomic: amount, payTo }));
    return terms.length ? { status: 'ready', terms } : { status: 'failed', message: 'The quote came back empty.' };
  } catch {
    return { status: 'failed', message: 'Could not reach the provider. Try again shortly.' };
  }
}
