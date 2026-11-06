import { Reveal } from './Reveal';

const POINTS = ['USDC payments', 'Circle marketplace discovery', 'Gateway nanopayments', 'Payment execution', 'Transaction history'];
const STOPS = [
  { x: 40, y: 130 },
  { x: 165, y: 70 },
  { x: 300, y: 150 },
  { x: 430, y: 84 },
  { x: 560, y: 128 },
];
const PATH = 'M-10 150 C 40 150 90 60 165 70 S 240 160 300 150 S 370 76 430 84 S 510 136 610 118';

function ArcStream() {
  return (
    <svg className="n-arc-visual" viewBox="0 30 600 160" fill="none" aria-hidden="true">
      <path d={PATH} className="n-arc-rail" />
      <path d={PATH} className="n-arc-flow" />
      <path d={PATH} className="n-arc-flow n-arc-flow-2" />
      {STOPS.slice(1, 4).map((stop) => (
        <g key={stop.x}>
          <circle cx={stop.x} cy={stop.y} r="13" className="n-arc-halo" />
          <circle cx={stop.x} cy={stop.y} r="3" className="n-arc-stop" />
        </g>
      ))}
    </svg>
  );
}

export function ArcSection() {
  return (
    <section id="platform" className="n-infra n-infra-arc">
      <Reveal className="n-infra-copy">
        <p className="n-eyebrow">Arc — Payment infrastructure</p>
        <h2>Autonomous payments for the agent economy.</h2>
        <ul className="n-list">
          {POINTS.map((point) => <li key={point}>{point}</li>)}
        </ul>
      </Reveal>
      <Reveal delay={120}><ArcStream /></Reveal>
    </section>
  );
}
