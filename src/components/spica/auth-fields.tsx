'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useId, useState, type ComponentProps } from 'react';

export const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export function TextField({ label, error, ...props }: ComponentProps<'input'> & { label: string; error?: string }) {
  const id = useId();
  return (
    <div>
      <label className="s-label" htmlFor={id}>{label}</label>
      <input id={id} className="s-input" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} {...props} />
      {error && <p id={`${id}-error`} className="s-field-error">{error}</p>}
    </div>
  );
}

export function PasswordField({ label = 'Password', error, ...props }: ComponentProps<'input'> & { label?: string; error?: string }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label className="s-label" htmlFor={id}>{label}</label>
      <div className="relative">
        <input id={id} type={shown ? 'text' : 'password'} className="s-input" style={{ paddingRight: 50 }} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} {...props} />
        <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg hover:bg-surface-2">
          {shown ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
        </button>
      </div>
      {error && <p id={`${id}-error`} className="s-field-error">{error}</p>}
    </div>
  );
}
