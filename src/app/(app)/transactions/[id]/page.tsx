'use client';

import Link from 'next/link';
import { use } from 'react';
import { useApi, type TransactionDto } from '@/components/api';
import { Card, ErrorNote, Loading, PageHeader, StatusBadge } from '@/components/ui';
import { formatUsd } from '@/lib/money';
import { NETWORKS } from '@/lib/networks';

export default function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: tx, error } = useApi<TransactionDto>(`/api/transactions/${id}`);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!tx) return <Loading />;

  const network = NETWORKS[tx.network];
  // While settling, the reference is a Gateway ID, which no block explorer knows.
  const explorer = tx.reference && tx.status !== 'simulated' && tx.status !== 'settling' ? network.explorerTx?.(tx.reference) : undefined;
  const rows: [string, React.ReactNode][] = [
    ['Transaction ID', <span key="id" className="font-mono text-xs">{tx.id}</span>],
    ['Agent', <span key="agent" className="font-mono text-xs">{tx.agentId}</span>],
    ['Provider', tx.providerName],
    ['Provider ENS', tx.providerEns ?? 'None'],
    ['API', tx.serviceName],
    ['Amount', `${formatUsd(tx.amountMicros)} ${tx.token}`],
    ['Network', network.label],
    ['Reference', explorer ? <a key="ref" href={explorer} target="_blank" rel="noreferrer" className="break-all font-mono text-xs text-accent">{tx.reference}</a> : <span key="ref" className="break-all font-mono text-xs">{tx.reference ?? 'None'}</span>],
    ['Time', new Date(tx.createdAt).toLocaleString()],
    ['Verification', tx.statusDetail ?? 'None'],
  ];

  return (
    <>
      <PageHeader title="Receipt" />
      <Card className="max-w-2xl" title={tx.serviceName} action={<StatusBadge status={tx.status} />}>
        <dl className="divide-y divide-line">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[150px_1fr]">
              <dt className="text-ink-3">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Link href="/transactions" className="mt-4 inline-block text-sm font-medium text-accent">Back to payments</Link>
    </>
  );
}
