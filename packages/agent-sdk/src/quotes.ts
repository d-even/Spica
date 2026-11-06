import type { HttpClient } from './client.js';
import { microsToPrice, requireServiceId } from './discovery.js';
import { PolicyDeniedError, SpicaError, errorFromResponse, type ErrorBody } from './errors.js';
import type { Network, Quote } from './types.js';

const CAIP2: Record<Network, string> = { 'arc-testnet': 'eip155:5042002' };

interface Term {
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
}

/** Calls the seller without paying: x402 answers 402 with its terms, and nothing is charged. */
export async function quote(http: HttpClient, { serviceId }: { serviceId: string }): Promise<Quote> {
  const { status, body } = await http.raw('GET', `/api/x402/${requireServiceId(serviceId)}`);
  if (status !== 402) {
    if (status >= 200 && status < 300) throw new SpicaError('This service did not ask for payment, so there is no quote.', { code: 'no_quote', status });
    throw errorFromResponse(status, (body ?? {}) as ErrorBody);
  }

  const term = (body as { accepts?: Term[] } | null)?.accepts?.find((item) => item.network === CAIP2[http.network]);
  if (!term) throw new PolicyDeniedError(`This service cannot be paid on ${http.network}.`, { code: 'no_payable_network', status });
  return {
    serviceId,
    network: http.network,
    price: microsToPrice(term.amount),
    asset: term.asset,
    payTo: term.payTo,
    maxTimeoutSeconds: term.maxTimeoutSeconds ?? null,
  };
}
