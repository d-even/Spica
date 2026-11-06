'use client';

import { Check, Copy, ExternalLink, Loader2, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, SIGN_IN_REQUIRED } from '@/components/api';
import { TrustBadge } from '@/components/spica/ApiCard';
import { Badge, Button, Input, StatusBadge } from '@/components/ui';
import { formatUsd } from '@/lib/money';
import { NETWORKS, networkByCaip2, type NetworkId } from '@/lib/networks';
import { categoryMeta, hostOf, paramFields, shorten, type Service } from './meta';
import type { Quote } from './quote';

interface Receipt {
  id: string;
  amountMicros: string;
  network: NetworkId;
  status: string;
  reference: string | null;
  statusDetail: string | null;
}

type PolicyEvent = { type: 'policy'; decision: string; reason: string };

type BuyResult = { events: { type: string }[] } & (
  | { outcome: 'delivered'; data: string; truncated?: boolean; free: boolean; transaction: Receipt | null }
  | { outcome: 'denied'; code: string; reason: string }
  | { outcome: 'needs_approval'; approval: { id: string; amountMicros: string; reason: string } }
  | { outcome: 'failed'; reason: string; transaction?: Receipt }
);

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the text is still selectable.
    }
  }
  return (
    <button type="button" onClick={copy} aria-label={label} className="rounded-lg p-1.5 text-ink-3 transition hover:bg-surface-2 hover:text-ink">
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  );
}

function pretty(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

function ReceiptLine({ receipt }: { receipt: Receipt }) {
  const network = NETWORKS[receipt.network];
  const explorer = receipt.reference && receipt.status !== 'simulated' ? network?.explorerTx?.(receipt.reference) : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <StatusBadge status={receipt.status} />
      <span className="text-ink-2">
        {formatUsd(receipt.amountMicros)} on {network?.label ?? receipt.network}
      </span>
      {explorer && (
        <a href={explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent underline-offset-2 hover:underline">
          View on explorer <ExternalLink size={12} aria-hidden />
        </a>
      )}
      <Link href={`/transactions/${receipt.id}`} className="text-ink-3 underline-offset-2 hover:underline">
        Receipt
      </Link>
    </div>
  );
}

function Outcome({ result }: { result: BuyResult }) {
  const policy = result.events.find((event): event is PolicyEvent => event.type === 'policy');
  const firewall = policy && (
    <p className="flex items-start gap-2 text-xs text-ink-3">
      <ShieldCheck size={14} className="mt-px shrink-0" aria-hidden />
      <span>
        Spending firewall: <span className="font-medium text-ink-2">{policy.decision.replace('_', ' ')}</span> — {policy.reason}
      </span>
    </p>
  );

  if (result.outcome === 'delivered') {
    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-good-bg p-3 text-sm text-good">
          <p className="font-medium">{result.free ? 'The service answered without charging.' : 'Paid and delivered.'}</p>
        </div>
        {result.transaction && <ReceiptLine receipt={result.transaction} />}
        {firewall}
        <div className="relative">
          <pre className="max-h-64 overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-xs leading-relaxed">{pretty(result.data)}</pre>
          <div className="absolute right-1.5 top-1.5">
            <CopyButton text={result.data} label="Copy response" />
          </div>
        </div>
        {result.truncated && <p className="text-xs text-ink-3">Response shortened for display.</p>}
      </div>
    );
  }
  if (result.outcome === 'needs_approval') {
    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-warn-bg p-3 text-sm text-warn">
          <p className="font-medium">Waiting for your approval — {formatUsd(result.approval.amountMicros)}</p>
          <p className="mt-1">{result.approval.reason}. Nothing has been paid.</p>
        </div>
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          Review in Approvals
        </Link>
      </div>
    );
  }
  if (result.outcome === 'denied' && result.code === 'duplicate') {
    return (
      <div className="rounded-xl bg-warn-bg p-3 text-sm text-warn">
        <p className="font-medium">Already bought a moment ago</p>
        <p className="mt-1">SPICA refuses identical repeat payments so an agent can never pay twice for the same call. Nothing was charged. Try again shortly.</p>
      </div>
    );
  }
  if (result.outcome === 'denied') {
    return (
      <div className="space-y-3">
        <div className="flex gap-2 rounded-xl bg-bad-bg p-3 text-sm text-bad">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Blocked by your spending rules</p>
            <p className="mt-1">{result.reason} No payment was sent.</p>
          </div>
        </div>
        <Link href="/controls" className="inline-flex text-sm font-medium text-accent hover:underline">
          Adjust spending limits
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bad-bg p-3 text-sm text-bad">
        <p className="font-medium">The purchase did not complete</p>
        <p className="mt-1">{result.reason}</p>
      </div>
      {result.transaction && <ReceiptLine receipt={result.transaction} />}
      {firewall}
    </div>
  );
}

/** The seller's live terms, read from its 402 answer. Getting them costs nothing. */
function QuotePanel({ quote }: { quote: Quote }) {
  if (quote.status === 'loading') {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-surface-2 p-3 text-sm">
        <Loader2 size={15} className="animate-spin" aria-hidden /> Asking the provider for a quote…
      </p>
    );
  }
  if (quote.status === 'failed') {
    return <p role="alert" className="rounded-xl bg-bad-bg p-3 text-sm text-bad">{quote.message}</p>;
  }
  return (
    <div className="rounded-xl bg-good-bg p-3 text-sm text-good">
      <p className="font-bold">Live quote. Nothing has been charged.</p>
      <ul className="mt-1.5 space-y-1">
        {quote.terms.map((term) => (
          <li key={`${term.network}${term.payTo}`} className="flex flex-wrap justify-between gap-x-3">
            <span>{formatUsd(term.amountAtomic)} USDC on {term.network}</span>
            <span className="font-mono text-xs" title={term.payTo}>to {shorten(term.payTo)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TryDialog({ service, quote, onQuote, onClose }: { service: Service | null; quote?: Quote; onQuote: (service: Service) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'try' | 'agents'>('try');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BuyResult>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (service && !dialog.open) dialog.showModal();
    if (!service && dialog.open) dialog.close();
  }, [service]);

  // Reset when a different service opens.
  const [shownId, setShownId] = useState<string>();
  if (service && service.id !== shownId) {
    setShownId(service.id);
    setTab('try');
    setValues(Object.fromEntries(paramFields(service.inputSchema).map((field) => [field.name, field.example ?? ''])));
    setResult(undefined);
    setError(undefined);
  }

  if (!service) return <dialog ref={ref} onClose={onClose} className="hidden" />;

  const { Icon, label } = categoryMeta(service.category);
  const fields = paramFields(service.inputSchema);
  const offer = service.offers[0];
  const networks = [...new Set(service.allNetworks.flatMap((id) => networkByCaip2(id)?.label ?? []))];
  const price = service.listedMicros ? formatUsd(service.listedMicros) : null;
  const discoverUrl = typeof window === 'undefined' ? '/api/discover' : `${window.location.origin}/api/discover?query=${encodeURIComponent(service.name.split(' ')[0] ?? '')}`;
  const curl = `curl -i "${service.endpoint}"`;

  async function buy(event: FormEvent) {
    event.preventDefault();
    if (!service) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const params = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ''));
      setResult(await api<BuyResult>(`/api/marketplace/${encodeURIComponent(service.id)}/buy`, { method: 'POST', body: JSON.stringify({ params }) }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && ref.current?.close()}
      aria-labelledby="try-title"
      className="m-0 mt-auto max-h-[92vh] w-full max-w-none overflow-hidden rounded-t-3xl border-[3px] border-[#111] bg-surface p-0 text-ink backdrop:bg-black/50 sm:m-auto sm:max-w-lg sm:rounded-3xl"
    >
      <div className="flex max-h-[92vh] flex-col">
        <div className="flex items-start gap-3 border-b border-line p-5">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-2">
            <Icon size={20} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</p>
            <h2 id="try-title" className="truncate text-base font-semibold">
              {service.name}
            </h2>
            <p className="truncate font-mono text-xs text-ink-3">{hostOf(service.endpoint)}</p>
          </div>
          <button onClick={() => ref.current?.close()} aria-label="Close" className="rounded-xl p-2 text-ink-3 hover:bg-surface-2">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div role="tablist" className="flex gap-1 px-5 pt-3">
          {(['try', 'agents'] as const).map((value) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${tab === value ? 'bg-surface-2 font-medium' : 'text-ink-3 hover:text-ink'}`}
            >
              {value === 'try' ? 'Try it' : 'For AI agents'}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto p-5 pt-3">
          {tab === 'try' ? (
            <form onSubmit={buy} className="space-y-4">
              <p className="text-sm text-ink-2">{service.description || 'No description provided.'}</p>
              <dl className="divide-y divide-line rounded-xl border border-line px-3">
                <Row label="Price per call">
                  <span className="font-semibold tabular-nums">{price ?? 'Unpriced'}</span> <span className="text-ink-3">USDC</span>
                </Row>
                <Row label="Provider">{service.providerName}</Row>
                {offer && (
                  <Row label="Pays to">
                    <span className="font-mono text-xs" title={offer.payTo}>
                      {shorten(offer.payTo)}
                    </span>
                  </Row>
                )}
                <Row label="Networks">
                  <span className="inline-flex flex-wrap justify-end gap-1">
                    {networks.length ? networks.map((network) => <Badge key={network}>{network}</Badge>) : <span className="text-ink-3">None enabled</span>}
                  </span>
                </Row>
                <Row label="Trust">
                  <span className="inline-flex items-center gap-2">
                    <TrustBadge service={service} />
                    <span className="text-xs text-ink-3">
                      {service.reputation.sampleSize} measured call{service.reputation.sampleSize === 1 ? '' : 's'}
                    </span>
                  </span>
                </Row>
              </dl>

              {quote ? (
                <QuotePanel quote={quote} />
              ) : (
                service.purchasable && (
                  <Button type="button" variant="ghost" className="w-full" onClick={() => onQuote(service)}>
                    Get Quote
                  </Button>
                )
              )}

              {fields.length > 0 && (
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-medium">Request parameters</legend>
                  {fields.map((field) => (
                    <label key={field.name} className="block text-sm">
                      <span className="mb-1 flex gap-1 font-mono text-xs text-ink-2">
                        {field.name}
                        {field.required && <span className="text-bad">*</span>}
                      </span>
                      <Input
                        value={values[field.name] ?? ''}
                        required={field.required}
                        placeholder={field.description ?? field.example ?? ''}
                        onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                      />
                    </label>
                  ))}
                </fieldset>
              )}

              {result ? (
                <Outcome result={result} />
              ) : (
                <>
                  {error && (
                    <p role="alert" className="rounded-xl bg-bad-bg p-3 text-sm text-bad">
                      {error === SIGN_IN_REQUIRED ? (
                        <>
                          Sign in to buy this API. <Link href="/login" className="font-bold underline">Login</Link>
                        </>
                      ) : (
                        error
                      )}
                    </p>
                  )}
                  <Button type="submit" className="w-full" disabled={busy || !service.purchasable}>
                    {busy ? (
                      <>
                        <Loader2 size={16} className="animate-spin" aria-hidden /> Quoting, checking rules, paying…
                      </>
                    ) : service.purchasable ? (
                      `Pay ${price ?? ''} → Get access`
                    ) : (
                      'Not payable on enabled networks'
                    )}
                  </Button>
                  <p className="text-center text-xs text-ink-3">
                    Your spending rules apply. Purchases above your approval threshold wait for you.
                  </p>
                </>
              )}
              {result && (
                <Button type="button" variant="ghost" className="w-full" onClick={() => setResult(undefined)}>
                  Call again
                </Button>
              )}
            </form>
          ) : (
            <div className="space-y-4 text-sm">
              <p className="text-ink-2">
                Agents call the endpoint directly. Without payment it answers <span className="font-mono">402 Payment Required</span> with x402 terms; the agent signs a payment and retries.
              </p>
              <div>
                <p className="mb-1 text-xs font-medium text-ink-3">1 · Get the quote</p>
                <div className="flex items-start gap-2 rounded-xl bg-surface-2 p-3">
                  <code className="min-w-0 flex-1 break-all font-mono text-xs">{curl}</code>
                  <CopyButton text={curl} />
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-ink-3">2 · Or find services by need</p>
                <div className="flex items-start gap-2 rounded-xl bg-surface-2 p-3">
                  <code className="min-w-0 flex-1 break-all font-mono text-xs">GET {discoverUrl}</code>
                  <CopyButton text={discoverUrl} />
                </div>
              </div>
              <p className="text-xs text-ink-3">
                SPICA agents pay through the same spending firewall as this page, and every settled payment can be checked on the network explorer.
              </p>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
