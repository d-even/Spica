'use client';

import { AgentChat } from '@/components/agent-chat';
import { useApi, type OverviewDto } from '@/components/api';
import { Approvals } from '@/components/approvals';
import { Badge, PageHeader } from '@/components/ui';

export default function AgentPage() {
  const { data, reload } = useApi<OverviewDto>('/api/overview');
  const claude = data?.integrations.find((integration) => integration.id === 'llm')?.configured;

  return (
    <>
      <PageHeader title="Agent" description="Tell it what you need. Every payment passes through your Spending Firewall first." />
      {data && (
        <p className="mb-4 flex items-center gap-2 text-sm text-ink-2">
          Status <Badge tone={claude ? 'good' : 'warn'}>{claude ? 'Ready' : 'Demo planner, no Claude key'}</Badge>
        </p>
      )}
      <div className="space-y-4">
        {data && <Approvals approvals={data.approvals} onDecided={reload} />}
        <AgentChat detailed onFinished={reload} />
      </div>
    </>
  );
}
