import { forwardRef } from 'react';
import { ROLES, type NetworkRole } from './network-engine';

/** The hover card for a network node. The engine moves it, so hovering never re-renders the page. */
export const NetworkNode = forwardRef<HTMLDivElement, { role: NetworkRole | null }>(function NetworkNode({ role }, ref) {
  return (
    <div ref={ref} className="n-tooltip" data-open={role ? 'true' : 'false'} aria-hidden="true">
      {role && (
        <>
          <strong>{ROLES[role].label}</strong>
          <span>{ROLES[role].text}</span>
          <em>Click to trace its connections</em>
        </>
      )}
    </div>
  );
});
