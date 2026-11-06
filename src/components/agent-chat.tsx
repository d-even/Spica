'use client';

import { Check, ChevronRight, Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import type { AgentEvent, ServiceSummary } from '@/server/agent/session';
import { NETWORKS, type NetworkId } from '@/lib/networks';
import { api } from './api';
import { CodeBlock } from './code-block';
import { LivePayment } from './payment-proof';
import { Badge, Button, Card, ErrorNote, Textarea } from './ui';

interface Run {
  prompt: string;
  events: AgentEvent[];
  running: boolean;
}

const EXAMPLES = [
  'I want a weather API for Pune.',
  'I want a news API about technology.',
  'I want a stock quotes API for IBM.',
  'I want a live cricket scores API.',
];

type Find<T extends AgentEvent['type']> = Extract<AgentEvent, { type: T }>;

const last = <T extends AgentEvent['type']>(events: AgentEvent[], type: T) =>
  [...events].reverse().find((event): event is Find<T> => event.type === type);

function prettify(data: string) {
  try {
    return JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    return data;
  }
}

function Step({ event }: { event: AgentEvent }) {
  const row = (icon: React.ReactNode, text: React.ReactNode) => (
    <li className="rise flex gap-2 text-sm text-ink-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">{text}</span>
    </li>
  );
  const done = <Check size={15} className="text-good" aria-hidden />;
  switch (event.type) {
    case 'status':
      return row(<ChevronRight size={15} aria-hidden />, event.message);
    case 'budget':
      return row(done, `Task budget set to ${event.amount}`);
    case 'discovered':
      return row(done, `Found ${event.services.length} service${event.services.length === 1 ? '' : 's'}`);
    case 'selected':
      return row(<ChevronRight size={15} aria-hidden />, `Trying ${event.service.name} from ${event.service.provider}`);
    case 'quote':
      return row(done, `Provider quoted ${event.amount} on ${NETWORKS[event.network as NetworkId]?.label ?? event.network}`);
    case 'policy':
      if (event.decision === 'allow') return row(<ShieldCheck size={15} className="text-good" aria-hidden />, `Spending Firewall approved: ${event.reason}`);
      if (event.decision === 'deny') return row(<ShieldAlert size={15} className="text-bad" aria-hidden />, `Spending Firewall blocked: ${event.reason}`);
      return row(<ShieldQuestion size={15} className="text-warn" aria-hidden />, event.reason);
    case 'payment':
      return row(<ChevronRight size={15} aria-hidden />, { signing: 'Authorizing payment', submitted: 'Sending payment proof', verifying: 'Verifying payment independently' }[event.status]);
    default:
      return null;
  }
}

function Services({ services }: { services: ServiceSummary[] }) {
  return (
    <ul className="divide-y divide-line">
      {services.slice(0, 6).map((service) => (
        <li key={service.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <span className="min-w-0">
            <span className="block truncate font-medium">{service.name}</span>
            <span className="block truncate text-xs text-ink-3">{service.provider}</span>
          </span>
          <span className="shrink-0 tabular-nums text-ink-2">{service.price ?? 'Unpriced'}</span>
        </li>
      ))}
    </ul>
  );
}

export function AgentChat({ detailed = false, onFinished }: { detailed?: boolean; onFinished?: () => void }) {
  const [input, setInput] = useState('');
  const [run, setRun] = useState<Run>();
  const [error, setError] = useState<string>();
  const form = useRef<HTMLFormElement>(null);

  async function send(text: string) {
    const message = text.trim();
    if (!message || run?.running) return;
    setError(undefined);
    setRun({ prompt: message, events: [], running: true });
    setInput('');

    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (!response.ok || !response.body) {
        await api('/api/agent/run', { method: 'POST', body: JSON.stringify({ message }) }).catch((cause: Error) => setError(cause.message));
        setRun((current) => current && { ...current, running: false });
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        const events = lines.filter(Boolean).map((line) => JSON.parse(line) as AgentEvent);
        setRun((current) => current && { ...current, events: [...current.events, ...events] });
      }
    } catch {
      setError('The connection to the agent was lost.');
    }
    setRun((current) => current && { ...current, running: false });
    onFinished?.();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    send(input);
  }

  const events = run?.events ?? [];
  const answer = last(events, 'answer');
  const data = last(events, 'data');
  const receipt = last(events, 'receipt');
  const failure = last(events, 'error');
  const discovered = last(events, 'discovered');
  const approval = last(events, 'approval_required');

  return (
    <div className="space-y-4">
      <Card>
        <form ref={form} onSubmit={submit} className="space-y-3">
          <Textarea
            rows={3}
            aria-label="Ask the agent"
            placeholder="What kind of API do you want?"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                form.current?.requestSubmit();
              }
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={run?.running}
                  onClick={() => send(example)}
                  className="min-h-9 rounded-full border border-line px-3 text-left text-xs text-ink-2 hover:bg-surface-2 disabled:opacity-50"
                >
                  {example}
                </button>
              ))}
            </div>
            <Button type="submit" disabled={run?.running || !input.trim()}>
              {run?.running && <Loader2 size={15} className="animate-spin" aria-hidden />}
              {run?.running ? 'Working' : 'Send'}
            </Button>
          </div>
        </form>
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}

      {run && (
        <div className={detailed ? 'grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_300px]' : 'space-y-4'}>
          <div className="min-w-0 space-y-4">
            <Card title={run.prompt.length > 70 ? `${run.prompt.slice(0, 70)}…` : run.prompt}>
              <ul className="space-y-2" aria-live="polite">
                {events.map((event, index) => (
                  <Step key={index} event={event} />
                ))}
                {run.running && (
                  <li className="flex items-center gap-2 text-sm text-ink-3">
                    <Loader2 size={15} className="animate-spin" aria-hidden /> Working
                  </li>
                )}
              </ul>
            </Card>

            {failure && <ErrorNote>{failure.message}</ErrorNote>}

            {approval && (
              <Card title="Needs your approval" className="rise">
                <p className="text-sm text-ink-2">
                  {approval.amount} for {approval.service}. {approval.reason}
                </p>
                <Link href="/dashboard" className="mt-2 inline-block text-sm font-medium text-accent">
                  Review on your dashboard
                </Link>
              </Card>
            )}

            {receipt?.transaction.usageCode && (
              <Card title="Your API" className="rise">
                <p className="mb-2 text-sm text-ink-2">Paste this into your code. Each call pays {receipt.transaction.amount} from the agent wallet, and counts toward your budget and Spending Firewall limits. Keep the key private.</p>
                <CodeBlock code={receipt.transaction.usageCode} />
              </Card>
            )}

            {answer && (
              <Card
                title="Answer"
                className="rise"
                action={answer.source === 'demo' ? <Badge tone="warn">Demo planner</Badge> : <Badge tone="info">{answer.source === 'gemini' ? 'Gemini' : 'Claude'}</Badge>}
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer.text}</p>
                {data && (
                  <details className="mt-3" open={answer.source === 'demo'}>
                    <summary className="cursor-pointer text-xs text-ink-3">Data from {data.service}</summary>
                    <pre className="mt-2 max-h-72 max-w-full overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-xs">{prettify(data.data)}</pre>
                  </details>
                )}
              </Card>
            )}
          </div>

          {detailed && (
            <div className="min-w-0 space-y-4">
              {discovered && (
                <Card title="Discovered services">
                  {discovered.services.length ? <Services services={discovered.services} /> : <p className="text-sm text-ink-3">No matches.</p>}
                  {discovered.failures.length > 0 && <p className="mt-2 text-xs text-warn">Part of the catalog could not be reached.</p>}
                </Card>
              )}
              {last(events, 'selected') && (
                <Card title="Selected provider">
                  <p className="text-sm font-medium">{last(events, 'selected')!.service.provider}</p>
                  <p className="text-xs text-ink-3">Estimated cost {last(events, 'quote')?.amount ?? last(events, 'selected')!.service.price ?? 'unknown'}</p>
                </Card>
              )}
              {receipt && (
                <Card title="Payment" className="rise">
                  <LivePayment id={receipt.transaction.id} amount={receipt.transaction.amount} status={receipt.transaction.status} detail={receipt.transaction.detail} />
                  <Link href={`/transactions/${receipt.transaction.id}`} className="mt-2 inline-block text-sm font-medium text-accent">
                    View receipt
                  </Link>
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {!detailed && receipt && (
        <Link href={`/transactions/${receipt.transaction.id}`} className="block text-sm font-medium text-accent">
          View receipt for {receipt.transaction.amount}
        </Link>
      )}
    </div>
  );
}
