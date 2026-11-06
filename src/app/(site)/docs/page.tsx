import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeBlock } from '@/components/code-block';

export const metadata: Metadata = {
  title: 'Docs | SPICA',
  description: 'Discover, quote and pay for APIs with SPICA over HTTP.',
};

const DISCOVER = `curl "$SPICA_URL/api/discover?query=weather&maxUsdPrice=0.01"`;
const QUOTE = `curl -i "$SPICA_URL/api/x402/$SERVICE_ID"
# HTTP 402 with the price, network and recipient.
# Nothing is paid until a signed proof is sent.`;
const CALL = `curl "$SPICA_URL/api/v1/$SERVICE_ID" \\
  -H "Authorization: Bearer $SPICA_API_KEY"`;

export default function Docs() {
  return (
    <div className="s-wrap">
      <header className="s-page-head">
        <span className="s-eyebrow">Documentation</span>
        <h1 className="s-display mt-3">Start here</h1>
        <p className="s-lead mt-3">Everything on this page works today over HTTP. The SDK shown on the home page is a preview and has not been published.</p>
      </header>

      <div className="s-docs">
        <section>
          <h2 className="s-display">1. Set your limits</h2>
          <p><Link className="s-link" href="/login">Connect your wallet</Link>. Every purchase is checked on the server against your spending rules. They start at $0.50 per request, $1 a day and $10 a month, and payments over $0.20 wait for your approval. Change them on the <Link className="s-link" href="/controls">Spending limits</Link> page.</p>
        </section>

        <section className="space-y-3">
          <h2 className="s-display">2. Find a service</h2>
          <p>Browse the <Link className="s-link" href="/marketplace">marketplace</Link>, or let your agent ask. Discovery is public and needs no key.</p>
          <CodeBlock code={DISCOVER} title="Discover" />
        </section>

        <section className="space-y-3">
          <h2 className="s-display">3. Get a quote</h2>
          <p>Every listing is an x402 endpoint. Calling it without payment returns the terms.</p>
          <CodeBlock code={QUOTE} title="Quote" />
        </section>

        <section className="space-y-3">
          <h2 className="s-display">4. Call it from your code</h2>
          <p>Ask for an API on your <Link className="s-link" href="/dashboard">Dashboard</Link>. After the first payment you get a key for that service. Each call then pays through your spending rules.</p>
          <CodeBlock code={CALL} title="Call" />
        </section>

        <section>
          <h2 className="s-display">Selling an API?</h2>
          <p>Add it from the <Link className="s-link" href="/provider">Provider</Link> page. Your API key is encrypted, and buyers never see it.</p>
        </section>
      </div>
    </div>
  );
}
