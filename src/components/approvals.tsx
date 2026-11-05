'use client';

import { useState } from 'react';
import { formatUsd } from '@/lib/money';
import { NETWORKS } from '@/lib/networks';
import { api, type ApprovalDto } from './api';
import { Button, Card, ErrorNote } from './ui';

export function Approvals({ approvals, onDecided }: { approvals: ApprovalDto[]; onDecided: () => void }) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  if (approvals.length === 0) return null;

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setBusy(id);
    setError(undefined);
    try {
      const result = await api<{ outcome: string; reason?: string }>(`/api/approvals/${id}`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      if (result.outcome === 'denied' || result.outcome === 'failed') setError(result.reason ?? 'The payment did not go through.');
      onDecided();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Card title="Waiting for your approval" className="rise">
      <ul className="space-y-3">
        {approvals.map((approval) => (
          <li key={approval.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {formatUsd(approval.amountMicros)} for {approval.serviceName}
              </p>
              <p className="text-xs text-ink-3">
                {approval.providerName} on {NETWORKS[approval.network].label}. {approval.reason}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={busy === approval.id} onClick={() => decide(approval.id, 'rejected')}>
                Decline
              </Button>
              <Button disabled={busy === approval.id} onClick={() => decide(approval.id, 'approved')}>
                Approve
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </Card>
  );
}
