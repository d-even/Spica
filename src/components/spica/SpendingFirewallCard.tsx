import type { ReactNode } from 'react';
import { Reveal } from './Reveal';

/** One firewall rule. `planned` marks a rule the firewall does not enforce yet. */
export function SpendingFirewallCard({ title, delay, planned = false, visual, children }: { title: string; delay?: number; planned?: boolean; visual: ReactNode; children: ReactNode }) {
  return (
    <Reveal delay={delay} className="h-full">
      <article className="s-card s-fw">
        <div className="s-fw-visual" aria-hidden>{visual}</div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="s-display">{title}</h3>
          {planned && <span className="s-tag s-tag-yellow">Planned</span>}
        </div>
        <p>{children}</p>
      </article>
    </Reveal>
  );
}
