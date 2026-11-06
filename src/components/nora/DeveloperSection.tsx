import Link from 'next/link';
import { Reveal } from './Reveal';

const Keyword = ({ children }: { children: string }) => <span className="c-key">{children}</span>;
const Text = ({ children }: { children: string }) => <span className="c-str">{children}</span>;
const Name = ({ children }: { children: string }) => <span className="c-fn">{children}</span>;

export function DeveloperSection() {
  return (
    <section id="developers" className="n-section n-developers">
      <Reveal className="n-developers-copy">
        <p className="n-eyebrow">For developers</p>
        <h2>Build Services. Let Agents Pay.</h2>
        <p className="n-lead">Put NORA in front of an existing API and earn per call. Set a price, and NORA handles the payment before the request reaches your code.</p>
        <Link href="/provider" className="n-button n-button-ghost">Explore Developer SDK</Link>
      </Reveal>
      <Reveal delay={120}>
        <figure className="n-code">
          <figcaption><span>route.ts</span><span>Illustrative syntax</span></figcaption>
          <pre><code>
            <Keyword>import</Keyword> {'{ '}<Name>paygate</Name>{' } '}<Keyword>from</Keyword> <Text>{'"@nora/provider-sdk"'}</Text>;{'\n\n'}
            <Keyword>export const</Keyword> GET = <Name>paygate</Name>{'({\n'}
            {'  price: '}<Text>{'"0.001"'}</Text>{',\n'}
            {'  asset: '}<Text>{'"USDC"'}</Text>{',\n'}
            {'  network: '}<Text>{'"hedera:testnet"'}</Text>{'\n'}
            {'})('}<Keyword>async</Keyword>{' () => {\n'}
            {'  '}<Keyword>return</Keyword>{' Response.'}<Name>json</Name>{'({\n'}
            {'    message: '}<Text>{'"Hello from NORA"'}</Text>{'\n'}
            {'  });\n});'}
          </code></pre>
        </figure>
        <p className="n-note">The packaged SDK is planned. Providers can list an API through the NORA app today.</p>
      </Reveal>
    </section>
  );
}
