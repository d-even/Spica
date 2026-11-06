import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_POLICY, type SpendingPolicy, type SpendState } from '@/server/firewall/policy';
import type { NetworkId } from '@/lib/networks';
import { HOLD_TTL_MS } from './windows';
import type {
  ActivityEvent,
  ApprovalRecord,
  Observation,
  ProviderRecord,
  ReserveInput,
  ReserveResult,
  ServiceRecord,
  SpendStore,
  TransactionRecord,
} from './types';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const big = (value: unknown) => BigInt(String(value ?? 0));

/** For queries that always return data unless they error. */
function must<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(`Database error: ${result.error.message}`);
  return result.data as NonNullable<T>;
}

/** For lookups where no row is a normal outcome. */
function maybe<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Database error: ${result.error.message}`);
  return result.data;
}

const toTransaction = (row: Row): TransactionRecord => ({
  id: row.id,
  userId: row.user_id,
  agentId: row.agent_id,
  taskId: row.task_id,
  providerKey: row.provider_key,
  providerName: row.provider_name,
  serviceId: row.service_id,
  serviceName: row.service_name,
  resource: row.resource,
  amountMicros: big(row.amount_micros),
  token: row.token,
  network: row.network,
  reference: row.tx_hash,
  payer: row.from_address,
  payTo: row.to_address,
  status: row.status,
  statusDetail: row.status_detail,
  createdAt: row.created_at,
});

const toApproval = (row: Row): ApprovalRecord => ({
  id: row.id,
  userId: row.user_id,
  taskId: row.task_id,
  serviceId: row.service_id,
  serviceName: row.service_name,
  providerName: row.provider_name,
  amountMicros: big(row.amount_micros),
  network: row.network,
  requirementHash: row.requirement_hash,
  reason: row.reason,
  request: row.request,
  status: row.status,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
});

const toProvider = (row: Row): ProviderRecord => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  name: row.name ?? '',
  walletAddress: row.wallet_address,
  hederaAccount: row.hedera_account,
  createdAt: row.created_at,
});

const toService = (row: Row): ServiceRecord => ({
  id: row.id,
  providerId: row.developer_id,
  name: row.name ?? row.endpoint,
  description: row.description ?? '',
  endpoint: row.endpoint,
  category: row.category ?? 'Other',
  priceMicros: big(row.price_micros),
  supportedNetworks: row.supported_networks ?? [],
  enabled: row.enabled ?? false,
  usageCode: row.usage_code ?? null,
  createdAt: row.created_at,
});

export class SupabaseStore implements SpendStore {
  readonly kind = 'supabase' as const;
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async ensureAgent(userId: string) {
    const row = must(
      await this.db.from('agents').upsert({ user_id: userId }, { onConflict: 'user_id' }).select('id').single(),
    );
    return row.id as string;
  }

  async getPolicy(userId: string): Promise<SpendingPolicy> {
    const row = maybe(await this.db.from('spending_policies').select('*').eq('user_id', userId).maybeSingle());
    if (!row) return { ...DEFAULT_POLICY, userId };
    return {
      userId,
      perRequestLimitMicros: big(row.per_request_limit),
      dailyLimitMicros: big(row.daily_limit),
      monthlyLimitMicros: big(row.monthly_limit),
      approvalThresholdMicros: big(row.approval_threshold),
      autoPayEnabled: row.auto_pay_enabled,
      allowedNetworks: row.allowed_networks as NetworkId[],
      allowedProviders: row.allowed_providers,
      blockedProviders: row.blocked_providers,
    };
  }

  async savePolicy(policy: SpendingPolicy) {
    must(
      await this.db.from('spending_policies').upsert(
        {
          user_id: policy.userId,
          per_request_limit: policy.perRequestLimitMicros.toString(),
          daily_limit: policy.dailyLimitMicros.toString(),
          monthly_limit: policy.monthlyLimitMicros.toString(),
          approval_threshold: policy.approvalThresholdMicros.toString(),
          auto_pay_enabled: policy.autoPayEnabled,
          allowed_networks: policy.allowedNetworks,
          allowed_providers: policy.allowedProviders,
          blocked_providers: policy.blockedProviders,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      ),
    );
  }

  async getSpendState(userId: string, taskId: string, now = new Date()): Promise<SpendState> {
    const rows = must(
      await this.db.rpc('paygate_spend_totals', { p_user: userId, p_task: taskId, p_now: now.toISOString() }),
    ) as Row[];
    const row = rows[0] ?? {};
    return {
      spentTodayMicros: big(row.today),
      spentThisMonthMicros: big(row.month),
      spentThisTaskMicros: big(row.task),
    };
  }

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    const result = must(
      await this.db.rpc('paygate_reserve_spend', {
        p_user: input.userId,
        p_task: input.taskId,
        p_amount: input.amountMicros.toString(),
        p_daily_limit: input.dailyLimitMicros.toString(),
        p_monthly_limit: input.monthlyLimitMicros.toString(),
        p_task_budget: input.taskBudgetMicros?.toString() ?? null,
        p_dedupe_hash: input.dedupeHash,
        p_requirement_hash: input.requirementHash,
      }),
    ) as Row;
    return result.ok ? { ok: true, reservationId: result.reservation_id } : { ok: false, reason: result.reason };
  }

  async beginSigning(reservationId: string, requirementHash: string) {
    const cutoff = new Date(Date.now() - HOLD_TTL_MS).toISOString();
    const rows = must(
      await this.db
        .from('spend_reservations')
        .update({ status: 'signing' })
        .eq('id', reservationId)
        .eq('status', 'held')
        .eq('requirement_hash', requirementHash)
        .gte('created_at', cutoff)
        .select('id'),
    );
    return rows.length === 1;
  }

  async commitReservation(reservationId: string) {
    must(await this.db.from('spend_reservations').update({ status: 'committed' }).eq('id', reservationId));
  }

  async releaseReservation(reservationId: string, options?: { paymentNotSent: boolean }) {
    const statuses = options?.paymentNotSent ? ['held', 'signing'] : ['held'];
    must(
      await this.db.from('spend_reservations').update({ status: 'released' }).eq('id', reservationId).in('status', statuses),
    );
  }

  async createApproval(record: Omit<ApprovalRecord, 'id' | 'createdAt' | 'status'>) {
    return toApproval(
      must(
        await this.db
          .from('payment_approvals')
          .insert({
            user_id: record.userId,
            task_id: record.taskId,
            service_id: record.serviceId,
            service_name: record.serviceName,
            provider_name: record.providerName,
            amount_micros: record.amountMicros.toString(),
            network: record.network,
            requirement_hash: record.requirementHash,
            reason: record.reason,
            request: record.request,
            expires_at: record.expiresAt,
          })
          .select('*')
          .single(),
      ),
    );
  }

  async getApproval(userId: string, id: string) {
    const row = maybe(await this.db.from('payment_approvals').select('*').eq('id', id).eq('user_id', userId).maybeSingle());
    return row ? toApproval(row) : null;
  }

  async listPendingApprovals(userId: string) {
    const rows = must(
      await this.db
        .from('payment_approvals')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }),
    );
    return rows.map(toApproval);
  }

  async decideApproval(userId: string, id: string, decision: 'approved' | 'rejected') {
    const rows = must(
      await this.db
        .from('payment_approvals')
        .update({ status: decision })
        .eq('id', id)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .select('*'),
    );
    return rows[0] ? toApproval(rows[0]) : null;
  }

  async insertTransaction(record: Omit<TransactionRecord, 'id' | 'createdAt'>) {
    return toTransaction(
      must(
        await this.db
          .from('transactions')
          .insert({
            user_id: record.userId,
            agent_id: record.agentId,
            task_id: record.taskId,
            provider_key: record.providerKey,
            provider_name: record.providerName,
            service_id: record.serviceId,
            service_name: record.serviceName,
            resource: record.resource,
            amount: record.amountMicros.toString(),
            amount_micros: record.amountMicros.toString(),
            token: record.token,
            network: record.network,
            tx_hash: record.reference,
            from_address: record.payer,
            to_address: record.payTo,
            status: record.status,
            status_detail: record.statusDetail,
            verified: record.status === 'verified',
          })
          .select('*')
          .single(),
      ),
    );
  }

  async updateTransactionStatus(id: string, update: Pick<TransactionRecord, 'status' | 'statusDetail' | 'reference' | 'payer'>) {
    return toTransaction(
      must(
        await this.db
          .from('transactions')
          .update({ status: update.status, status_detail: update.statusDetail, reference: update.reference, payer: update.payer })
          .eq('id', id)
          .select()
          .single(),
      ),
    );
  }

  async getTransaction(userId: string, id: string) {
    const row = maybe(await this.db.from('transactions').select('*').eq('id', id).eq('user_id', userId).maybeSingle());
    return row ? toTransaction(row) : null;
  }

  async listTransactions(userId: string, limit = 100) {
    const rows = must(
      await this.db
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit),
    );
    return rows.map(toTransaction);
  }

  async listTransactionsForServices(serviceIds: string[], limit = 200) {
    if (serviceIds.length === 0) return [];
    const rows = must(
      await this.db
        .from('transactions')
        .select('*')
        .in('service_id', serviceIds)
        .order('created_at', { ascending: false })
        .limit(limit),
    );
    return rows.map(toTransaction);
  }

  async appendActivity(event: Omit<ActivityEvent, 'id' | 'createdAt'>) {
    must(
      await this.db.from('audit_logs').insert({
        user_id: event.userId,
        transaction_id: event.transactionId,
        event_type: event.eventType,
        event_data: event.eventData,
      }),
    );
  }

  async listActivity(userId: string, limit = 50) {
    const rows = must(
      await this.db
        .from('audit_logs')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit),
    );
    return rows.map(
      (row: Row): ActivityEvent => ({
        id: row.id,
        userId: row.user_id,
        transactionId: row.transaction_id,
        eventType: row.event_type,
        eventData: row.event_data,
        createdAt: row.created_at,
      }),
    );
  }

  async getProviderByOwner(userId: string) {
    const row = maybe(await this.db.from('developers').select('*').eq('owner_user_id', userId).maybeSingle());
    return row ? toProvider(row) : null;
  }

  async getProvider(id: string) {
    const row = maybe(await this.db.from('developers').select('*').eq('id', id).maybeSingle());
    return row ? toProvider(row) : null;
  }

  async saveProvider(record: Omit<ProviderRecord, 'id' | 'createdAt'>) {
    return toProvider(
      must(
        await this.db
          .from('developers')
          .upsert(
            {
              owner_user_id: record.ownerUserId,
              name: record.name,
              // Legacy NOT NULL column. Wallet accounts have no email.
              email: '',
              wallet_address: record.walletAddress,
              hedera_account: record.hederaAccount,
            },
            { onConflict: 'owner_user_id' },
          )
          .select('*')
          .single(),
      ),
    );
  }

  async createService(record: Omit<ServiceRecord, 'id' | 'createdAt'>) {
    const provider = await this.getProvider(record.providerId);
    if (!provider) throw new Error('Provider not found');
    return toService(
      must(
        await this.db
          .from('apis')
          .insert({
            developer_id: record.providerId,
            name: record.name,
            description: record.description,
            endpoint: record.endpoint,
            category: record.category,
            price: record.priceMicros.toString(),
            price_micros: record.priceMicros.toString(),
            pay_to: provider.walletAddress,
            supported_networks: record.supportedNetworks,
            enabled: record.enabled,
            is_public: true,
            // Left out when empty, so listing an API works before the column exists.
            ...(record.usageCode ? { usage_code: record.usageCode } : {}),
          })
          .select('*')
          .single(),
      ),
    );
  }

  async getService(id: string) {
    const row = maybe(await this.db.from('apis').select('*').eq('id', id).maybeSingle());
    return row ? toService(row) : null;
  }

  async listServices(filter?: { providerId?: string; enabledOnly?: boolean }) {
    let query = this.db.from('apis').select('*').not('price_micros', 'is', null);
    if (filter?.providerId) query = query.eq('developer_id', filter.providerId);
    if (filter?.enabledOnly) query = query.eq('enabled', true);
    return must(await query).map(toService);
  }

  async deleteService(providerId: string, id: string) {
    const rows = must(await this.db.from('apis').delete().eq('id', id).eq('developer_id', providerId).select('id'));
    return rows.length === 1;
  }

  async recordObservation(observation: Omit<Observation, 'createdAt'>) {
    must(
      await this.db.from('service_observations').insert({
        service_key: observation.serviceKey,
        reachable: observation.reachable,
        succeeded: observation.succeeded,
        paid: observation.paid,
        latency_ms: observation.latencyMs,
        quoted_micros: observation.quotedMicros?.toString() ?? null,
      }),
    );
  }

  async listObservations(serviceKey: string, limit = 500) {
    const rows = must(
      await this.db
        .from('service_observations')
        .select('*')
        .eq('service_key', serviceKey)
        .order('created_at', { ascending: false })
        .limit(limit),
    );
    return rows.map(
      (row: Row): Observation => ({
        serviceKey: row.service_key,
        reachable: row.reachable,
        succeeded: row.succeeded,
        paid: row.paid,
        latencyMs: row.latency_ms,
        quotedMicros: row.quoted_micros === null ? null : big(row.quoted_micros),
        createdAt: row.created_at,
      }),
    );
  }

  /** Unique-key insert: the database decides which of two racing claims wins. */
  async claimProof(id: string) {
    const { error } = await this.db.from('payment_proofs').insert({ id });
    if (!error) return true;
    if (error.code === '23505') return false;
    throw new Error(`Database error: ${error.message}`);
  }

  async releaseProof(id: string) {
    must(await this.db.from('payment_proofs').delete().eq('id', id));
  }
}
