import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

const TONES = {
  good: { className: '', Icon: CheckCircle2 },
  warn: { className: 's-toast-warn', Icon: AlertTriangle },
  bad: { className: 's-toast-bad', Icon: XCircle },
};

/** `fixed` pins it under the navbar; otherwise it sits in the page flow. */
export function NotificationToast({ tone = 'good', title, children, fixed = false }: { tone?: keyof typeof TONES; title: string; children?: ReactNode; fixed?: boolean }) {
  const { className, Icon } = TONES[tone];
  return (
    <div role="status" className={`s-toast ${className} ${fixed ? 's-toast-fixed' : ''}`}>
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
      <span>
        {title}
        {children && <small>{children}</small>}
      </span>
    </div>
  );
}
