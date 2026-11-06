'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useApi } from '@/components/api';
import { WalletButton } from '@/components/wallet-button';
import { SPICALogo } from './SPICALogo';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/providers', label: 'Providers' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/docs', label: 'Docs' },
];

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { data } = useApi<{ signedIn: boolean }>('/api/auth/me');

  const links = LINKS.map(({ href, label }) => (
    <Link key={href} href={href} className="s-nav-link" aria-current={pathname === href ? 'page' : undefined} onClick={() => setOpen(false)}>
      {label}
    </Link>
  ));
  const actions = data?.signedIn ? (
    <Link href="/dashboard" className="s-btn s-btn-sm">Dashboard</Link>
  ) : (
    <>
      <Link href="/login" className="s-nav-link" onClick={() => setOpen(false)}>Login</Link>
      <Link href="/signup" className="s-btn s-btn-sm" onClick={() => setOpen(false)}>Get Started</Link>
    </>
  );
  const wallet = <WalletButton connectClassName="s-btn s-btn-sm s-btn-plain" connectedClassName="s-btn s-btn-sm s-btn-plain" afterConnect="/dashboard" />;

  return (
    <header className="s-nav">
      <div className="s-wrap s-nav-row">
        <Link href="/" aria-label="SPICA home"><SPICALogo /></Link>
        <nav className="s-nav-links" aria-label="Main">{links}</nav>
        <div className="s-nav-actions">{wallet}{actions}</div>
        <button type="button" className="s-nav-toggle" aria-expanded={open} aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>
          {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
        </button>
      </div>
      {open && (
        <nav className="s-nav-panel" aria-label="Mobile">
          {links}
          {actions}
          {wallet}
        </nav>
      )}
    </header>
  );
}
