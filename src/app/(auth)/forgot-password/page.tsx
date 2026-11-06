'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api } from '@/components/api';
import { isEmail, TextField } from '@/components/spica/auth-fields';
import { NotificationToast } from '@/components/spica/NotificationToast';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setInvalid(!isEmail(email));
    setError(undefined);
    if (!isEmail(email)) return;
    setBusy(true);
    try {
      await api('/api/auth/email/forgot', { method: 'POST', body: JSON.stringify({ email }) });
      setSent(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="s-display">Reset your password</h1>
      <p className="mt-1 text-sm text-ink-2">We&apos;ll email you a link to choose a new one.</p>
      {sent ? (
        <div className="mt-5"><NotificationToast title="Check your email">If that address has an account, a reset link is on its way.</NotificationToast></div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-5 space-y-4">
          <TextField label="Email" type="email" autoComplete="email" value={email} error={invalid ? 'Enter a valid email address.' : undefined} onChange={(event) => setEmail(event.target.value)} />
          {error && <NotificationToast tone="bad" title={error} />}
          <button type="submit" className="s-btn w-full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
      <p className="mt-5 text-center text-sm"><Link href="/login" className="s-link">Back to login</Link></p>
    </>
  );
}
