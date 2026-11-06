import { Reveal } from './Reveal';

const STEPS = [
  { name: 'Discover', text: 'AI agents find services and APIs through available marketplaces.' },
  { name: 'Evaluate', text: 'NORA compares pricing, service quality and provider information.' },
  { name: 'Control', text: 'The spending firewall checks budgets, permissions and approval rules.' },
  { name: 'Execute', text: 'Payments are processed through Arc, while relevant audit events are recorded on Hedera.' },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="n-section">
      <Reveal>
        <p className="n-eyebrow">How NORA works</p>
        <h2>Intelligence Meets Financial Infrastructure.</h2>
      </Reveal>
      <ol className="n-steps">
        <span className="n-steps-line" aria-hidden="true" />
        {STEPS.map((step, index) => (
          <li key={step.name}>
            <Reveal delay={index * 110}>
              <span className="n-step-dot" aria-hidden="true" />
              <span className="n-step-number">0{index + 1}</span>
              <h3>{step.name}</h3>
              <p>{step.text}</p>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}
