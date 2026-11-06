interface ErrorFields {
  code: string;
  status?: number | undefined;
  idempotencyKey?: string | undefined;
  transactionId?: string | undefined;
}

/** Every error this SDK throws. Check `code` in logic, not the message. */
export class SpicaError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  /** The key of the purchase involved. Reuse it, rather than a new one, to check on it. */
  readonly idempotencyKey: string | undefined;
  readonly transactionId: string | undefined;

  constructor(message: string, fields: ErrorFields) {
    super(message);
    this.name = new.target.name;
    this.code = fields.code;
    this.status = fields.status;
    this.idempotencyKey = fields.idempotencyKey;
    this.transactionId = fields.transactionId;
  }
}

/** The API key is missing, invalid or expired. */
export class AuthenticationError extends SpicaError {}

/** The request itself is wrong. Sending it again will not help. */
export class ValidationError extends SpicaError {}

export class NotFoundError extends SpicaError {}

/** Too many requests. Waiting is safe. */
export class RateLimitError extends SpicaError {}

/** The server could not be reached on a read. Nothing was paid. */
export class ConnectionError extends SpicaError {}

/** The server failed on a read. Nothing was paid. */
export class ServerError extends SpicaError {}

/** The Spending Firewall refused this purchase. No payment was sent. */
export class PolicyDeniedError extends SpicaError {}

/** A spending limit would be exceeded. No payment was sent. */
export class BudgetExceededError extends PolicyDeniedError {}

/**
 * This idempotency key is already spoken for: a payment under it is in
 * progress, unresolved, or was for a different service. Do not switch to a new
 * key to get around this, or the agent may pay twice.
 */
export class DuplicateRequestError extends SpicaError {}

/** The payment failed. The server reports that it did not complete. */
export class PaymentFailedError extends SpicaError {}

/**
 * The outcome is not known, and money may have moved. Never retry with a new
 * key. Repeat with `error.idempotencyKey`, or check `history`.
 */
export class PaymentUncertainError extends SpicaError {}

const BUDGET_CODES = new Set(['per_request_limit', 'daily_limit', 'monthly_limit']);
const POLICY_CODES = new Set([
  'network_not_allowed',
  'provider_blocked',
  'provider_not_allowlisted',
  'price_changed',
  'unsupported_asset',
  'invalid_amount',
  'no_payable_network',
  'not_purchasable',
]);

export interface ErrorBody {
  error?: unknown;
  code?: unknown;
}

/** Turns an error response into the matching class. */
export function errorFromResponse(status: number, body: ErrorBody, idempotencyKey?: string): SpicaError {
  const message = typeof body.error === 'string' ? body.error : `SPICA returned HTTP ${status}.`;
  const code = typeof body.code === 'string' ? body.code : `http_${status}`;
  const fields = { code, status, idempotencyKey };
  if (BUDGET_CODES.has(code)) return new BudgetExceededError(message, fields);
  if (POLICY_CODES.has(code)) return new PolicyDeniedError(message, fields);
  if (status === 409 && code.startsWith('duplicate')) return new DuplicateRequestError(message, fields);
  if (code === 'idempotency_conflict') return new DuplicateRequestError(message, fields);
  if (status === 401) return new AuthenticationError(message, fields);
  if (status === 403) return new PolicyDeniedError(message, fields);
  if (status === 404) return new NotFoundError(message, fields);
  if (status === 429) return new RateLimitError(message, fields);
  if (status >= 400 && status < 500) return new ValidationError(message, fields);
  return new ServerError(message, fields);
}
