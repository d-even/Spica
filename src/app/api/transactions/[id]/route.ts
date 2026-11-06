import { auditProof, settlementProof, type PaymentProof } from '@/lib/proof';
import { apiError, authed, toJson } from '@/server/http/api';
import { refreshTransaction } from '@/server/settlement';
import { getStore } from '@/server/store';

/** Scoped to the signed-in user, so one person's receipt ID is useless to another. */
export const GET = authed(async (user, _request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const store = getStore();
  const transaction = await store.getTransaction(user.id, id);
  if (!transaction) return apiError('Receipt not found.', 404);
  const activity = await store.listActivity(user.id, 500);
  const events = activity.filter((event) => event.transactionId === id);
  const usageCode = events.find((event) => event.eventType === 'usage_code')?.eventData.code ?? null;
  const current = await refreshTransaction(store, transaction);
  // Read again: a refresh that just settled the payment has published a new audit message.
  const fresh = current.status === transaction.status ? events : (await store.listActivity(user.id, 50)).filter((event) => event.transactionId === id);
  const published = fresh.filter((event) => event.eventType === 'hcs_published');
  const proof: PaymentProof = {
    settlement: settlementProof(current),
    audit: published.flatMap((event) => {
      const { status, sequence, transactionId } = event.eventData as Record<string, string>;
      return transactionId ? [auditProof(status ?? 'recorded', sequence, transactionId)] : [];
    }),
    auditPending: current.status === 'verified' && published.length > 0 && !published.some((event) => event.eventData.status === 'verified'),
  };
  return toJson({ ...current, usageCode, proof });
});
