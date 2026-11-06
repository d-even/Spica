import 'server-only';
import { createHash } from 'node:crypto';
import { connection } from 'next/server';
import { ZodError } from 'zod';
import { formatUsd, microsToUsd } from '@/lib/money';
import type { NetworkId } from '@/lib/networks';
import { settlementProof, auditProof } from '@/lib/proof';
import { readAgentKey, type AgentKeyGrant } from '@/server/api-keys';
import { resolveService } from '@/server/discovery/catalog';
import { apiError, toJson } from '@/server/http/api';
import { allowRequest } from '@/server/http/rate-limit';
import { purchase } from '@/server/purchase';
import { refreshTransaction, refreshTransactions } from '@/server/settlement';
import type { ActivityEvent, ApprovalRecord, SpendStore, TransactionRecord } from '@/server/store/types';

/** How far back a repeated key is looked up. Older ones are still held to one payment by the reservation. */
const REPLAY_LOOKBACK = 200;
const HISTORY_LOOKBACK = 200;

const price = (micros: bigint) => ({ usd: microsToUsd(micros), micros: micros.toString() });

/** Only `verified` becomes `settled`. Nothing else may ever read as paid. */
const STATUS = { verified: 'settled', settling: 'settling', unverified: 'uncertain', failed: 'failed', simulated: 'simulated' } as const;

/** Authenticates an agent key. Session cookies do not work here, and agent keys work nowhere else. */
export function agentRoute<Args extends unknown[]>(
  handler: (grant: AgentKeyGrant, request: Request, ...args: Args) => Promise<Response>,
  limit: { requests: number; windowMs: number } = { requests: 60, windowMs: 60_000 },
) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    await connection();
    try {
      const key = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      const grant = key ? readAgentKey(key) : null;
      if (!grant) return apiError('Send a valid agent key as "Authorization: Bearer <key>".', 401);
      if (!allowRequest(`agent:${grant.userId}:${new URL(request.url).pathname}`, limit.requests, limit.windowMs)) {
        return apiError('Too many requests. Try again shortly.', 429);
      }
      return await handler(grant, request, ...args);
    } catch (error) {
      if (error instanceof ZodError) return apiError(error.issues[0]?.message ?? 'Invalid request.', 400);
      console.error('SDK route failed:', error);
      return apiError('Something went wrong on our side.', 500);
    }
  };
}

const paid = (transaction: TransactionRecord, data: string | null, replayed: boolean) => ({
  status: STATUS[transaction.status],
  serviceId: transaction.serviceId,
  transactionId: transaction.id,
  price: price(transaction.amountMicros),
  network: transaction.network,
  reference: transaction.reference,
  detail: transaction.statusDetail,
  data,
  replayed,
  proofUrl: settlementProof(transaction)?.url ?? null,
});

const pending = (approval: ApprovalRecord, replayed: boolean) => ({
  status: 'pending_approval',
  serviceId: approval.serviceId,
  approvalId: approval.id,
  price: price(approval.amountMicros),
  reason: approval.reason,
  expiresAt: approval.expiresAt,
  replayed,
});

/** Failed and uncertain payments carry their status, so the client never has to guess. */
function respond(body: ReturnType<typeof paid>) {
  if (body.status === 'failed' || body.status === 'uncertain') {
    return toJson({ ...body, error: body.detail ?? 'The payment did not complete.' });
  }
  return toJson(body);
}

export interface SdkPurchase {
  serviceId: string;
  idempotencyKey: string;
  network: NetworkId;
  params?: Record<string, string>;
}

/**
 * Buys one call for an agent. The key becomes the task, and the task's budget
 * is exactly one payment. The reservation is atomic and survives a crash, so
 * one key can never pay twice, whatever repeats it. Reaches the same purchase
 * path as the app, so every firewall rule applies.
 */
export async function purchaseForAgent(store: SpendStore, grant: AgentKeyGrant, input: SdkPurchase): Promise<Response> {
  const { userId, agentId } = grant;
  const taskId = `sdk-${createHash('sha256').update(`${userId}|${input.idempotencyKey}`).digest('hex').slice(0, 32)}`;
  const conflict = () => reply(409, { error: 'This idempotency key was used for a different service.', code: 'idempotency_conflict' });

  const earlier = (await store.listTransactions(userId, REPLAY_LOOKBACK)).find((transaction) => transaction.taskId === taskId);
  if (earlier) {
    if (earlier.serviceId !== input.serviceId) return conflict();
    return respond(paid(await refreshTransaction(store, earlier), null, true));
  }
  const waiting = (await store.listPendingApprovals(userId)).find((approval) => approval.taskId === taskId);
  if (waiting) {
    if (waiting.serviceId !== input.serviceId) return conflict();
    return reply(202, pending(waiting, true));
  }

  const service = await resolveService(input.serviceId);
  if (!service) return reply(404, { error: 'This service is not listed.', code: 'service_not_found' });
  if (!service.purchasable) return reply(409, { error: 'This service cannot be paid on the networks enabled here.', code: 'not_purchasable' });
  if (service.listedMicros === null) return reply(409, { error: 'This service has no listed price.', code: 'not_purchasable' });

  const result = await purchase(
    { store, userId, agentId, taskId, taskBudgetMicros: BigInt(service.listedMicros), preferredNetwork: input.network, emit: () => {} },
    { service, params: input.params, repeatable: true },
  );

  switch (result.outcome) {
    case 'delivered':
      if (!result.transaction) return toJson({ status: 'free', serviceId: service.id, data: result.data, replayed: false });
      return respond(paid(result.transaction, result.data, false));
    case 'needs_approval':
      await store.appendActivity({
        userId,
        transactionId: null,
        eventType: 'approval_requested',
        eventData: { service: service.name, amount: formatUsd(result.approval.amountMicros), source: 'sdk' },
      });
      return reply(202, pending(result.approval, false));
    case 'denied':
      // The one-payment budget is what catches a repeat that is still in flight.
      if (result.code === 'task_budget' || result.code === 'duplicate') {
        return reply(409, { error: 'A payment with this idempotency key is in progress or unresolved.', code: 'duplicate_request' });
      }
      return reply(403, { error: result.reason, code: result.code });
    default:
      if (result.transaction) return respond(paid(result.transaction, null, false));
      // Nothing was recorded, so the server cannot vouch that no money moved.
      return reply(200, { status: 'uncertain', error: result.reason });
  }
}

/** Agent keys see these on purpose, so the status code carries the outcome. */
function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export async function budgetFor(store: SpendStore, grant: AgentKeyGrant) {
  const [policy, spend] = await Promise.all([store.getPolicy(grant.userId), store.getSpendState(grant.userId, 'sdk-budget')]);
  const left = (limit: bigint, spent: bigint) => price(spent >= limit ? 0n : limit - spent);
  return {
    perRequestLimit: price(policy.perRequestLimitMicros),
    dailyLimit: price(policy.dailyLimitMicros),
    monthlyLimit: price(policy.monthlyLimitMicros),
    approvalThreshold: price(policy.approvalThresholdMicros),
    autoPayEnabled: policy.autoPayEnabled,
    spentToday: price(spend.spentTodayMicros),
    remainingToday: left(policy.dailyLimitMicros, spend.spentTodayMicros),
    spentThisMonth: price(spend.spentThisMonthMicros),
    remainingThisMonth: left(policy.monthlyLimitMicros, spend.spentThisMonthMicros),
  };
}

const auditUrls = (events: ActivityEvent[], transactionId: string) =>
  events.flatMap((event) => {
    if (event.eventType !== 'hcs_published' || event.transactionId !== transactionId) return [];
    const { status, sequence, transactionId: hederaId } = event.eventData as Record<string, string>;
    return hederaId ? [auditProof(status ?? 'recorded', sequence, hederaId).url] : [];
  });

const encodeCursor = (offset: number) => Buffer.from(String(offset)).toString('base64url');

function decodeCursor(cursor: string | null) {
  if (!cursor) return 0;
  const offset = Number(Buffer.from(cursor, 'base64url').toString());
  return Number.isInteger(offset) && offset >= 0 ? offset : null;
}

/** Newest first, covering the latest 200 payments. */
export async function historyFor(store: SpendStore, grant: AgentKeyGrant, limit: number, cursor: string | null) {
  const offset = decodeCursor(cursor);
  if (offset === null) return null;
  const all = await store.listTransactions(grant.userId, Math.min(offset + limit + 1, HISTORY_LOOKBACK));
  const page = await refreshTransactions(store, all.slice(offset, offset + limit));
  const events = await store.listActivity(grant.userId, 500);
  return {
    items: page.map((transaction) => ({
      id: transaction.id,
      serviceId: transaction.serviceId,
      serviceName: transaction.serviceName,
      provider: transaction.providerName,
      price: price(transaction.amountMicros),
      network: transaction.network,
      status: STATUS[transaction.status],
      detail: transaction.statusDetail,
      reference: transaction.reference,
      createdAt: transaction.createdAt,
      proofUrl: settlementProof(transaction)?.url ?? null,
      auditUrls: auditUrls(events, transaction.id),
    })),
    nextCursor: all.length > offset + limit ? encodeCursor(offset + limit) : null,
  };
}
