import Link from 'next/link';
import { Logo, NAV_LINKS } from './Navbar';
import { Reveal } from './Reveal';

export function FinalCTA() {
  return (
    <section className="n-final">
      <Reveal>
        <h2>The Next Economy Runs on Agents.</h2>
        <p className="n-lead">Give your agents the ability to discover, decide and transact — with intelligence and trust built in.</p>
        <div className="n-actions">
          <Link href="/agent" className="n-button">Launch NORA</Link>
          <Link href="/provider" className="n-button n-button-ghost">Start Building</Link>
        </div>
      </Reveal>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="n-footer">
      <span className="n-brand"><Logo /><span>NORA</span></span>
      <nav aria-label="Footer">
        {NAV_LINKS.map((link) => <a key={link.label} href={link.href}>{link.label}</a>)}
        <Link href="/login">Sign in</Link>
      </nav>
      <p>Testnet software. Payments use testnet USDC.</p>
    </footer>
  );
}
