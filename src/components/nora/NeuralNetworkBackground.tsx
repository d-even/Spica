'use client';

import { useEffect, useRef, useState } from 'react';
import { createNetwork, type NetworkRole } from './network-engine';
import { NetworkNode } from './NetworkNode';

export function NeuralNetworkBackground() {
  const threads = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const [role, setRole] = useState<NetworkRole | null>(null);

  useEffect(() => {
    if (!threads.current || !overlay.current || !tooltip.current) return;
    const network = createNetwork({
      threads: threads.current,
      overlay: overlay.current,
      tooltip: tooltip.current,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      onHover: setRole,
    });
    return () => network?.destroy();
  }, []);

  return (
    <div className="n-network" aria-hidden="true">
      <canvas ref={threads} />
      <canvas ref={overlay} className="n-network-overlay" />
      <NetworkNode ref={tooltip} role={role} />
    </div>
  );
}
