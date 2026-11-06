'use client';

import { Bot, Gauge, LayoutDashboard, Moon, Receipt, Settings, ShieldCheck, Store, Sun } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { SIGN_IN_REQUIRED, useApi, type OverviewDto } from './api';
import { WalletButton } from './wallet-button';

const NAV = [
  { href: '/dashboard', label: 'Home', Icon: LayoutDashboard },
  { href: '/agent', label: 'Agent', Icon: Bot },
  { href: '/controls', label: 'Spending', Icon: ShieldCheck },
  { href: '/marketplace', label: 'Marketplace', Icon: Store },
  { href: '/transactions', label: 'Payments', Icon: Receipt },
  { href: '/provider', label: 'Provider', Icon: Gauge },
];

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  root.dataset.theme = next;
  try {
    localStorage.setItem('paygate-theme', next);
  } catch {
    // The choice just won't persist.
  }
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data, error } = useApi<OverviewDto>('/api/overview');

  useEffect(() => {
    if (error === SIGN_IN_REQUIRED) router.replace('/login');
  }, [error, router]);

  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="hidden flex-col border-r border-line bg-surface p-4 md:sticky md:top-0 md:flex md:h-screen">
        <Link href="/" className="mb-6 px-2 text-lg font-semibold tracking-tight">
          PayGate
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition ${active(href) ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:bg-surface-2'}`}
            >
              <Icon size={16} aria-hidden /> {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center justify-between">
          <Link href="/settings" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-2 hover:bg-surface-2">
            <Settings size={16} aria-hidden /> Settings
          </Link>
          <button onClick={toggleTheme} aria-label="Switch theme" className="rounded-xl p-2 text-ink-2 hover:bg-surface-2">
            <Sun size={16} className="hidden dark:block" aria-hidden />
            <Moon size={16} className="dark:hidden" aria-hidden />
          </button>
        </div>
      </aside>

      <div className="min-w-0 pb-20 md:pb-0">
        <div className="sticky top-0 z-10 hidden items-center justify-end border-b border-line bg-surface px-8 py-2.5 md:flex">
          <WalletButton connectClassName="rounded-xl bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90" connectedClassName="rounded-xl border border-line bg-surface-2 py-1 pl-3 pr-1 text-sm text-ink-2" />
        </div>
        <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
          <Link href="/" className="font-semibold tracking-tight">
            PayGate
          </Link>
          <div className="flex items-center gap-1">
            <WalletButton connectClassName="rounded-xl bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90" connectedClassName="rounded-xl border border-line bg-surface-2 py-1 pl-3 pr-1 text-sm text-ink-2" />
            <Link href="/settings" aria-label="Settings" className="rounded-xl p-2 text-ink-2">
              <Settings size={18} aria-hidden />
            </Link>
            <button onClick={toggleTheme} aria-label="Switch theme" className="rounded-xl p-2 text-ink-2">
              <Sun size={18} className="hidden dark:block" aria-hidden />
              <Moon size={18} className="dark:hidden" aria-hidden />
            </button>
          </div>
        </div>

        {data?.mode === 'demo' && (
          <div className="border-b border-line bg-warn-bg px-4 py-2 text-center text-sm text-warn">
            Demo mode: payments are simulated and no money moves.{' '}
            <Link href="/settings" className="font-medium underline">
              Connect real services
            </Link>
          </div>
        )}
        <main className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-6 border-t border-line bg-surface md:hidden">
        {NAV.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? 'page' : undefined}
            className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${active(href) ? 'font-medium text-accent' : 'text-ink-3'}`}
          >
            <Icon size={18} aria-hidden /> <span className="max-w-full truncate">{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
