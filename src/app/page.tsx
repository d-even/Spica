import { ArrowRight, Fingerprint, Search, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

const POINTS = [
  { Icon: Search, title: 'Finds the right service', text: 'Your agent searches a live catalog of paid APIs and compares what each one costs.' },
  { Icon: ShieldCheck, title: 'Stays inside your budget', text: 'Limits are enforced on the server, outside the AI. It cannot talk its way past them.' },
  { Icon: Fingerprint, title: 'Shows who got paid', text: 'Every payment is checked independently and leaves a receipt you can read.' },
];

export default function Home() {
  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <span className="text-lg font-semibold tracking-tight">PayGate</span>
        <Link href="/dashboard" className="text-sm font-medium text-ink-2 hover:text-ink">
          Open app
        </Link>
      </header>

      <main className="flex flex-1 flex-col justify-center py-16">
        <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
          Let AI agents buy what they need, inside the budget you set.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-ink-2">
          Ask for something in plain language. PayGate finds a paid service, checks your spending rules, pays, and hands you the result with a receipt.
        </p>
        <Link
          href="/agent"
          className="mt-8 inline-flex min-h-11 w-fit items-center gap-2 rounded-xl bg-accent px-5 text-sm font-medium text-accent-ink hover:opacity-90"
        >
          Try the agent <ArrowRight size={16} aria-hidden />
        </Link>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {POINTS.map(({ Icon, title, text }) => (
            <div key={title}>
              <Icon size={20} className="text-accent" aria-hidden />
              <h2 className="mt-3 text-sm font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-ink-2">{text}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
