'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Fades its content in once, when it first scrolls into view. */
export function Reveal({ delay = 0, className = '', children }: { delay?: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setSeen(true);
        observer.disconnect();
      },
      { threshold: 0.15 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} data-seen={seen} className={`s-reveal ${className}`} style={{ '--delay': `${delay}ms` } as React.CSSProperties}>
      {children}
    </div>
  );
}
