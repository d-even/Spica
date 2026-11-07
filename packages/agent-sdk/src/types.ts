/** Payments run on Arc. Hedera records the audit trail and is not a payment option here. */
export type Network = 'arc-testnet';

export interface SpicaOptions {
  /** An agent key from Settings, starting `spica_`. Falls back to `SPICA_API_KEY`. */
  apiKey?: string;
  /** Defaults to `arc-testnet`. */
  network?: Network;
  /** Your SPICA server. Falls back to `SPICA_BASE_URL`. Must be https, except on localhost. */
  baseUrl?: string;
  /** Milliseconds to wait for a read. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Milliseconds to wait for a purchase. Defaults to 2 minutes. */
  purchaseTimeoutMs?: number;
  /** Replaces the global `fetch`, for tests and custom transports. */
  fetch?: typeof fetch;
}

/** Money as exact decimal strings. Never parse these into floats for arithmetic. */
export interface Price {
  /** US dollars, such as `"0.01"`. */
  usd: string;
  /** Millionths of a USDC, such as `"10000"`. */
  micros: string;
}

export interface PaymentTerm {
  network: string;
  asset: string;
  /** Amount in millionths of a USDC. */
  amount: string;
  payTo: string;
}

export interface DiscoverOptions {
  query?: string;
  category?: string;
  /** The most you would pay per call, in dollars, such as `"0.05"`. */
  maxPrice?: string;
  /** Up to 50. Defaults to 20. */
  limit?: number;
}

/** A listing from discovery. Use `inspect` for its reputation. */
export interface Service {
  id: string;
  name: string;
  description: string;
  category: string;
  provider: string;
  price: Price | null;
  accepts: PaymentTerm[];
}

/** Measured from real calls. A new listing has no score, and none is invented for it. */
export interface Reputation {
  status: 'not_enough_data' | 'scored';
  score: number | null;
  sampleSize: number;
}

export interface ServiceDetails extends Service {
  providerKey: string;
  purchasable: boolean;
  gatewayCompatible: boolean;
  reputation: Reputation;
}

export interface ComparisonRow {
  id: string;
  name: string;
  provider: string;
  price: Price | null;
  purchasable: boolean;
  gatewayCompatible: boolean;
  reputation: Reputation;
}

/** A side-by-side view. It recommends nothing and pays nothing. */
export interface Comparison {
  /** Payable services first, cheapest first. */
  services: ComparisonRow[];
  /** The cheapest payable service, or null if none can be paid. */
  cheapestId: string | null;
  /** The best measured score, or null if none has enough data. */
  highestScoredId: string | null;
}

/** The seller's live terms. A quote is not a payment, and spending rules run at purchase. */
export interface Quote {
  serviceId: string;
  network: Network;
  price: Price;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number | null;
}

export interface PurchaseOptions {
  serviceId: string;
  /**
   * Makes the purchase safe to repeat: one key can pay at most once, ever. Send
   * the same key again to check on a purchase. A key is generated if you omit
   * it, and is returned on the result and on every error.
   */
  idempotencyKey?: string;
  /** Query parameters for the API. They cannot change the price or recipient. */
  params?: Record<string, string>;
}

interface PurchaseBase {
  idempotencyKey: string;
  serviceId: string;
  /** True when this answer describes an earlier request and nothing new was attempted. */
  replayed: boolean;
}

interface PaidPurchase extends PurchaseBase {
  transactionId: string;
  price: Price;
  network: string;
  reference: string | null;
  /** The API's response. Null on a replay, because responses are not stored. */
  data: string | null;
  detail: string | null;
}

/** Confirmed by the network. The only status that means the money moved. */
export interface SettledPurchase extends PaidPurchase {
  status: 'settled';
  proofUrl: string | null;
}

/** Accepted, but not final. Repeat the purchase with the same key to check again. */
export interface SettlingPurchase extends PaidPurchase {
  status: 'settling';
}

/** Waiting for a person. Nothing has been paid. */
export interface PendingApprovalPurchase extends PurchaseBase {
  status: 'pending_approval';
  approvalId: string;
  price: Price;
  reason: string;
  expiresAt: string;
}

/** The API answered without asking for payment. */
export interface FreePurchase extends PurchaseBase {
  status: 'free';
  data: string;
}

/** A demo server. No money exists here, so this is never reported as settled. */
export interface SimulatedPurchase extends PaidPurchase {
  status: 'simulated';
}

export type PurchaseResult = SettledPurchase | SettlingPurchase | PendingApprovalPurchase | FreePurchase | SimulatedPurchase;

/** Your limits, read-only. An agent key can never change them. */
export interface Budget {
  perRequestLimit: Price;
  dailyLimit: Price;
  monthlyLimit: Price;
  approvalThreshold: Price;
  autoPayEnabled: boolean;
  spentToday: Price;
  remainingToday: Price;
  spentThisMonth: Price;
  remainingThisMonth: Price;
}

export interface HistoryOptions {
  /** Up to 100. Defaults to 20. */
  limit?: number;
  /** `nextCursor` from an earlier page. */
  cursor?: string;
}

export type PaymentStatus = 'settled' | 'settling' | 'uncertain' | 'failed' | 'simulated';

export interface HistoryItem {
  id: string;
  serviceId: string;
  serviceName: string;
  provider: string;
  price: Price;
  network: string;
  status: PaymentStatus;
  detail: string | null;
  reference: string | null;
  createdAt: string;
  /** A public link to the settlement, once final. */
  proofUrl: string | null;
  /** Public HashScan links to each Hedera audit message actually recorded. */
  auditUrls: string[];
}

export interface HistoryPage {
  items: HistoryItem[];
  nextCursor: string | null;
}
