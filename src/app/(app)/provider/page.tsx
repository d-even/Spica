'use client';

import { useState, type FormEvent } from 'react';
import { api, useApi, type ReputationDto } from '@/components/api';
import { BarChart, lastSevenDays } from '@/components/bar-chart';
import { Button, Card, Empty, ErrorNote, Field, Input, Loading, PageHeader, Stat, Textarea } from '@/components/ui';
import { formatUsd } from '@/lib/money';
import { NETWORKS, SELECTABLE_NETWORKS, type NetworkId } from '@/lib/networks';

interface ProviderDto {
  id: string;
  name: string;
  walletAddress: string;
  hederaAccount: string | null;
}

interface ServiceDto {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  priceMicros: string;
  supportedNetworks: NetworkId[];
  reputation: ReputationDto;
}

interface SaleDto {
  id: string;
  eventType: 'sale' | 'sale_failed';
  eventData: { serviceId: string; amountMicros?: string; network?: string; reference?: string; latencyMs?: number; reason?: string };
  createdAt: string;
}

interface ProviderView {
  provider: ProviderDto | null;
  services: ServiceDto[];
  sales: SaleDto[];
}

function ProfileForm({ provider, onSaved }: { provider: ProviderDto | null; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: provider?.name ?? '',
    walletAddress: provider?.walletAddress ?? '',
    hederaAccount: provider?.hederaAccount ?? '',
  });
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await api('/api/provider', { method: 'PUT', body: JSON.stringify(form) });
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) => {
      setForm({ ...form, [key]: event.target.value });
      setSaved(false);
    },
  });

  return (
    <Card title="Provider profile">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name"><Input required {...field('name')} /></Field>
        <Field label="Wallet address"><Input required placeholder="0x…" {...field('walletAddress')} /></Field>
        <Field label="Hedera account" hint="Needed to accept payments on Hedera.">
          <Input placeholder="0.0.1234" {...field('hederaAccount')} />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit">Save profile</Button>
          {saved && <span role="status" className="text-sm text-good">Saved</span>}
        </div>
        {error && <div className="sm:col-span-2"><ErrorNote>{error}</ErrorNote></div>}
      </form>
    </Card>
  );
}

function ServiceForm({ onCreated }: { onCreated: () => void }) {
  const empty = { name: '', description: '', endpoint: '', price: '0.01', usageCode: '', supportedNetworks: ['arc-testnet'] as NetworkId[] };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string>();

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await api('/api/provider/services', { method: 'POST', body: JSON.stringify({ ...form, category: 'Other' }) });
      setForm(empty);
      onCreated();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <Card title="Register an API">
      <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
        <Field label="API name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Price per request in USD"><Input required inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
        <div className="sm:col-span-2">
          <Field label="Your API URL" hint="PayGate calls this after a payment is verified.">
            <Input required type="url" placeholder="https://api.example.com/data" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Code buyers get after paying" hint="Up to 3 lines, shown only after payment. Leave it empty and PayGate generates a snippet.">
            <Textarea rows={3} spellCheck={false} className="font-mono" placeholder={'const res = await fetch("https://api.example.com/data");\nconst data = await res.json();\nconsole.log(data);'} value={form.usageCode} onChange={(e) => setForm({ ...form, usageCode: e.target.value })} />
          </Field>
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium">Payment networks</legend>
          <div className="flex flex-wrap gap-4">
            {SELECTABLE_NETWORKS.map((id) => (
              <label key={id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={form.supportedNetworks.includes(id)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      supportedNetworks: event.target.checked ? [...form.supportedNetworks, id] : form.supportedNetworks.filter((item) => item !== id),
                    })
                  }
                />
                {NETWORKS[id].label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-2"><Button type="submit">Register API</Button></div>
        {error && <div className="sm:col-span-2"><ErrorNote>{error}</ErrorNote></div>}
      </form>
    </Card>
  );
}

function ReputationBreakdown({ reputation }: { reputation: ReputationDto }) {
  if (reputation.status === 'not_enough_data') return <p className="text-xs text-ink-3">Reputation: not enough data ({reputation.sampleSize} measured calls)</p>;
  return (
    <div>
      <p className="text-xs text-ink-3">Reputation {reputation.score} / 100 from {reputation.sampleSize} measured calls</p>
      <ul className="mt-1 grid gap-x-4 text-xs text-ink-3 sm:grid-cols-2">
        {reputation.components.map((component) => (
          <li key={component.key}>{component.label}: {component.score ?? 'no data'}. {component.detail}</li>
        ))}
      </ul>
    </div>
  );
}

export default function Provider() {
  const { data, error, reload } = useApi<ProviderView>('/api/provider');
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;

  const { provider, services, sales } = data;
  const paid = sales.filter((sale) => sale.eventType === 'sale');
  const revenue = paid.reduce((sum, sale) => sum + BigInt(sale.eventData.amountMicros ?? 0), 0n);
  const latencies = paid.flatMap((sale) => sale.eventData.latencyMs ?? []);
  const average = latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null;

  async function remove(id: string) {
    await api(`/api/provider/services/${id}`, { method: 'DELETE' });
    reload();
  }

  return (
    <>
      <PageHeader title="Provider" description="Sell your API to agents. Set a price, and PayGate handles payment before each request reaches you." />
      <div className="space-y-4">
        {provider && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card><Stat label="Revenue" value={formatUsd(revenue)} /></Card>
            <Card><Stat label="Paid requests" value={String(paid.length)} /></Card>
            <Card><Stat label="Failed payments" value={String(sales.length - paid.length)} /></Card>
            <Card><Stat label="Average response" value={average === null ? 'No data' : `${average} ms`} /></Card>
          </div>
        )}
        {provider && paid.length > 0 && (
          <Card title="Revenue, last 7 days">
            <BarChart data={lastSevenDays(paid, (sale) => sale.createdAt, (sale) => BigInt(sale.eventData.amountMicros ?? 0))} format={(value) => `$${value.toFixed(2)}`} />
          </Card>
        )}
        <ProfileForm key={provider?.id ?? 'new'} provider={provider} onSaved={reload} />
        {provider && <ServiceForm onCreated={reload} />}
        {provider && (
          <Card title="Your APIs">
            {services.length === 0 ? (
              <Empty>No APIs registered yet.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {services.map((service) => (
                  <li key={service.id} className="space-y-1 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium">{service.name}</span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="text-sm tabular-nums">{formatUsd(service.priceMicros)}</span>
                        <Button variant="danger" onClick={() => remove(service.id)}>Remove</Button>
                      </span>
                    </div>
                    <p className="break-all font-mono text-xs text-ink-3">/api/x402/{service.id}</p>
                    <ReputationBreakdown reputation={service.reputation} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {provider && sales.length > 0 && (
          <Card title="Payment history" className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-xs text-ink-3">
                <tr>
                  {['Time', 'Result', 'Amount', 'Reference or reason'].map((heading) => <th key={heading} scope="col" className="pb-2 font-medium">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sales.slice(0, 25).map((sale) => (
                  <tr key={sale.id}>
                    <td className="py-2 text-ink-2">{new Date(sale.createdAt).toLocaleString()}</td>
                    <td className="py-2">{sale.eventType === 'sale' ? 'Paid' : 'Failed'}</td>
                    <td className="py-2 tabular-nums">{sale.eventData.amountMicros ? formatUsd(sale.eventData.amountMicros) : 'None'}</td>
                    <td className="max-w-48 truncate py-2 font-mono text-xs text-ink-3">{sale.eventData.reference ?? sale.eventData.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </>
  );
}
