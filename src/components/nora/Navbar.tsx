import Link from 'next/link';
import { WalletButton } from '@/components/wallet-button';

export const NAV_LINKS = [
  { label: 'Platform', href: '#platform' },
  { label: 'Developers', href: '#developers' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Documentation', href: 'https://github.com/d-even/PayGate#readme' },
];

export function Logo() {
  return (
    <svg className="n-logo" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M6 22V6l16 16V6" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="6" cy="22" r="2.2" fill="currentColor" />
      <circle cx="6" cy="6" r="2.2" fill="currentColor" />
      <circle cx="22" cy="22" r="2.2" fill="currentColor" />
      <circle cx="22" cy="6" r="2.2" fill="#8fb0ea" />
    </svg>
  );
}

export function Navbar() {
  return (
    <header className="n-nav-wrap">
      <nav className="n-nav" aria-label="Main">
        <a href="#top" className="n-brand" aria-label="NORA home">
          <Logo />
          <span>NORA</span>
        </a>
        <ul className="n-nav-links">
          {NAV_LINKS.map((link) => (
            <li key={link.label}><a href={link.href}>{link.label}</a></li>
          ))}
        </ul>
        <div className="n-nav-actions">
          <WalletButton connectClassName="n-button n-button-ghost n-button-small" connectedClassName="n-nav-connected" afterConnect="/dashboard" />
          <Link href="/agent" className="n-button n-button-small n-nav-launch">Launch NORA</Link>
          <details className="n-menu">
            <summary aria-label="Open menu"><span /><span /></summary>
            <div className="n-menu-panel">
              {NAV_LINKS.map((link) => <a key={link.label} href={link.href}>{link.label}</a>)}
              <Link href="/agent">Launch NORA</Link>
            </div>
          </details>
        </div>
      </nav>
    </header>
  );
}
