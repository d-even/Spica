'use client';

import Link from 'next/link';
import { AgentChat } from '@/components/agent-chat';
import { useApi, type OverviewDto } from '@/components/api';
import { Approvals } from '@/components/approvals';
import { BarChart, lastSevenDays } from '@/components/bar-chart';
import { Badge, Card, Empty, ErrorNote, Loading, PageHeader, Progress, Stat, StatusBadge } from '@/components/ui';
import { formatUsd } from '@/lib/money';
import { NETWORKS } from '@/lib/networks';

const ACTIVITY: Record<string, (data: Record<string, unknown>) => string> = {
  agent_run: () => 'Agent started a task',
  policy_allow: (data) => `Approved ${data.amount} for ${data.service}`,
  policy_deny: (data) => `Blocked ${data.amount} for ${data.service}`,
  policy_needs_approval: (data) => `Asked for approval on ${data.amount} for ${data.service}`,
  payment_recorded: (data) => `Recorded ${data.amount} for ${data.service}`,
  policy_updated: () => 'Spending rules changed',
  approval_approved: (data) => `You approved ${data.service}`,
  approval_rejected: (data) => `You declined ${data.service}`,
};

export default function Dashboard() {
  const { data, error, reload } = useApi<OverviewDto>('/api/overview');
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;

  const { policy, spend, transactions, activity } = data;
  const daily = BigInt(policy.dailyLimitMicros);
  const spentToday = BigInt(spend.spentTodayMicros);
  const remaining = daily > spentToday ? daily - spentToday : 0n;
  const spending = transactions.filter((tx) => tx.status !== 'failed');

  return (
    <>
      <PageHeader title="Home" description="Ask your agent for something, and see what it has spent." />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <Approvals approvals={data.approvals} onDecided={reload} />
          <AgentChat onFinished={reload} />

          <Card title="Spending, last 7 days">
            {spending.length === 0 ? (
              <Empty>No spending yet.</Empty>
            ) : (
              <BarChart
                data={lastSevenDays(spending, (tx) => tx.createdAt, (tx) => BigInt(tx.amountMicros))}
                format={(value) => `${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`}
              />
            )}
          </Card>

          <Card title="Recent payments" action={<Link href="/transactions" className="text-xs font-medium text-accent">View all</Link>}>
            {transactions.length === 0 ? (
              <Empty>No payments yet.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {transactions.slice(0, 5).map((tx) => (
                  <li key={tx.id}>
                    <Link href={`/transactions/${tx.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="min-w-0 truncate">{tx.serviceName}</span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="tabular-nums">{formatUsd(tx.amountMicros)}</span>
                        <StatusBadge status={tx.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Today's budget">
            <Stat label="Remaining" value={formatUsd(remaining)} hint={`${formatUsd(spentToday)} of ${formatUsd(daily)} used`} />
            <div className="mt-3">
              <Progress value={spentToday} max={daily} label="Daily budget used" />
            </div>
            <div className="mt-4 border-t border-line pt-3 text-xs text-ink-3">
              This month: {formatUsd(spend.spentThisMonthMicros)} of {formatUsd(policy.monthlyLimitMicros)}
            </div>
          </Card>

          <Card title="Payment networks">
            {data.networks.length === 0 ? (
              <p className="text-sm text-ink-3">
                None connected. <Link href="/settings" className="text-accent">Connect one</Link>
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {data.networks.map((network) => (
                  <li key={network}>
                    <Badge>{NETWORKS[network].label}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent activity">
            {activity.length === 0 ? (
              <Empty>Nothing yet.</Empty>
            ) : (
              <ul className="space-y-2.5">
                {activity.slice(0, 8).flatMap((event) => {
                  const describe = ACTIVITY[event.eventType];
                  return describe
                    ? [
                        <li key={event.id} className="text-sm text-ink-2">
                          {describe(event.eventData)}
                          <time className="block text-xs text-ink-3">{new Date(event.createdAt).toLocaleTimeString()}</time>
                        </li>,
                      ]
                    : [];
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
