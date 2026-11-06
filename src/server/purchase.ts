import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { NOT_SETTLED_HEADER, type PaymentRequired, type PaymentRequirements, type SettleResponse } from 'paygate-x402';
import { formatUsd } from '@/lib/money';
import { decodeUsageCode, defaultUsageCode, developerApiCode, USAGE_CODE_HEADER } from '@/lib/usage-code';
import { issueApiKey } from '@/server/api-keys';
import { NETWORKS, networkByCaip2, type NetworkId } from '@/lib/networks';
import { settlementProof } from '@/lib/proof';
import { auditPayment } from '@/server/audit/record';
import type { CatalogService } from '@/server/discovery/types';
import { activeNetworks, mainnetEnabled, publicUrl } from '@/server/env';
import { evaluatePolicy, type PolicyDecision } from '@/server/firewall/policy';
import { assertPublicUrl, safeFetch } from '@/server/http/guard';
import { getAdapter } from '@/server/payments/registry';
import type { Confirmation } from '@/server/payments/types';
import { requirementHash, signPayment } from '@/server/signer';
import { watchSettlement } from '@/server/settlement';
import { APPROVAL_TTL_MS } from '@/server/store/windows';
import type { ApprovalRecord, SpendStore, TransactionRecord } from '@/server/store/types';

export interface PurchaseContext {
  store: SpendStore;
  userId: string;
  agentId: string;
  taskId: string;
  taskBudgetMicros?: bigint;
  /** The network a person named. Other offers are not used. */
  preferredNetwork?: NetworkId;
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
  /** Released by the paid response. Null when the payment failed. */
  usageCode: string | null;
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
  /** A metered call through an API key: identical calls are expected, and no new key is issued. */
  repeatable?: boolean;
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

/**
 * Networks a purchase may use: enabled on this server and allowed by the person.
 * The demo rail is exempt from the person's list, as in the policy engine.
 */
export function payableNetworks(active: NetworkId[], allowed: NetworkId[]): NetworkId[] {
  return active.filter((network) => network === 'demo' || allowed.includes(network));
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
  const { service, params, approval, repeatable } = request;
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
  // Choose among networks the person allows, so a cheaper offer on a network they
  // turned off does not hide one they would accept.
  const policy = await store.getPolicy(userId);
  const networks = payableNetworks(activeNetworks(), policy.allowedNetworks).filter(
    (candidate) => !context.preferredNetwork || candidate === context.preferredNetwork,
  );
  const selected = selectRequirement(paymentRequired, networks);
  if (!selected) {
    await observe({ reachable: true, succeeded: false, paid: false });
    const reason = selectRequirement(paymentRequired, activeNetworks())
      ? 'The service only accepts networks you have not allowed.'
      : 'The service does not accept any network enabled here.';
    return { outcome: 'denied', code: 'network_not_allowed', reason };
  }
  const { requirement, network } = selected;
  const amountMicros = BigInt(requirement.amount);
  const hash = requirementHash(requirement, resource);
  emit({ type: 'quote', service: service.name, amount: formatUsd(amountMicros), network });
  console.log(`[x402] 402 Payment Required: ${service.name}, ${formatUsd(amountMicros)} USDC on ${NETWORKS[network].label}`);

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
  const decision = evaluatePolicy(policy, paymentRequest, await store.getSpendState(userId, taskId), {
    mainnetEnabled: mainnetEnabled(),
    humanApproved,
  });
  emit({ type: 'policy', decision: decision.outcome, reason: decision.reason });
  console.log(`[x402] Spending Firewall: ${decision.outcome}. ${decision.reason}`);
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
      request: { service, params, taskBudgetMicros: context.taskBudgetMicros?.toString(), preferredNetwork: context.preferredNetwork },
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
    dedupeHash: createHash('sha256').update(`${userId}|${hash}${repeatable ? `|${randomUUID()}` : ''}`).digest('hex'),
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
    const rejection = parsePaymentRequired(paid.headers, paid.text)?.error;
    const detail = rejection ? `The seller rejected the payment: ${rejection}.` : 'The seller rejected the payment.';
    const transaction = await record({ status: 'failed', reference: null, payer: null, detail });
    return { outcome: 'failed', reason: `${detail} No money moved.`, transaction };
  }

  const paymentResponse = paid.headers.get('PAYMENT-RESPONSE');
  if (paid.status < 200 || paid.status >= 300 || !paymentResponse) {
    await observe({ reachable: paid.status < 500, succeeded: false, paid: true, quoted: amountMicros });
    if (paid.status >= 200 && paid.status < 300) {
      const transaction = await record({ status: 'unverified', reference: null, payer: null, detail: 'The seller returned data with no settlement proof.' });
      return { outcome: 'delivered', data: paid.text, transaction, free: false };
    }
    // PayGate's own seller says so only when settlement never ran. Third parties are not taken at their word.
    if (service.source !== 'circle' && paid.headers.get(NOT_SETTLED_HEADER)) {
      await store.releaseReservation(reservationId, { paymentNotSent: true });
      const transaction = await record({ status: 'failed', reference: null, payer: null, detail: `The service returned HTTP ${paid.status}, so nothing was charged.` });
      return { outcome: 'failed', reason: 'The service is having trouble right now, so nothing was charged. Try again shortly.', transaction };
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

  // Only PayGate's own seller route is trusted to set this header.
  const provided = service.source === 'paygate' ? decodeUsageCode(paid.headers.get(USAGE_CODE_HEADER)) : null;
  const apiKey =
    confirmation.status === 'failed' || repeatable || provided || service.source === 'circle'
      ? null
      : issueApiKey({
          userId,
          agentId: context.agentId,
          serviceId: service.id,
          taskId,
          budgetMicros: context.taskBudgetMicros?.toString(),
          network: context.preferredNetwork,
        });
  const query = new URLSearchParams(params).toString();
  const developerUrl = `${publicUrl()}/api/v1/${service.id}${query ? `?${query}` : ''}`;
  const developerCode = apiKey ? developerApiCode(developerUrl, apiKey) : defaultUsageCode(resource);
  const usageCode = confirmation.status === 'failed' || repeatable ? null : (provided ?? developerCode);
  if (usageCode) {
    // The payment is already recorded, so a failure here must not undo the result.
    await store
      .appendActivity({ userId, transactionId: transaction.id, eventType: 'usage_code', eventData: { code: usageCode } })
      .catch((error) => console.error('Could not save usage code:', error));
  }

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
      usageCode,
    },
  });

  console.log(`[x402] ${service.name}: ${transaction.status}. ${transaction.statusDetail}`);
  const settled = settlementProof(transaction);
  if (settled) console.log(`[proof] ${settled.label}: ${settled.url}`);
  auditPayment(store, transaction);
  if (transaction.status === 'settling') watchSettlement(store, transaction);

  return { outcome: 'delivered', data: paid.text, transaction, free: false };
}
