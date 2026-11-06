import 'server-only';
import type { PaymentRequirements } from 'paygate-x402';
import { NETWORKS } from '@/lib/networks';
import { settlementProof } from '@/lib/proof';
import { auditPayment } from '@/server/audit/record';
import { getAdapter } from '@/server/payments/registry';
import type { SpendStore, TransactionRecord } from '@/server/store/types';

/** Pages reload while a payment settles, so Circle is asked about each one at most this often. */
const CHECK_INTERVAL_MS = 15_000;
/** Bounds how long one page load can wait on Circle. Oldest first, so nothing is left behind. */
const MAX_CHECKS = 8;
/** Circle's batches have taken minutes. Past this, a page load can still finish the job. */
const WATCH_LIMIT_MS = 30 * 60_000;

const lastChecked = new Map<string, number>();

/** Gateway settles in batches, after the receipt was written, so ask again while it is pending. */
async function refreshSettling(store: SpendStore, transaction: TransactionRecord, now: number) {
  if (transaction.status !== 'settling' || !transaction.reference) return transaction;
  if (now - (lastChecked.get(transaction.id) ?? 0) < CHECK_INTERVAL_MS) return transaction;
  lastChecked.set(transaction.id, now);

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
  // A failed lookup says nothing about the payment, so the record stays as it was.
  if (confirmation.status !== 'verified' && confirmation.status !== 'failed') return transaction;
  const updated = await store.updateTransactionStatus(transaction.id, {
    status: confirmation.status,
    statusDetail: confirmation.detail,
    reference: confirmation.reference,
    payer: confirmation.payer,
  });
  const proof = settlementProof(updated);
  console.log(`[x402] ${updated.serviceName}: ${updated.status}. ${confirmation.detail}`);
  if (proof) console.log(`[proof] ${proof.label}: ${proof.url}`);
  await auditPayment(store, updated);
  return updated;
}

export const refreshTransaction = (store: SpendStore, transaction: TransactionRecord, now = Date.now()) =>
  refreshSettling(store, transaction, now).catch((error) => {
    console.error('Could not refresh a settling payment:', (error as Error).message);
    return transaction;
  });

/** Follows a payment in the background, so its proof appears without a page open. */
export function watchSettlement(store: SpendStore, transaction: TransactionRecord, intervalMs = CHECK_INTERVAL_MS) {
  const started = Date.now();
  const check = async () => {
    const current = await store.getTransaction(transaction.userId, transaction.id).catch(() => null);
    if (!current || current.status !== 'settling') return;
    await refreshTransaction(store, current);
    if (Date.now() - started < WATCH_LIMIT_MS) setTimeout(check, intervalMs);
    else console.log(`[x402] ${current.serviceName}: still settling after 30 minutes. Opening the payment checks again.`);
  };
  setTimeout(check, intervalMs);
}

/** Brings a list up to date. One slow or failed lookup never holds back the rest of the page. */
export async function refreshTransactions(store: SpendStore, transactions: TransactionRecord[], now = Date.now()) {
  const pending = transactions
    .filter((transaction) => transaction.status === 'settling')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, MAX_CHECKS);
  const updated = new Map((await Promise.all(pending.map((item) => refreshTransaction(store, item, now)))).map((item) => [item.id, item]));
  return transactions.map((transaction) => updated.get(transaction.id) ?? transaction);
}
