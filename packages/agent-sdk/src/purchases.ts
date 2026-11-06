import type { HttpClient, RawResponse } from './client.js';
import { requireServiceId } from './discovery.js';
import { ConnectionError, PaymentFailedError, PaymentUncertainError, ValidationError, errorFromResponse, type ErrorBody } from './errors.js';
import type { PurchaseOptions, PurchaseResult } from './types.js';

const KEY_PATTERN = /^[\w.:-]{8,200}$/;

interface OutcomeBody extends ErrorBody {
  status?: string;
  transactionId?: string;
}

const UNCERTAIN = 'The payment outcome is unknown and money may have moved. Repeat with the same idempotency key, or check history. Do not use a new key.';

/** Every answer that does not say what happened counts as unknown, never as failure. */
function interpret({ status, body }: RawResponse, idempotencyKey: string): PurchaseResult {
  const outcome = (body ?? {}) as OutcomeBody;
  const fields = { status, idempotencyKey, transactionId: outcome.transactionId };
  const message = typeof outcome.error === 'string' ? outcome.error : undefined;

  if (outcome.status === 'uncertain') throw new PaymentUncertainError(message ?? UNCERTAIN, { ...fields, code: 'payment_uncertain' });
  if (outcome.status === 'failed') throw new PaymentFailedError(message ?? 'The payment failed.', { ...fields, code: 'payment_failed' });

  if (status >= 200 && status < 300) {
    if (['settled', 'settling', 'pending_approval', 'free', 'simulated'].includes(outcome.status ?? '')) {
      return { ...(body as PurchaseResult), idempotencyKey };
    }
    throw new PaymentUncertainError(UNCERTAIN, { ...fields, code: 'unreadable_response' });
  }
  if (status >= 500) throw new PaymentUncertainError(UNCERTAIN, { ...fields, code: 'server_error' });
  throw errorFromResponse(status, outcome, idempotencyKey);
}

export async function purchase(http: HttpClient, options: PurchaseOptions): Promise<PurchaseResult> {
  const { serviceId, params } = options;
  requireServiceId(serviceId);
  const idempotencyKey = options.idempotencyKey ?? globalThis.crypto.randomUUID();
  if (!KEY_PATTERN.test(idempotencyKey)) {
    throw new ValidationError('idempotencyKey must be 8 to 200 letters, numbers, dots, colons, dashes or underscores.', { code: 'invalid_idempotency_key' });
  }

  let response: RawResponse;
  try {
    response = await http.raw('POST', '/api/sdk/v1/purchases', {
      authenticated: true,
      timeoutMs: http.purchaseTimeoutMs,
      body: { serviceId, idempotencyKey, network: http.network, ...(params ? { params } : {}) },
    });
  } catch (error) {
    // The request may have arrived even though the answer did not.
    if (error instanceof ConnectionError) throw new PaymentUncertainError(UNCERTAIN, { code: 'connection_lost', idempotencyKey });
    throw error;
  }
  return interpret(response, idempotencyKey);
}
