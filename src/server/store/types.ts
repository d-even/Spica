import type { NetworkId } from '@/lib/networks';
import type { ServiceCredential } from '@/server/secrets';
import type { CatalogService } from '@/server/discovery/types';
import type { SpendingPolicy, SpendState } from '@/server/firewall/policy';

export type ReservationStatus = 'held' | 'signing' | 'committed' | 'released';

export interface ReserveInput {
  userId: string;
  taskId: string;
  amountMicros: bigint;
  dailyLimitMicros: bigint;
  monthlyLimitMicros: bigint;
  taskBudgetMicros?: bigint;
  /** Identifies "the same purchase": user, resource, body, price, recipient. */
  dedupeHash: string;
  /** Binds the reservation to the exact requirement that may be signed. */
  requirementHash: string;
  now?: Date;
}

export type ReserveResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: 'duplicate' | 'daily_limit' | 'monthly_limit' | 'task_budget' };

export type VerificationStatus =
  /** Confirmed against the ledger or settlement network. */
  | 'verified'
  /** Accepted by the facilitator and awaiting batch settlement. */
  | 'settling'
  /** Seller returned data but the payment could not be independently confirmed. */
  | 'unverified'
  | 'failed'
  /** Demo mode. No money moved. */
  | 'simulated';

export interface TransactionRecord {
  id: string;
  userId: string;
  agentId: string;
  taskId: string;
  providerKey: string;
  providerName: string;
  serviceId: string;
  serviceName: string;
  resource: string;
  amountMicros: bigint;
  token: string;
  network: NetworkId;
  reference: string | null;
  payer: string | null;
  payTo: string;
  status: VerificationStatus;
  statusDetail: string | null;
  createdAt: string;
}

/** What must be replayed once a person approves. JSON-safe. */
export interface ApprovalRequest {
  service: CatalogService;
  params?: Record<string, string>;
  taskBudgetMicros?: string;
  preferredNetwork?: NetworkId;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalRecord {
  id: string;
  userId: string;
  taskId: string;
  serviceId: string;
  serviceName: string;
  providerName: string;
  amountMicros: bigint;
  network: NetworkId;
  requirementHash: string;
  reason: string;
  request: ApprovalRequest;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
}

export interface ActivityEvent {
  id: string;
  userId: string;
  transactionId: string | null;
  eventType: string;
  eventData: Record<string, unknown>;
  createdAt: string;
}

export interface ProviderRecord {
  id: string;
  ownerUserId: string;
  name: string;
  walletAddress: string;
  hederaAccount: string | null;
  createdAt: string;
}

export interface ServiceRecord {
  id: string;
  providerId: string;
  name: string;
  description: string;
  endpoint: string;
  category: string;
  priceMicros: bigint;
  supportedNetworks: NetworkId[];
  enabled: boolean;
  /** Released to a buyer only after payment. Never part of a catalog entry. */
  usageCode: string | null;
  /** Fingerprint of the provider's key, if it has one. The key itself is never on this record. */
  apiKeyHash: string | null;
  createdAt: string;
}

/** One measured interaction with a service. Reputation derives only from these. */
export interface Observation {
  serviceKey: string;
  reachable: boolean;
  succeeded: boolean;
  paid: boolean;
  latencyMs: number;
  quotedMicros: bigint | null;
  createdAt: string;
}

export interface SpendStore {
  readonly kind: 'memory' | 'supabase';

  ensureAgent(userId: string): Promise<string>;

  getPolicy(userId: string): Promise<SpendingPolicy>;
  savePolicy(policy: SpendingPolicy): Promise<void>;
  getSpendState(userId: string, taskId: string, now?: Date): Promise<SpendState>;

  /** Atomically re-checks budgets and duplicates, then holds the amount. */
  reserve(input: ReserveInput): Promise<ReserveResult>;
  /** Single-use gate in front of signing: moves held to signing exactly once. */
  beginSigning(reservationId: string, requirementHash: string): Promise<boolean>;
  commitReservation(reservationId: string): Promise<void>;
  /** Frees a hold. Refused once signing started, unless the caller knows no money moved. */
  releaseReservation(reservationId: string, options?: { paymentNotSent: boolean }): Promise<void>;

  createApproval(record: Omit<ApprovalRecord, 'id' | 'createdAt' | 'status'>): Promise<ApprovalRecord>;
  getApproval(userId: string, id: string): Promise<ApprovalRecord | null>;
  listPendingApprovals(userId: string): Promise<ApprovalRecord[]>;
  /** Atomic pending-to-decided transition. Returns null if already decided or expired. */
  decideApproval(userId: string, id: string, decision: 'approved' | 'rejected'): Promise<ApprovalRecord | null>;

  insertTransaction(record: Omit<TransactionRecord, 'id' | 'createdAt'>): Promise<TransactionRecord>;
  updateTransactionStatus(
    id: string,
    update: Pick<TransactionRecord, 'status' | 'statusDetail' | 'reference' | 'payer'>,
  ): Promise<TransactionRecord>;
  getTransaction(userId: string, id: string): Promise<TransactionRecord | null>;
  listTransactions(userId: string, limit?: number): Promise<TransactionRecord[]>;
  listTransactionsForServices(serviceIds: string[], limit?: number): Promise<TransactionRecord[]>;

  appendActivity(event: Omit<ActivityEvent, 'id' | 'createdAt'>): Promise<void>;
  listActivity(userId: string, limit?: number): Promise<ActivityEvent[]>;

  getProviderByOwner(userId: string): Promise<ProviderRecord | null>;
  getProvider(id: string): Promise<ProviderRecord | null>;
  saveProvider(record: Omit<ProviderRecord, 'id' | 'createdAt'>): Promise<ProviderRecord>;
  createService(record: Omit<ServiceRecord, 'id' | 'createdAt'>, credential?: ServiceCredential): Promise<ServiceRecord>;
  /** Server only, for calling the provider. Never return this to a client. */
  getServiceCredential(id: string): Promise<ServiceCredential | null>;
  getService(id: string): Promise<ServiceRecord | null>;
  listServices(filter?: { providerId?: string; enabledOnly?: boolean }): Promise<ServiceRecord[]>;
  deleteService(providerId: string, id: string): Promise<boolean>;

  recordObservation(observation: Omit<Observation, 'createdAt'>): Promise<void>;
  listObservations(serviceKey: string, limit?: number): Promise<Observation[]>;

  claimProof(id: string): Promise<boolean>;
  releaseProof(id: string): Promise<void>;
}
