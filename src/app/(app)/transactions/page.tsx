'use client';

import Link from 'next/link';
import { useApi, type OverviewDto } from '@/components/api';
import { Card, Empty, ErrorNote, Loading, PageHeader, StatusBadge } from '@/components/ui';
import { formatUsd } from '@/lib/money';
import { NETWORKS } from '@/lib/networks';

const shorten = (value: string | null) => (value && value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : (value ?? 'None'));

export default function Transactions() {
  const { data, error } = useApi<OverviewDto>('/api/overview');
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;

  const { transactions } = data;
  return (
    <>
      <PageHeader title="Payments" description="Every payment your agent made, with the result of its verification." />
      {transactions.length === 0 ? (
        <Empty>No payments yet. Ask the agent for something to see one here.</Empty>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-ink-3">
              <tr className="border-b border-line">
                {['Service', 'Provider', 'Amount', 'Network', 'Reference', 'Status'].map((heading) => (
                  <th key={heading} scope="col" className="px-4 py-3 font-medium">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link href={`/transactions/${tx.id}`} className="font-medium">{tx.serviceName}</Link>
                    <time className="block text-xs text-ink-3">{new Date(tx.createdAt).toLocaleString()}</time>
                  </td>
                  <td className="px-4 py-3 text-ink-2">{tx.providerEns ?? tx.providerName}</td>
                  <td className="px-4 py-3 tabular-nums">{formatUsd(tx.amountMicros)}</td>
                  <td className="px-4 py-3 text-ink-2">{NETWORKS[tx.network].label}</td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-3">{shorten(tx.reference)}</td>
                  <td className="px-4 py-3"><StatusBadge status={tx.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
