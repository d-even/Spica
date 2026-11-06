import { Reveal } from './Reveal';
import { SpendingFirewall } from './SpendingFirewall';

const CONTROLS = [
  { label: 'Daily spending limit' },
  { label: 'Weekly spending limit', planned: true },
  { label: 'Per-provider limits', planned: true },
  { label: 'Approved merchants' },
  { label: 'Blocked merchants' },
  { label: 'Human approval threshold' },
];

export function FirewallSection() {
  return (
    <section className="n-section n-firewall-section">
      <Reveal className="n-firewall-copy">
        <p className="n-eyebrow">Spending firewall</p>
        <h2>Autonomy Without Losing Control.</h2>
        <p className="n-lead">The rules run on the server, outside the model. An agent can ask to spend. It cannot set a price, choose a recipient or approve itself.</p>
        <ul className="n-list">
          {CONTROLS.map((control) => (
            <li key={control.label}>
              {control.label}
              {control.planned && <span className="n-tag">Planned</span>}
            </li>
          ))}
        </ul>
      </Reveal>
      <Reveal delay={120}><SpendingFirewall /></Reveal>
    </section>
  );
}
