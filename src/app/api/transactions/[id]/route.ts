import type { PaymentRequirements } from 'paygate-x402';
import { NETWORKS } from '@/lib/networks';
import { apiError, authed, toJson } from '@/server/http/api';
import { getAdapter } from '@/server/payments/registry';
import { getStore, type SpendStore, type TransactionRecord } from '@/server/store';

/** Gateway settles in batches, after the receipt was written, so ask again while it is pending. */
async function refreshSettling(store: SpendStore, transaction: TransactionRecord) {
  if (transaction.status !== 'settling' || !transaction.reference) return transaction;
  const network = NETWORKS[transaction.network];
  const requirement = {
    scheme: 'exact',
    network: network.caip2,
    asset: network.tokenAsset,
    amount: transaction.amountMicros.toString(),
    payTo: transaction.payTo,
    maxTimeoutSeconds: 0,
    extra: {},
  } as PaymentRequirements;
  const confirmation = await getAdapter(transaction.network).confirm({
    settlement: { success: true, transaction: transaction.reference, network: network.caip2 as PaymentRequirements['network'], payer: transaction.payer ?? undefined },
    requirement,
  });
  // A failed lookup says nothing about the payment, so the receipt stays as it was.
  if (confirmation.status !== 'verified' && confirmation.status !== 'failed') return transaction;
  return store.updateTransactionStatus(transaction.id, {
    status: confirmation.status,
    statusDetail: confirmation.detail,
    reference: confirmation.reference,
    payer: confirmation.payer,
  });
}

/** Scoped to the signed-in user, so one person's receipt ID is useless to another. */
export const GET = authed(async (user, _request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const store = getStore();
  const transaction = await store.getTransaction(user.id, id);
  if (!transaction) return apiError('Receipt not found.', 404);
  const activity = await store.listActivity(user.id, 500);
  const usageCode = activity.find((event) => event.eventType === 'usage_code' && event.transactionId === id)?.eventData.code ?? null;
  return toJson({ ...(await refreshSettling(store, transaction)), usageCode });
});
