/**
 * paygate-x402: framework-neutral x402 v2 seller middleware.
 *
 * Works on Web `Request`/`Response`, so it runs in Next.js route handlers,
 * Hono, Bun, Deno and Workers. All network-specific behaviour lives in a
 * `SellerAdapter`. The middleware only knows the protocol:
 *
 *   no proof            -> 402 with PAYMENT-REQUIRED
 *   proof               -> exact-match, replay claim, adapter.verify
 *   handler ok          -> adapter.settle, then release the data
 *   handler fails       -> no settlement, buyer is not charged
 */
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http';
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '@x402/core/types';

export type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse, VerifyResponse };

export const X402_VERSION = 2;

/** Network-specific seller behaviour. One adapter per payment network. */
export interface SellerAdapter {
  /** CAIP-2 network identifier, e.g. `eip155:5042002` or `hedera:testnet`. */
  readonly network: string;
  buildRequirement(input: { amountAtomic: string; payTo: string }): Promise<PaymentRequirements>;
  verify(payload: PaymentPayload, requirement: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirement: PaymentRequirements): Promise<SettleResponse>;
}

/** Stops one signed payment from unlocking a resource twice. */
export interface ReplayGuard {
  /** Atomically claims a proof. Resolves false if it was already claimed. */
  claim(proofId: string): Promise<boolean>;
  /** Frees a claim when no money moved, so the buyer can retry. */
  release(proofId: string): Promise<void>;
}

export interface PaymentOffer {
  adapter: SellerAdapter;
  amountAtomic: string;
  payTo: string;
}

export interface PaymentContext {
  payer?: string;
  requirement: PaymentRequirements;
  settlement: SettleResponse;
}

export interface WithPaymentOptions {
  offers: PaymentOffer[];
  replayGuard: ReplayGuard;
  description?: string;
  mimeType?: string;
  /** Observes every outcome. Errors here never affect the response. */
  onEvent?: (event: PaymentEvent) => void | Promise<void>;
}

export type PaymentEvent =
  | { type: 'payment_required' }
  | { type: 'rejected'; reason: string; network?: string }
  | { type: 'settled'; settlement: SettleResponse; requirement: PaymentRequirements; latencyMs: number }
  | { type: 'handler_failed'; status: number; network: string };

/** Pure comparison of what the buyer signed for against what is on offer now. */
export function requirementsMatch(a: PaymentRequirements, b: PaymentRequirements): boolean {
  return (
    a.scheme === b.scheme &&
    a.network === b.network &&
    a.amount === b.amount &&
    a.asset.toLowerCase() === b.asset.toLowerCase() &&
    a.payTo.toLowerCase() === b.payTo.toLowerCase()
  );
}

/** Stable identifier for a proof. Same bytes, same id, on any network. */
export async function proofId(payload: PaymentPayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload.payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

function paymentRequiredResponse(request: Request, accepts: PaymentRequirements[], options: WithPaymentOptions, error?: string) {
  const paymentRequired: PaymentRequired = {
    x402Version: X402_VERSION,
    error: error ?? 'Payment required',
    resource: {
      url: request.url,
      description: options.description ?? 'Paid API resource',
      mimeType: options.mimeType ?? 'application/json',
    },
    accepts,
  };
  return json(paymentRequired, 402, { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(paymentRequired) });
}

async function emit(options: WithPaymentOptions, event: PaymentEvent) {
  try {
    await options.onEvent?.(event);
  } catch (error) {
    console.error('paygate-x402: onEvent failed', error);
  }
}

/**
 * Wraps a handler so it only runs for a verified payment, and only charges when
 * the handler succeeded.
 */
export function withPayment(
  handler: (request: Request, context: { payer?: string }) => Promise<Response>,
  options: WithPaymentOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const accepts = await Promise.all(
      options.offers.map((offer) =>
        offer.adapter.buildRequirement({ amountAtomic: offer.amountAtomic, payTo: offer.payTo }),
      ),
    );

    const header = request.headers.get('PAYMENT-SIGNATURE') ?? request.headers.get('X-PAYMENT');
    if (!header) {
      await emit(options, { type: 'payment_required' });
      return paymentRequiredResponse(request, accepts, options);
    }

    const reject = async (reason: string, network?: string) => {
      await emit(options, { type: 'rejected', reason, network });
      return paymentRequiredResponse(request, accepts, options, reason);
    };

    let payload: PaymentPayload;
    try {
      payload = decodePaymentSignatureHeader(header);
    } catch {
      return reject('invalid_payment_header');
    }

    const offered = accepts.find((requirement) => requirementsMatch(requirement, payload.accepted));
    const offer = options.offers.find((candidate) => candidate.adapter.network === offered?.network);
    if (!offered || !offer) return reject('requirement_mismatch', payload.accepted?.network);

    const id = await proofId(payload);
    if (!(await options.replayGuard.claim(id))) return reject('duplicate_payment', offered.network);

    const started = Date.now();
    let settled = false;
    try {
      const verification = await offer.adapter.verify(payload, offered);
      if (!verification.isValid) {
        return await reject(verification.invalidReason ?? 'payment_invalid', offered.network);
      }

      const upstream = await handler(request, { payer: verification.payer });
      if (!upstream.ok) {
        await emit(options, { type: 'handler_failed', status: upstream.status, network: offered.network });
        return upstream;
      }

      const settlement = await offer.adapter.settle(payload, offered);
      if (!settlement.success) {
        return await reject(settlement.errorReason ?? 'settlement_failed', offered.network);
      }
      settled = true;
      await emit(options, { type: 'settled', settlement, requirement: offered, latencyMs: Date.now() - started });

      const response = new Response(upstream.body, upstream);
      response.headers.set('PAYMENT-RESPONSE', encodePaymentResponseHeader(settlement));
      response.headers.set('cache-control', 'no-store');
      return response;
    } finally {
      if (!settled) await options.replayGuard.release(id);
    }
  };
}
