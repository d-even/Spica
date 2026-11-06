'use client';

import { Loader2, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api } from '@/components/api';
import { openFresh, signInWithArc, walletErrorMessage } from '@/components/wallet';
import { isEmail, PasswordField, TextField } from './auth-fields';
import { NotificationToast } from './NotificationToast';

/** Where to go after signing in. Only paths on this site, so the link cannot send someone elsewhere. */
function nextPath() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && /^\/[a-z]/i.test(next) ? next : '/dashboard';
}

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState<'email' | 'wallet'>();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  function finish() {
    setDone(true);
    openFresh(nextPath());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = { email: isEmail(email) ? undefined : 'Enter a valid email address.', password: password ? undefined : 'Enter your password.' };
    setErrors(found);
    setError(undefined);
    if (found.email || found.password) return;
    setBusy('email');
    try {
      await api('/api/auth/email/login', { method: 'POST', body: JSON.stringify({ email, password, remember }) });
      finish();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(undefined);
    }
  }

  async function connectWallet() {
    setBusy('wallet');
    setError(undefined);
    try {
      await signInWithArc();
      finish();
    } catch (cause) {
      setError(walletErrorMessage(cause));
      setBusy(undefined);
    }
  }

  return (
    <>
      <h1 className="s-display">Welcome back</h1>
      <p className="mt-1 text-sm text-ink-2">Sign in to manage your agent and its spending.</p>

      <form onSubmit={submit} noValidate className="mt-5 space-y-4">
        <TextField label="Email" type="email" autoComplete="email" value={email} error={errors.email} onChange={(event) => setEmail(event.target.value)} />
        <PasswordField autoComplete="current-password" value={password} error={errors.password} onChange={(event) => setPassword(event.target.value)} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" className="size-4 accent-[#111]" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            Remember me
          </label>
          <Link href="/forgot-password" className="s-link">Forgot password?</Link>
        </div>
        {error && <NotificationToast tone="bad" title={error} />}
        {done && <NotificationToast title="You're in. Opening your dashboard…" />}
        <button type="submit" className="s-btn w-full" disabled={!!busy || done}>
          {busy === 'email' && <Loader2 size={17} className="animate-spin" aria-hidden />}
          {busy === 'email' ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="s-divider my-4">or</div>
      <button type="button" className="s-btn s-btn-plain w-full" onClick={connectWallet} disabled={!!busy || done}>
        <Wallet size={17} aria-hidden /> {busy === 'wallet' ? 'Check your wallet…' : 'Connect wallet'}
      </button>
      <p className="mt-2 text-center text-xs text-ink-3">Arc Testnet. Signing is free and sends no transaction.</p>

      <p className="mt-5 text-center text-sm">New to SPICA? <Link href="/signup" className="s-link">Create an account</Link></p>
    </>
  );
}
