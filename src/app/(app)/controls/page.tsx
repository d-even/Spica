'use client';

import { useState, type FormEvent } from 'react';
import { api, useApi, type OverviewDto, type PolicyDto } from '@/components/api';
import { Button, Card, ErrorNote, Field, Input, Loading, PageHeader, Textarea } from '@/components/ui';
import { microsToUsd } from '@/lib/money';
import { NETWORKS, SELECTABLE_NETWORKS, type NetworkId } from '@/lib/networks';

interface FormState {
  perRequestLimit: string;
  dailyLimit: string;
  monthlyLimit: string;
  approvalThreshold: string;
  autoPayEnabled: boolean;
  allowedNetworks: NetworkId[];
  allowedProviders: string;
  blockedProviders: string;
}

const toForm = (policy: PolicyDto): FormState => ({
  perRequestLimit: microsToUsd(policy.perRequestLimitMicros),
  dailyLimit: microsToUsd(policy.dailyLimitMicros),
  monthlyLimit: microsToUsd(policy.monthlyLimitMicros),
  approvalThreshold: microsToUsd(policy.approvalThresholdMicros),
  autoPayEnabled: policy.autoPayEnabled,
  allowedNetworks: policy.allowedNetworks,
  allowedProviders: policy.allowedProviders.join('\n'),
  blockedProviders: policy.blockedProviders.join('\n'),
});

const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);

export default function Controls() {
  const { data: policy, error } = useApi<PolicyDto>('/api/policy');
  if (error) return <ErrorNote>{error}</ErrorNote>;
  return policy ? <PolicyForm policy={policy} /> : <Loading />;
}

function PolicyForm({ policy }: { policy: PolicyDto }) {
  const { data: overview } = useApi<OverviewDto>('/api/overview');
  const [form, setForm] = useState(() => toForm(policy));
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const update = (change: Partial<FormState>) => {
    setForm({ ...form, ...change });
    setSaved(false);
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await api('/api/policy', {
        method: 'PUT',
        body: JSON.stringify({ ...form, allowedProviders: lines(form.allowedProviders), blockedProviders: lines(form.blockedProviders) }),
      });
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const money = (label: string, key: keyof FormState, hint: string) => (
    <Field label={label} hint={hint}>
      <Input inputMode="decimal" value={form[key] as string} onChange={(event) => update({ [key]: event.target.value })} />
    </Field>
  );

  return (
    <>
      <PageHeader title="Spending controls" description="These rules are enforced on the server for every payment. The agent cannot see past them or change them." />
      <form onSubmit={save} className="space-y-4">
        <Card title="Budgets in USD">
          <div className="grid gap-4 sm:grid-cols-2">
            {money('Daily budget', 'dailyLimit', 'Resets at midnight UTC')}
            {money('Monthly budget', 'monthlyLimit', 'Resets on the 1st, UTC')}
            {money('Maximum per request', 'perRequestLimit', 'Anything above this is blocked')}
            {money('Approval threshold', 'approvalThreshold', 'Anything above this asks you first')}
          </div>
        </Card>

        <Card title="Automatic payments">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={form.autoPayEnabled} onChange={(event) => update({ autoPayEnabled: event.target.checked })} />
            <span>
              Pay automatically below the approval threshold
              <span className="block text-xs text-ink-3">Turn this off to approve every payment yourself.</span>
            </span>
          </label>
        </Card>

        <Card title="Network permissions">
          <div className="space-y-2.5">
            {SELECTABLE_NETWORKS.map((id) => {
              const network = NETWORKS[id];
              const locked = network.mainnet && !overview?.mainnetEnabled;
              return (
                <label key={id} className={`flex items-center gap-3 text-sm ${locked ? 'text-ink-3' : ''}`}>
                  <input
                    type="checkbox"
                    className="size-4"
                    disabled={locked}
                    checked={form.allowedNetworks.includes(id)}
                    onChange={(event) =>
                      update({
                        allowedNetworks: event.target.checked ? [...form.allowedNetworks, id] : form.allowedNetworks.filter((item) => item !== id),
                      })
                    }
                  />
                  {network.label}
                  {network.mainnet && <span className="text-xs text-ink-3">{locked ? 'Real money, disabled on this server' : 'Real money'}</span>}
                </label>
              );
            })}
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Approved providers">
            <Field label="One provider per line" hint="Leave empty to allow any provider that is not blocked.">
              <Textarea rows={4} value={form.allowedProviders} onChange={(event) => update({ allowedProviders: event.target.value })} />
            </Field>
          </Card>
          <Card title="Blocked providers">
            <Field label="One provider per line" hint="Use the provider ID shown in the marketplace.">
              <Textarea rows={4} value={form.blockedProviders} onChange={(event) => update({ blockedProviders: event.target.value })} />
            </Field>
          </Card>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>{saving ? 'Saving' : 'Save policy'}</Button>
          {saved && <span role="status" className="text-sm text-good">Saved</span>}
        </div>
      </form>
    </>
  );
}
