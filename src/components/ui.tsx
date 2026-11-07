import type { ComponentProps, ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, FlaskConical, XCircle } from 'lucide-react';
import { LoadingAnimation } from './spica/LoadingAnimation';

export function Card({ title, action, className = '', children }: { title?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-2xl border-2 border-ink bg-surface p-5 shadow-card ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-bold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-4xl uppercase leading-tight tracking-wide">{title}</h1>
      {description && <p className="mt-1 max-w-2xl text-sm text-ink-2">{description}</p>}
    </header>
  );
}

export function Button({ variant = 'primary', className = '', ...props }: ComponentProps<'button'> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'border-2 border-ink bg-[#ffe34d] text-[#111] shadow-[2px_2px_0_var(--ink)] hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_var(--ink)]',
    ghost: 'border-2 border-ink bg-surface text-ink hover:bg-surface-2',
    danger: 'border-2 border-bad bg-surface text-bad hover:bg-bad-bg',
  }[variant];
  return (
    <button
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

const fieldClass = 'min-h-10 w-full rounded-xl border-2 border-ink bg-surface px-3 text-sm placeholder:text-ink-3';

export const Input = (props: ComponentProps<'input'>) => <input className={fieldClass} {...props} />;
export const Textarea = (props: ComponentProps<'textarea'>) => <textarea className={`${fieldClass} py-2`} {...props} />;
export const Select = (props: ComponentProps<'select'>) => <select className={fieldClass} {...props} />;

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

const tones = {
  good: 'bg-good-bg text-good',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  info: 'bg-info-bg text-info',
  neutral: 'bg-surface-2 text-ink-2',
};

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

/** Status always pairs an icon and a label with its color. */
const statuses = {
  verified: { tone: 'good', label: 'Verified', Icon: CheckCircle2 },
  settling: { tone: 'info', label: 'Settling', Icon: Clock },
  unverified: { tone: 'warn', label: 'Unverified', Icon: AlertTriangle },
  failed: { tone: 'bad', label: 'Failed', Icon: XCircle },
  simulated: { tone: 'neutral', label: 'Simulated', Icon: FlaskConical },
} as const;

export function StatusBadge({ status }: { status: string }) {
  const entry = statuses[status as keyof typeof statuses] ?? { tone: 'neutral' as const, label: status, Icon: CircleDashed };
  return (
    <Badge tone={entry.tone}>
      <entry.Icon size={12} aria-hidden /> {entry.label}
    </Badge>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

export function Progress({ value, max, label }: { value: bigint; max: bigint; label: string }) {
  const percent = max > 0n ? Number((value * 100n) / max) : 0;
  const tone = percent >= 100 ? 'var(--bad)' : percent >= 80 ? 'var(--warn)' : 'var(--accent)';
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.min(percent, 100)} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.min(percent, 100)}%`, background: tone }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-surface-2 p-4 text-center text-sm text-ink-3">{children}</p>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-bad-bg p-3 text-sm text-bad">
      {children}
    </p>
  );
}

export function Loading() {
  return <LoadingAnimation />;
}
