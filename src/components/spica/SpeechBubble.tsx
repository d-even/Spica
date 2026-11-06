import type { CSSProperties, ReactNode } from 'react';

/** A comic speech bubble. `side` is the side its tail sits on. */
export function SpeechBubble({ side = 'left', style, children }: { side?: 'left' | 'right'; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className={`s-bubble s-bubble-${side}`} style={style}>
      {children}
    </div>
  );
}
