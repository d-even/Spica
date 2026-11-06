import Link from 'next/link';
import type { ReactNode } from 'react';
import { SPICALogo } from './SPICALogo';
import { SPICARobot } from './SPICARobot';

const PIXELS = [[12, 30], [84, 24], [22, 62], [78, 58], [48, 20], [90, 74]];

/** Two columns on desktop: brand on the left, the form on the right. Phones get the form. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="s-auth">
      <aside className="s-auth-side">
        <Link href="/" aria-label="SPICA home"><SPICALogo variant="login" /></Link>
        <p className="s-display mt-6" style={{ fontSize: 'clamp(2.4rem, 5vw, 3.8rem)' }}>Let agents move.<br />Keep control.</p>
        <div className="s-pixels" aria-hidden>
          {PIXELS.map(([left, top], index) => (
            <i key={index} className="s-pixel" style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${index * 0.5}s` }} />
          ))}
        </div>
        <div className="s-auth-robot"><SPICARobot /></div>
      </aside>
      <main className="s-auth-main">
        <div className="w-full">
          <div className="mb-5 flex justify-center min-[900px]:hidden">
            <Link href="/" aria-label="SPICA home"><SPICALogo /></Link>
          </div>
          <div className="s-card s-auth-card mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}
