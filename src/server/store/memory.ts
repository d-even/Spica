/**
 * In-memory SpendStore for demo mode and tests. Data resets on restart.
 *
 * `reserve` has no `await` in its critical section, so on one Node event loop
 * it is atomic: concurrent calls run one after another. It is not safe across
 * several server instances, which is why production uses the Postgres function.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_POLICY, type SpendingPolicy, type SpendState } from '@/server/firewall/policy';
import type { ServiceCredential } from '@/server/secrets';
import { DEDUPE_WINDOW_MS, HOLD_TTL_MS, monthStart, dayStart } from './windows';
import type {
  ActivityEvent,
  ApprovalRecord,
  Observation,
  ProviderRecord,
  ReservationStatus,
  ReserveInput,
  ReserveResult,
  ServiceRecord,
  SpendStore,
  TransactionRecord,
} from './types';

interface Reservation extends Pick<ReserveInput, 'userId' | 'taskId' | 'amountMicros' | 'dedupeHash' | 'requirementHash'> {
  id: string;
  status: ReservationStatus;
  createdAt: Date;
}

export class MemoryStore implements SpendStore {
  readonly kind = 'memory' as const;
  private agents = new Map<string, string>();
  private policies = new Map<string, SpendingPolicy>();
  private reservations = new Map<string, Reservation>();
  private approvals = new Map<string, ApprovalRecord>();
  private transactions: TransactionRecord[] = [];
  private credentials = new Map<string, ServiceCredential>();
  private activity: ActivityEvent[] = [];
  private providers = new Map<string, ProviderRecord>();
  private services = new Map<string, ServiceRecord>();
  private observations: Observation[] = [];
  private proofs = new Set<string>();

  async ensureAgent(userId: string) {
    let id = this.agents.get(userId);
    if (!id) {
      id = randomUUID();
      this.agents.set(userId, id);
    }
    return id;
  }

  async getPolicy(userId: string) {
    return this.policies.get(userId) ?? { ...DEFAULT_POLICY, userId };
  }

  async savePolicy(policy: SpendingPolicy) {
    this.policies.set(policy.userId, policy);
  }

  /** Held and signing amounts count: money may be on its way. */
  private live(reservation: Reservation, now: Date) {
    if (reservation.status === 'released') return false;
    if (reservation.status === 'held' && now.getTime() - reservation.createdAt.getTime() > HOLD_TTL_MS) return false;
    return true;
  }

  private spendState(userId: string, taskId: string, now: Date): SpendState {
    const today = dayStart(now);
    const month = monthStart(now);
    const state: SpendState = { spentTodayMicros: 0n, spentThisMonthMicros: 0n, spentThisTaskMicros: 0n };
    for (const reservation of this.reservations.values()) {
      if (reservation.userId !== userId || !this.live(reservation, now)) continue;
      if (reservation.createdAt >= today) state.spentTodayMicros += reservation.amountMicros;
      if (reservation.createdAt >= month) state.spentThisMonthMicros += reservation.amountMicros;
      if (reservation.taskId === taskId) state.spentThisTaskMicros += reservation.amountMicros;
    }
    return state;
  }

  async getSpendState(userId: string, taskId: string, now = new Date()) {
    return this.spendState(userId, taskId, now);
  }

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    const now = input.now ?? new Date();
    for (const reservation of this.reservations.values()) {
      if (
        reservation.userId === input.userId &&
        reservation.dedupeHash === input.dedupeHash &&
        this.live(reservation, now) &&
        now.getTime() - reservation.createdAt.getTime() < DEDUPE_WINDOW_MS
      ) {
        return { ok: false, reason: 'duplicate' };
      }
    }
    const state = this.spendState(input.userId, input.taskId, now);
    if (input.taskBudgetMicros !== undefined && state.spentThisTaskMicros + input.amountMicros > input.taskBudgetMicros) {
      return { ok: false, reason: 'task_budget' };
    }
    if (state.spentTodayMicros + input.amountMicros > input.dailyLimitMicros) return { ok: false, reason: 'daily_limit' };
    if (state.spentThisMonthMicros + input.amountMicros > input.monthlyLimitMicros) {
      return { ok: false, reason: 'monthly_limit' };
    }
    const id = randomUUID();
    this.reservations.set(id, {
      id,
      userId: input.userId,
      taskId: input.taskId,
      amountMicros: input.amountMicros,
      dedupeHash: input.dedupeHash,
      requirementHash: input.requirementHash,
      status: 'held',
      createdAt: now,
    });
    return { ok: true, reservationId: id };
  }

  async beginSigning(reservationId: string, requirementHash: string) {
    const reservation = this.reservations.get(reservationId);
    if (!reservation || reservation.status !== 'held' || reservation.requirementHash !== requirementHash) return false;
    reservation.status = 'signing';
    return true;
  }

  async commitReservation(reservationId: string) {
    const reservation = this.reservations.get(reservationId);
    if (reservation) reservation.status = 'committed';
  }

  async releaseReservation(reservationId: string, options?: { paymentNotSent: boolean }) {
    const reservation = this.reservations.get(reservationId);
    if (!reservation || reservation.status === 'committed') return;
    if (reservation.status === 'signing' && !options?.paymentNotSent) return;
    reservation.status = 'released';
  }

  async createApproval(record: Omit<ApprovalRecord, 'id' | 'createdAt' | 'status'>) {
    const approval: ApprovalRecord = { ...record, id: randomUUID(), status: 'pending', createdAt: new Date().toISOString() };
    this.approvals.set(approval.id, approval);
    return approval;
  }

  async getApproval(userId: string, id: string) {
    const approval = this.approvals.get(id);
    return approval?.userId === userId ? approval : null;
  }

  async listPendingApprovals(userId: string) {
    const now = Date.now();
    return [...this.approvals.values()].filter(
      (approval) => approval.userId === userId && approval.status === 'pending' && Date.parse(approval.expiresAt) > now,
    );
  }

  async decideApproval(userId: string, id: string, decision: 'approved' | 'rejected') {
    const approval = this.approvals.get(id);
    if (!approval || approval.userId !== userId || approval.status !== 'pending') return null;
    if (Date.parse(approval.expiresAt) <= Date.now()) {
      approval.status = 'expired';
      return null;
    }
    approval.status = decision;
    return approval;
  }

  async insertTransaction(record: Omit<TransactionRecord, 'id' | 'createdAt'>) {
    const transaction: TransactionRecord = { ...record, id: randomUUID(), createdAt: new Date().toISOString() };
    this.transactions.unshift(transaction);
    return transaction;
  }

  async updateTransactionStatus(id: string, update: Pick<TransactionRecord, 'status' | 'statusDetail' | 'reference' | 'payer'>) {
    const transaction = this.transactions.find((tx) => tx.id === id);
    if (!transaction) throw new Error('Transaction not found.');
    return Object.assign(transaction, update);
  }

  async getTransaction(userId: string, id: string) {
    return this.transactions.find((tx) => tx.id === id && tx.userId === userId) ?? null;
  }

  async listTransactions(userId: string, limit = 100) {
    return this.transactions.filter((tx) => tx.userId === userId).slice(0, limit);
  }

  async listTransactionsForServices(serviceIds: string[], limit = 200) {
    return this.transactions.filter((tx) => serviceIds.includes(tx.serviceId)).slice(0, limit);
  }

  async appendActivity(event: Omit<ActivityEvent, 'id' | 'createdAt'>) {
    this.activity.unshift({ ...event, id: randomUUID(), createdAt: new Date().toISOString() });
  }

  async listActivity(userId: string, limit = 50) {
    return this.activity.filter((event) => event.userId === userId).slice(0, limit);
  }

  async getProviderByOwner(userId: string) {
    return [...this.providers.values()].find((provider) => provider.ownerUserId === userId) ?? null;
  }

  async getProvider(id: string) {
    return this.providers.get(id) ?? null;
  }

  async saveProvider(record: Omit<ProviderRecord, 'id' | 'createdAt'>) {
    const existing = await this.getProviderByOwner(record.ownerUserId);
    const provider: ProviderRecord = {
      ...record,
      id: existing?.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    this.providers.set(provider.id, provider);
    return provider;
  }

  async createService(record: Omit<ServiceRecord, 'id' | 'createdAt'>, credential?: ServiceCredential) {
    const service: ServiceRecord = { ...record, id: randomUUID(), createdAt: new Date().toISOString() };
    this.services.set(service.id, service);
    if (credential) this.credentials.set(service.id, credential);
    return service;
  }

  async getServiceCredential(id: string) {
    return this.credentials.get(id) ?? null;
  }

  async getService(id: string) {
    return this.services.get(id) ?? null;
  }

  async listServices(filter?: { providerId?: string; enabledOnly?: boolean }) {
    return [...this.services.values()].filter(
      (service) =>
        (!filter?.providerId || service.providerId === filter.providerId) && (!filter?.enabledOnly || service.enabled),
    );
  }

  async deleteService(providerId: string, id: string) {
    const service = this.services.get(id);
    if (service?.providerId !== providerId) return false;
    return this.services.delete(id);
  }

  async recordObservation(observation: Omit<Observation, 'createdAt'>) {
    this.observations.unshift({ ...observation, createdAt: new Date().toISOString() });
  }

  async listObservations(serviceKey: string, limit = 500) {
    return this.observations.filter((item) => item.serviceKey === serviceKey).slice(0, limit);
  }

  async claimProof(id: string) {
    if (this.proofs.has(id)) return false;
    this.proofs.add(id);
    return true;
  }

  async releaseProof(id: string) {
    this.proofs.delete(id);
  }
}
