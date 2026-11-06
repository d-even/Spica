import Link from 'next/link';
import { SPICALogo } from './SPICALogo';

const LINKS = [
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/providers', label: 'Providers' },
  { href: '/docs', label: 'Docs' },
  { href: '/provider', label: 'List your API' },
  { href: '/login', label: 'Login' },
];

export function Footer() {
  return (
    <footer className="s-footer">
      <div className="s-wrap flex flex-col gap-6 py-9 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <SPICALogo variant="footer" />
          <p className="mt-2 max-w-sm text-sm opacity-80">The intelligent payment and trust infrastructure for autonomous AI agents.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          {LINKS.map(({ href, label }) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
      </div>
    </footer>
  );
}
