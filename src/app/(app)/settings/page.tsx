'use client';

import { CheckCircle2, CircleDashed } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { AgentKeyCard } from '@/components/agent-key-card';
import { api, useApi, type OverviewDto } from '@/components/api';
import { Badge, Button, Card, ErrorNote, Loading, PageHeader } from '@/components/ui';

export default function Settings() {
  const router = useRouter();
  const { data, error } = useApi<OverviewDto>('/api/overview');
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <>
      <PageHeader title="Settings" description="See what is connected, and what each missing piece needs." />
      <div className="max-w-2xl space-y-4">
        <Card title="Mode" action={<Badge tone={data.mode === 'live' ? 'good' : 'warn'}>{data.mode === 'live' ? 'Live' : 'Demo'}</Badge>}>
          <p className="text-sm text-ink-2">
            {data.mode === 'live'
              ? 'Payments are real on the connected networks.'
              : 'Payments are simulated and no money moves. To go live, add the settings below and set PAYGATE_MODE=live.'}
          </p>
          <p className="mt-2 text-xs text-ink-3">
            Data is kept in {data.store === 'supabase' ? 'Supabase' : 'server memory and clears on restart'}.
          </p>
        </Card>

        <Card title="Connections">
          <p className="mb-3 text-xs text-ink-3">Secrets stay on the server. Add them to .env.local and restart. They cannot be entered here.</p>
          <ul className="divide-y divide-line">
            {data.integrations.map((integration) => (
              <li key={integration.id} className="flex gap-3 py-3">
                {integration.configured ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-good" aria-label="Connected" />
                ) : (
                  <CircleDashed size={16} className="mt-0.5 shrink-0 text-ink-3" aria-label="Not connected" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {integration.label} {integration.optional && <span className="font-normal text-ink-3">(optional)</span>}
                  </p>
                  <p className="text-xs text-ink-3">{integration.purpose}</p>
                  {integration.missing.length > 0 && (
                    <p className="mt-1 break-all font-mono text-xs text-ink-2">Needs: {integration.missing.join(', ')}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <AgentKeyCard />

        {data.user.demo && (
          <Card title="Account">
            <p className="mb-3 text-sm text-ink-2">You are using the shared demo account. Sign in with a wallet to keep your own settings and payments.</p>
            <Button variant="ghost" onClick={() => router.push('/login')}>Sign in with a wallet</Button>
          </Card>
        )}

        {!data.user.demo && (
          <Card title="Account">
            <p className="mb-1 break-all font-mono text-sm text-ink-2">{data.user.address}</p>
            <p className="mb-3 text-xs text-ink-3">Signed in with a wallet on {data.user.chain === 'arc-testnet' ? 'Arc Testnet' : data.user.chain}</p>
            <Button variant="ghost" onClick={signOut}>Sign out</Button>
          </Card>
        )}
      </div>
    </>
  );
}
