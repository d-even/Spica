'use client';

import { useEffect, useRef, useState } from 'react';

const WEEKLY_BUDGET = 10;
const THRESHOLDS = [1, 5, 10];

const REQUESTS = [
  { name: 'Weather API', provider: 'Approved merchant', amount: 0.01, blocked: false },
  { name: 'Currency API', provider: 'Approved merchant', amount: 0.05, blocked: false },
  { name: 'Premium API', provider: 'Approved merchant', amount: 8, blocked: false },
  { name: 'Unknown provider', provider: 'Not on your list', amount: 2, blocked: true },
];

type Outcome = 'allowed' | 'approval' | 'blocked';

function decide(threshold: number, approved: boolean) {
  let spent = 0;
  const rows = REQUESTS.map((request) => {
    let outcome: Outcome = 'allowed';
    let reason = 'Within budget and policy';
    if (request.blocked) {
      outcome = 'blocked';
      reason = 'Merchant is not approved';
    } else if (spent + request.amount > WEEKLY_BUDGET) {
      outcome = 'blocked';
      reason = 'Would exceed the weekly budget';
    } else if (request.amount > threshold && !approved) {
      outcome = 'approval';
      reason = `Above the $${threshold.toFixed(2)} approval threshold`;
    } else if (request.amount > threshold) {
      reason = 'Approved by you';
    }
    if (outcome === 'allowed') spent += request.amount;
    return { ...request, outcome, reason };
  });
  return { rows, spent };
}

const LABEL: Record<Outcome, string> = { allowed: 'Allowed', approval: 'Approval required', blocked: 'Blocked' };

export function SpendingFirewall() {
  const [threshold, setThreshold] = useState(5);
  const [approved, setApproved] = useState(false);
  const [shown, setShown] = useState(0);
  const [run, setRun] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const target = panel.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { threshold: 0.3 });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700;
    const timers = REQUESTS.map((_, index) => window.setTimeout(() => setShown(index + 1), delay * (index + 1)));
    return () => timers.forEach(window.clearTimeout);
  }, [inView, run]);

  const { rows, spent } = decide(threshold, approved);

  function replay() {
    setApproved(false);
    setShown(0);
    setRun(run + 1);
  }

  return (
    <div ref={panel} className="n-firewall">
      <div className="n-firewall-head">
        <div>
          <span className="n-mono-label">Agent weekly budget</span>
          <strong>${spent.toFixed(2)} <span>of ${WEEKLY_BUDGET.toFixed(2)}</span></strong>
        </div>
        <button type="button" className="n-link-button" onClick={replay}>Replay</button>
      </div>
      <div className="n-meter" role="img" aria-label={`$${spent.toFixed(2)} of $${WEEKLY_BUDGET.toFixed(2)} spent`}>
        <span style={{ width: `${Math.min(100, (spent / WEEKLY_BUDGET) * 100)}%` }} />
      </div>

      <ul className="n-requests">
        {rows.map((row, index) => {
          const decided = index < shown;
          return (
            <li key={row.name} data-outcome={decided ? row.outcome : 'pending'}>
              <div>
                <span className="n-request-name">{row.name}</span>
                <span className="n-request-meta">{decided ? row.reason : row.provider}</span>
              </div>
              <span className="n-request-amount">${row.amount.toFixed(2)}</span>
              <span className="n-request-result" aria-live="polite">
                {decided ? LABEL[row.outcome] : 'Checking'}
                {decided && row.outcome === 'approval' && (
                  <button type="button" className="n-approve" onClick={() => setApproved(true)}>Approve</button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <fieldset className="n-threshold">
        <legend className="n-mono-label">Human approval threshold</legend>
        {THRESHOLDS.map((value) => (
          <button key={value} type="button" aria-pressed={threshold === value} onClick={() => { setThreshold(value); setApproved(false); }}>
            ${value.toFixed(2)}
          </button>
        ))}
      </fieldset>
      <p className="n-note">Illustrative demo with sample requests. No payment is made here.</p>
    </div>
  );
}
