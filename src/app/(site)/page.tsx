import { Activity, ArrowRight, Check, CheckCircle2, GitCompare, Hand, ReceiptText, Search, Wallet, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeBlock } from '@/components/code-block';
import { HeroAnimation } from '@/components/spica/HeroAnimation';
import { Reveal } from '@/components/spica/Reveal';
import { SPICARobot } from '@/components/spica/SPICARobot';
import { SpendingFirewallCard } from '@/components/spica/SpendingFirewallCard';

export const metadata: Metadata = {
  title: 'SPICA | Let agents move. Keep control.',
  description: 'Discover APIs, control agent spending, and make autonomous payments with confidence.',
};

const MARQUEE = ['Discover services', 'Control spending', 'Pay per call', 'USDC on Arc', 'Audit on Hedera', 'Human approval', 'x402 native'];

const STEPS = [
  { title: 'Discover', text: 'The agent searches the marketplace for the API it needs.', Icon: Search },
  { title: 'Compare', text: 'It weighs price, network and provider between listings.', Icon: GitCompare },
  { title: 'Approve', text: 'The Spending Firewall checks the purchase against your rules.', Icon: Hand },
  { title: 'Pay', text: 'USDC moves over x402, and only for that one call.', Icon: Wallet },
  { title: 'Verify', text: 'A receipt and an audit trail prove what happened.', Icon: ReceiptText },
];

// Preview of the planned SDK. Keep this labelled until the package is published.
const SDK_CODE = `import { SPICA } from "@spica/agent-sdk";

const spica = new SPICA({
  apiKey: process.env.SPICA_API_KEY,
  network: "arc-testnet"
});

const services = await spica.discover({
  query: "weather API"
});

const quote = await spica.quote({
  serviceId: services[0].id
});`;

const RAILS = [
  { tag: 'Arc + Circle', tone: 's-tag-yellow', title: 'USDC payments', text: 'Arc and Circle Gateway carry the money, so agents can pay small amounts per call in USDC.' },
  { tag: 'Hedera', tone: 's-tag-mint', title: 'Tamper-evident audit', text: 'Payment events are written to Hedera Consensus Service, leaving a record that cannot be quietly edited.' },
  { tag: 'SPICA', tone: 's-tag-orange', title: 'The coordinator', text: 'SPICA ties it together: discovery, policy enforcement, and the purchase itself.' },
];

export default function Home() {
  return (
    <>
      <div className="s-wrap">
        <section className="s-hero">
          <div>
            <span className="s-eyebrow">Intelligent infrastructure for AI agents</span>
            <h1 className="s-display">Let agents move.<br /><mark>Keep control.</mark></h1>
            <p className="s-lead mt-4">One SDK to discover services, control spending and execute autonomous USDC payments.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/marketplace" className="s-btn">Explore Marketplace <ArrowRight size={17} aria-hidden /></Link>
              <Link href="/signup" className="s-btn s-btn-plain">Start Building</Link>
            </div>
          </div>
          <HeroAnimation />
        </section>
        <ul className="s-trust" aria-label="Built on">
          {['ARC PAYMENTS', 'HEDERA AUDIT', 'AGENT SDK'].map((label) => <li key={label}><i aria-hidden />{label}</li>)}
        </ul>
      </div>

      <div className="s-marquee" aria-hidden>
        <div className="s-marquee-track">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex">
              {MARQUEE.map((word) => <span key={word}>{word} <b>✦</b></span>)}
            </div>
          ))}
        </div>
      </div>

      <section className="s-wrap s-section" style={{ paddingBottom: 0 }}>
        <Reveal>
          <p className="s-display" style={{ fontSize: 'clamp(1.7rem, 4.6vw, 2.7rem)', maxWidth: '26ch' }}>The intelligent payment and trust infrastructure for autonomous AI agents.</p>
          <p className="s-lead mt-3">Discover APIs, control agent spending, and make autonomous payments with confidence.</p>
        </Reveal>
      </section>

      <section id="how" className="s-wrap s-section">
        <Reveal>
          <span className="s-eyebrow">How it works</span>
          <h2 className="s-display mt-3">How SPICA works</h2>
        </Reveal>
        <ol className="s-steps">
          {STEPS.map(({ title, text, Icon }, index) => (
            <li key={title}>
              <Reveal delay={index * 70} className="h-full">
                <article className="s-card s-step">
                  <span className="s-step-no">0{index + 1}</span>
                  <span className="s-sticker"><Icon size={25} style={{ '--delay': `${index * 300}ms` } as React.CSSProperties} aria-hidden /></span>
                  <h3 className="s-display">{title}</h3>
                  <p>{text}</p>
                </article>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      <div className="s-band">
        <section className="s-wrap s-section s-sdk">
          <Reveal>
            <span className="s-eyebrow">For developers</span>
            <h2 className="s-display mt-3">Meet the SPICA Agent SDK</h2>
            <p className="s-lead mt-3">A small client for discovery, quotes and payments. Until it ships, the same flow is open over HTTP.</p>
            <Link href="/docs" className="s-btn s-btn-plain mt-5">See what works today</Link>
          </Reveal>
          <Reveal delay={120}>
            <CodeBlock code={SDK_CODE} title="agent.ts" badge="Preview" />
          </Reveal>
        </section>
      </div>

      <section className="s-wrap s-section">
        <Reveal>
          <span className="s-eyebrow">Spending Firewall</span>
          <h2 className="s-display mt-3">Every payment passes the firewall</h2>
          <p className="s-lead mt-3">Rules run on the server, before anything is signed. An agent cannot talk its way past them.</p>
        </Reveal>
        <div className="s-fw-grid">
          <SpendingFirewallCard
            title="Spending budget"
            visual={<>
              <div className="s-fw-row"><span>Today</span><span>$0.42 / $1.00</span></div>
              <div className="s-bar"><i /></div>
            </>}
          >
            Per-request, daily and monthly limits cap what an agent can spend.
          </SpendingFirewallCard>
          <SpendingFirewallCard
            title="Per-provider limit"
            planned
            delay={70}
            visual={<>
              <div className="s-fw-row"><span>Weather Co</span><span>$0.20</span></div>
              <div className="s-bar s-bar-mint"><i /></div>
            </>}
          >
            A separate cap for each provider. Not enforced yet; today&apos;s limits apply across all providers.
          </SpendingFirewallCard>
          <SpendingFirewallCard
            title="Provider allowlist"
            delay={140}
            visual={<>
              <div className="s-fw-row"><span>Approved provider</span><Check size={15} /></div>
              <div className="s-fw-row"><span>Unknown provider</span><X size={15} className="s-pulse" /></div>
            </>}
          >
            Name the providers you trust, and block the ones you don&apos;t.
          </SpendingFirewallCard>
          <SpendingFirewallCard
            title="Human approval"
            delay={70}
            visual={<>
              <div className="s-fw-row"><span>Premium API · $0.40</span><Activity size={15} className="s-pulse" /></div>
              <div className="s-fw-row"><span className="s-tag s-tag-yellow">Waiting for you</span><CheckCircle2 size={15} /></div>
            </>}
          >
            Payments above your threshold wait until a person says yes.
          </SpendingFirewallCard>
          <SpendingFirewallCard
            title="Emergency freeze"
            delay={140}
            visual={<div className="s-fw-row"><span>Auto-pay</span><span className="s-switch"><i /></span></div>}
          >
            Turn off auto-pay and the agent can no longer pay without a person.
          </SpendingFirewallCard>
        </div>
      </section>

      <div className="s-band">
        <section className="s-wrap s-section">
          <Reveal>
            <span className="s-eyebrow">Arc + Hedera</span>
            <h2 className="s-display mt-3">Two networks, one clear job each</h2>
          </Reveal>
          <div className="s-rails">
            {RAILS.map(({ tag, tone, title, text }, index) => (
              <Reveal key={title} delay={index * 80} className="h-full">
                <article className="s-card s-rail">
                  <span className={`s-tag ${tone}`}>{tag}</span>
                  <h3 className="s-display">{title}</h3>
                  <p>{text}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>
      </div>

      <section className="s-wrap s-section">
        <Reveal>
          <div className="s-cta">
            <div className="s-cta-copy">
              <h2 className="s-display">Build your first payment-aware agent.</h2>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/signup" className="s-btn s-btn-plain">Get Started</Link>
                <Link href="/docs" className="s-btn s-btn-plain">Read Documentation</Link>
              </div>
            </div>
            <div className="s-crop-top mx-auto w-40 md:w-full" style={{ marginBottom: '-5%' }}><SPICARobot pose="thumbs" /></div>
          </div>
        </Reveal>
      </section>
    </>
  );
}
