import { Reveal } from './Reveal';

const POINTS = [
  { label: 'HCS audit trail' },
  { label: 'Agent activity records' },
  { label: 'Verifiable transaction references' },
  { label: 'Timestamped policy decisions', planned: true },
  { label: 'Agent identity and trust', planned: true },
];

const COLUMNS = 7;
const ROWS = 4;
const CELLS = Array.from({ length: COLUMNS * ROWS }, (_, index) => ({ column: index % COLUMNS, row: Math.floor(index / COLUMNS) }));

function HederaLedger() {
  return (
    <svg className="n-hedera-visual" viewBox="0 0 600 300" fill="none" aria-hidden="true">
      {CELLS.map(({ column, row }) => {
        const x = 60 + column * 80;
        const y = 45 + row * 70;
        return (
          <g key={`${column}-${row}`}>
            {column < COLUMNS - 1 && <path d={`M${x} ${y}H${x + 80}`} className="n-ledger-edge" />}
            {row < ROWS - 1 && <path d={`M${x} ${y}V${y + 70}`} className="n-ledger-edge" />}
            <circle cx={x} cy={y} r="3" className="n-ledger-node" style={{ animationDelay: `${(column + row * COLUMNS) * 0.34}s` }} />
          </g>
        );
      })}
    </svg>
  );
}

export function HederaSection() {
  return (
    <section className="n-infra n-infra-hedera">
      <Reveal delay={120}><HederaLedger /></Reveal>
      <Reveal className="n-infra-copy">
        <p className="n-eyebrow">Hedera — Trust infrastructure</p>
        <h2>Verifiable activity for autonomous agents.</h2>
        <ul className="n-list">
          {POINTS.map((point) => (
            <li key={point.label}>
              {point.label}
              {point.planned && <span className="n-tag">Planned</span>}
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}

export function RolesStrip() {
  return (
    <section className="n-roles">
      <Reveal className="n-roles-grid">
        <p><strong>Arc</strong> handles payments.</p>
        <p><strong>Hedera</strong> provides verifiable records.</p>
        <p><strong>NORA</strong> coordinates the intelligence and control.</p>
      </Reveal>
      <p className="n-note">Hedera records that an event was published and when. It does not judge whether an agent&apos;s decision was correct.</p>
    </section>
  );
}
