'use client';

import { ExternalLink } from 'lucide-react';
import type { PaymentProof } from '@/lib/proof';
import { useApi, useRefreshWhile, type TransactionDto } from './api';
import { StatusBadge } from './ui';

export function ProofLinks({ proof, settling }: { proof?: PaymentProof; settling: boolean }) {
  const links = [...(proof?.settlement ? [proof.settlement] : []), ...(proof?.audit ?? [])];
  return (
    <div className="space-y-1.5">
      {settling && <p className="text-xs text-ink-3">Waiting for Circle&apos;s batch to settle onchain. This usually takes a few minutes.</p>}
      {links.map((link) => (
        <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm font-medium text-accent">
          <ExternalLink size={14} aria-hidden /> {link.label}
        </a>
      ))}
    </div>
  );
}

/** True until a payment's proof is complete, so a page knows to keep checking. */
export const proofIncomplete = (transaction?: TransactionDto) =>
  !transaction || transaction.status === 'settling' || Boolean(transaction.proof?.auditPending);

/** Follows one payment until its proof is complete, so the links appear without a reload. */
export function LivePayment({ id, amount, status, detail }: { id: string; amount: string; status: string; detail: string | null }) {
  const { data: transaction, reload } = useApi<TransactionDto>(`/api/transactions/${id}`);
  useRefreshWhile(proofIncomplete(transaction), reload);
  const current = transaction?.status ?? status;
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold tabular-nums">{amount}</span>
        <StatusBadge status={current} />
      </div>
      <p className="mt-1 text-xs text-ink-3">{transaction?.statusDetail ?? detail}</p>
      <div className="mt-3">
        <ProofLinks proof={transaction?.proof} settling={current === 'settling'} />
      </div>
    </>
  );
}
