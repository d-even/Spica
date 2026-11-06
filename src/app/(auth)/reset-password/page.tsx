'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api } from '@/components/api';
import { PasswordField } from '@/components/spica/auth-fields';
import { NotificationToast } from '@/components/spica/NotificationToast';

/** Supabase puts the recovery token in the URL fragment of the emailed link. */
const recoveryToken = () => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.hash.slice(1)).get('access_token'));

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = { password: password.length >= 8 ? undefined : 'Use at least 8 characters.', confirm: confirm === password ? undefined : 'The passwords do not match.' };
    setErrors(found);
    setError(undefined);
    if (found.password || found.confirm) return;
    const token = recoveryToken();
    if (!token) {
      setError('Open this page from the link in your reset email.');
      return;
    }
    setBusy(true);
    try {
      await api('/api/auth/email/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
      setDone(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="s-display">Choose a new password</h1>
      {done ? (
        <div className="mt-5 space-y-4">
          <NotificationToast title="Password changed" />
          <Link href="/login" className="s-btn w-full">Go to login</Link>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-5 space-y-4">
          <PasswordField label="New password" autoComplete="new-password" value={password} error={errors.password} onChange={(event) => setPassword(event.target.value)} />
          <PasswordField label="Confirm password" autoComplete="new-password" value={confirm} error={errors.confirm} onChange={(event) => setConfirm(event.target.value)} />
          {error && <NotificationToast tone="bad" title={error} />}
          <button type="submit" className="s-btn w-full" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        </form>
      )}
    </>
  );
}
