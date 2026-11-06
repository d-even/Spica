import 'server-only';
import { auditProof } from '@/lib/proof';
import { hcsConfigured, publishAuditEvent } from '@/server/audit/hcs';
import type { SpendStore, TransactionRecord } from '@/server/store/types';

/**
 * Publishes one payment event to the audit topic. Best effort: an audit outage
 * must not undo a payment that already happened, so failures are only recorded.
 * Runs when a payment is accepted and again when it settles, so the second
 * message carries the onchain reference.
 */
export async function auditPayment(store: SpendStore, transaction: TransactionRecord) {
  if (!hcsConfigured() || (transaction.status !== 'verified' && transaction.status !== 'settling')) return;
  const { id: transactionId, userId } = transaction;
  try {
    const result = await publishAuditEvent({
      agentId: transaction.agentId,
      providerKey: transaction.providerKey,
      amountMicros: transaction.amountMicros.toString(),
      token: transaction.token,
      network: transaction.network,
      reference: transaction.reference,
      status: transaction.status,
      timestamp: transaction.createdAt,
    });
    if (!result) return;
    await store.appendActivity({ userId, transactionId, eventType: 'hcs_published', eventData: { ...result, status: transaction.status } });
    const proof = auditProof(transaction.status, result.sequence, result.transactionId);
    console.log(`[proof] ${proof.label}: ${proof.url}`);
  } catch (error) {
    console.error('[proof] Audit publish failed:', (error as Error).message);
    await store.appendActivity({ userId, transactionId, eventType: 'hcs_failed', eventData: { message: String(error) } }).catch(() => {});
  }
}
