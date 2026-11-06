import 'server-only';
import { createHash } from 'node:crypto';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentRequired, PaymentRequirements, SettleResponse } from 'paygate-x402';
import { formatUsd } from '@/lib/money';
import { networkByCaip2, type NetworkId } from '@/lib/networks';
import { publishAuditEvent, hcsConfigured } from '@/server/audit/hcs';
import type { CatalogService } from '@/server/discovery/types';
import { activeNetworks, mainnetEnabled } from '@/server/env';
import { evaluatePolicy, type PolicyDecision } from '@/server/firewall/policy';
import { assertPublicUrl, safeFetch } from '@/server/http/guard';
import { getAdapter } from '@/server/payments/registry';
import type { Confirmation } from '@/server/payments/types';
import { requirementHash, signPayment } from '@/server/signer';
import { APPROVAL_TTL_MS } from '@/server/store/windows';
import type { ApprovalRecord, SpendStore, TransactionRecord } from '@/server/store/types';

export interface PurchaseContext {
  store: SpendStore;
  userId: string;
  agentId: string;
  taskId: string;
  taskBudgetMicros?: bigint;
  emit: (event: PurchaseEvent) => void;
}

export type PurchaseEvent =
  | { type: 'quote'; service: string; amount: string; network: string }
  | { type: 'policy'; decision: PolicyDecision['outcome']; reason: string }
  | { type: 'payment'; status: 'signing' | 'submitted' | 'verifying' }
  | { type: 'receipt'; transaction: ReceiptSummary };

export interface ReceiptSummary {
  id: string;
  amount: string;
  network: string;
  status: string;
  reference: string | null;
  detail: string | null;
}

export type PurchaseResult =
  | { outcome: 'delivered'; data: string; transaction: TransactionRecord | null; free: boolean }
  | { outcome: 'denied'; code: string; reason: string }
  | { outcome: 'needs_approval'; approval: ApprovalRecord }
  | { outcome: 'failed'; reason: string; transaction?: TransactionRecord };

export interface PurchaseRequest {
  service: CatalogService;
  /** Extra query parameters, from the agent. They cannot change price or recipient. */
  params?: Record<string, string>;
  /** An approval a person already granted for this exact quote. */
  approval?: ApprovalRecord;
}

export function parsePaymentRequired(headers: Headers, body: string): PaymentRequired | null {
  try {
    const header = headers.get('PAYMENT-REQUIRED');
    const parsed = header ? decodePaymentRequiredHeader(header) : (JSON.parse(body) as PaymentRequired);
    return parsed.x402Version === 2 && Array.isArray(parsed.accepts) ? parsed : null;
  } catch {
    return null;
  }
}

/** Cheapest offer this deployment can pay. Network filtering happens before the firewall sees it. */
export function selectRequirement(paymentRequired: PaymentRequired, networks: NetworkId[]) {
  const payable = paymentRequired.accepts.flatMap((requirement) => {
    const network = networkByCaip2(requirement.network);
    return network && networks.includes(network.id) ? [{ requirement, network: network.id }] : [];
  });
  payable.sort((a, b) => (BigInt(a.requirement.amount) < BigInt(b.requirement.amount) ? -1 : 1));
  return payable[0] ?? null;
}

export async function purchase(context: PurchaseContext, request: PurchaseRequest): Promise<PurchaseResult> {
  const { store, userId, taskId, emit } = context;
  const { service, params, approval } = request;
  const started = Date.now();

  const observe = (outcome: { reachable: boolean; succeeded: boolean; paid: boolean; quoted?: bigint }) =>
    store
      .recordObservation({
        serviceKey: service.id,
        reachable: outcome.reachable,
        succeeded: outcome.succeeded,
        paid: outcome.paid,
        latencyMs: Date.now() - started,
        quotedMicros: outcome.quoted ?? null,
      })
      .catch((error) => console.error('Could not record observation:', error));

  let url: URL;
  try {
    url = await assertPublicUrl(service.endpoint);
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  } catch (error) {
    return { outcome: 'denied', code: 'unsafe_url', reason: (error as Error).message };
  }
  const resource = url.toString();
  const init: RequestInit = { method: service.method === 'POST' ? 'POST' : 'GET', headers: { accept: 'application/json' } };

  // 1. Ask without paying. The 402 is the seller's real quote.
  let first;
  try {
    first = await safeFetch(url, init);
  } catch (error) {
    await observe({ reachable: false, succeeded: false, paid: false });
    return { outcome: 'failed', reason: `The service could not be reached: ${(error as Error).message}` };
  }
  if (first.status >= 200 && first.status < 300) {
    await observe({ reachable: true, succeeded: true, paid: false });
    return { outcome: 'delivered', data: first.text, transaction: null, free: true };
  }
  if (first.status !== 402) {
    await observe({ reachable: first.status < 500, succeeded: false, paid: false });
    return { outcome: 'failed', reason: `The service returned HTTP ${first.status}.` };
  }

  const paymentRequired = parsePaymentRequired(first.headers, first.text);
  if (!paymentRequired) {
    await observe({ reachable: true, succeeded: false, paid: false });
    return { outcome: 'failed', reason: 'The service sent payment terms PayGate could not read.' };
  }
  const selected = selectRequirement(paymentRequired, activeNetworks());
  if (!selected) {
    await observe({ reachable: true, succeeded: false, paid: false });
    return { outcome: 'denied', code: 'network_not_allowed', reason: 'The service does not accept any network enabled here.' };
  }
  const { requirement, network } = selected;
  const amountMicros = BigInt(requirement.amount);
  const hash = requirementHash(requirement, resource);
  emit({ type: 'quote', service: service.name, amount: formatUsd(amountMicros), network });

  // 2. Firewall. The model has no say in it.
  const humanApproved = approval !== undefined && approval.status === 'approved' && approval.requirementHash === hash;
  const listed = service.offers.find((offer) => offer.network === network)?.amountMicros;
  const paymentRequest = {
    amountMicros,
    asset: requirement.asset,
    network,
    providerKey: service.providerKey,
    listedAmountMicros: listed === undefined ? undefined : BigInt(listed),
    taskBudgetMicros: context.taskBudgetMicros,
  };
  const policy = await store.getPolicy(userId);
  const decision = evaluatePolicy(policy, paymentRequest, await store.getSpendState(userId, taskId), {
    mainnetEnabled: mainnetEnabled(),
    humanApproved,
  });
  emit({ type: 'policy', decision: decision.outcome, reason: decision.reason });
  await store.appendActivity({
    userId,
    transactionId: null,
    eventType: `policy_${decision.outcome}`,
    eventData: { service: service.name, amount: formatUsd(amountMicros), network, reason: decision.reason },
  });

  if (decision.outcome === 'deny') {
    await observe({ reachable: true, succeeded: false, paid: false, quoted: amountMicros });
    return { outcome: 'denied', code: decision.code, reason: decision.reason };
  }
  if (decision.outcome === 'needs_approval') {
    const created = await store.createApproval({
      userId,
      taskId,
      serviceId: service.id,
      serviceName: service.name,
      providerName: service.providerName,
      amountMicros,
      network,
      requirementHash: hash,
      reason: decision.reason,
      request: { service, params, taskBudgetMicros: context.taskBudgetMicros?.toString() },
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
    });
    return { outcome: 'needs_approval', approval: created };
  }

  // 3. Atomic hold. This is what stops concurrent requests overspending.
  const reservation = await store.reserve({
    userId,
    taskId,
    amountMicros,
    dailyLimitMicros: policy.dailyLimitMicros,
    monthlyLimitMicros: policy.monthlyLimitMicros,
    taskBudgetMicros: context.taskBudgetMicros,
    dedupeHash: createHash('sha256').update(`${userId}|${hash}`).digest('hex'),
    requirementHash: hash,
  });
  if (!reservation.ok) {
    const reason = reservation.reason === 'duplicate' ? 'An identical purchase was just made.' : 'A concurrent purchase used the remaining budget.';
    emit({ type: 'policy', decision: 'deny', reason });
    return { outcome: 'denied', code: reservation.reason, reason };
  }
  const { reservationId } = reservation;

  // 4. Sign behind the reservation, then retry with the proof.
  let proof: string;
  try {
    emit({ type: 'payment', status: 'signing' });
    const payload = await signPayment(store, { reservationId, paymentRequired, requirement, resource });
    proof = encodePaymentSignatureHeader(payload);
  } catch (error) {
    await store.releaseReservation(reservationId, { paymentNotSent: true });
    return { outcome: 'failed', reason: `Payment could not be signed: ${(error as Error).message}` };
  }

  const record = (confirmation: Confirmation) =>
    store.insertTransaction({
      userId,
      agentId: context.agentId,
      taskId,
      providerKey: service.providerKey,
      providerName: service.providerName,
      providerEns: null,
      serviceId: service.id,
      serviceName: service.name,
      resource,
      amountMicros,
      token: 'USDC',
      network,
      reference: confirmation.reference,
      payer: confirmation.payer,
      payTo: requirement.payTo,
      status: confirmation.status,
      statusDetail: confirmation.detail,
    });

  let paid;
  try {
    emit({ type: 'payment', status: 'submitted' });
    paid = await safeFetch(url, { ...init, headers: { ...init.headers, 'PAYMENT-SIGNATURE': proof } });
  } catch (error) {
    // The proof left this server, so the payment may have settled. The hold stays counted.
    await observe({ reachable: false, succeeded: false, paid: true, quoted: amountMicros });
    const transaction = await record({
      status: 'unverified',
      reference: null,
      payer: null,
      detail: `No response after the proof was sent: ${(error as Error).message}`,
    });
    return { outcome: 'failed', reason: 'The service did not answer after payment was sent. The amount stays held for review.', transaction };
  }

  if (paid.status === 402) {
    await store.releaseReservation(reservationId, { paymentNotSent: true });
    await observe({ reachable: true, succeeded: false, paid: true, quoted: amountMicros });
    const transaction = await record({ status: 'failed', reference: null, payer: null, detail: 'The seller rejected the payment.' });
    return { outcome: 'failed', reason: 'The seller rejected the payment. No money moved.', transaction };
  }

  const paymentResponse = paid.headers.get('PAYMENT-RESPONSE');
  if (paid.status < 200 || paid.status >= 300 || !paymentResponse) {
    await observe({ reachable: paid.status < 500, succeeded: false, paid: true, quoted: amountMicros });
    if (paid.status >= 200 && paid.status < 300) {
      const transaction = await record({ status: 'unverified', reference: null, payer: null, detail: 'The seller returned data with no settlement proof.' });
      return { outcome: 'delivered', data: paid.text, transaction, free: false };
    }
    const transaction = await record({ status: 'unverified', reference: null, payer: null, detail: `The seller returned HTTP ${paid.status} after the proof was sent.` });
    return { outcome: 'failed', reason: `The service returned HTTP ${paid.status} after payment was sent. The amount stays held for review.`, transaction };
  }

  // 5. Do not take the seller's word for it.
  emit({ type: 'payment', status: 'verifying' });
  let settlement: SettleResponse;
  let confirmation: Confirmation;
  try {
    settlement = decodePaymentResponseHeader(paymentResponse);
    confirmation = await getAdapter(network).confirm({ settlement, requirement: requirement as PaymentRequirements });
  } catch (error) {
    confirmation = { status: 'unverified', reference: null, payer: null, detail: `Could not verify: ${(error as Error).message}` };
  }

  if (confirmation.status === 'failed') {
    await store.releaseReservation(reservationId, { paymentNotSent: true });
  } else {
    await store.commitReservation(reservationId);
  }
  const transaction = await record(confirmation);
  await observe({ reachable: true, succeeded: confirmation.status !== 'failed', paid: true, quoted: amountMicros });

  await store.appendActivity({
    userId,
    transactionId: transaction.id,
    eventType: 'payment_recorded',
    eventData: { service: service.name, amount: formatUsd(amountMicros), status: transaction.status, network },
  });
  emit({
    type: 'receipt',
    transaction: {
      id: transaction.id,
      amount: formatUsd(amountMicros),
      network,
      status: transaction.status,
      reference: transaction.reference,
      detail: transaction.statusDetail,
    },
  });

  if (hcsConfigured() && (transaction.status === 'verified' || transaction.status === 'settling')) {
    publishAuditEvent({
      agentId: context.agentId,
      providerKey: service.providerKey,
      amountMicros: amountMicros.toString(),
      token: 'USDC',
      network,
      reference: transaction.reference,
      status: transaction.status,
      timestamp: transaction.createdAt,
    })
      .then((result) =>
        store.appendActivity({ userId, transactionId: transaction.id, eventType: 'hcs_published', eventData: { ...result } }),
      )
      .catch((error) =>
        store.appendActivity({ userId, transactionId: transaction.id, eventType: 'hcs_failed', eventData: { message: String(error) } }),
      );
  }

  return { outcome: 'delivered', data: paid.text, transaction, free: false };
}
