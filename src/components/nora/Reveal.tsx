'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Fades content in once, when it first scrolls into view. */
export function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const element = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        target.dataset.shown = 'true';
        observer.disconnect();
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={element} className={`n-reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}
