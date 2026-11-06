'use client';

import { Loader2, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api } from '@/components/api';
import { openFresh } from '@/components/wallet';
import { isEmail, PasswordField, TextField } from './auth-fields';
import { NotificationToast } from './NotificationToast';

type Errors = { name?: string; email?: string; password?: string; confirm?: string };

export function SignupForm() {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);

  const field = (name: keyof typeof form) => ({
    value: form[name],
    error: errors[name],
    onChange: (event: { target: { value: string } }) => setForm({ ...form, [name]: event.target.value }),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: Errors = {
      name: form.name.trim() ? undefined : 'Enter your name.',
      email: isEmail(form.email) ? undefined : 'Enter a valid email address.',
      password: form.password.length >= 8 ? undefined : 'Use at least 8 characters.',
      confirm: form.confirm === form.password ? undefined : 'The passwords do not match.',
    };
    setErrors(found);
    setError(undefined);
    if (Object.values(found).some(Boolean)) return;
    setBusy(true);
    try {
      const { name, email, password } = form;
      const { signedIn } = await api<{ signedIn: boolean }>('/api/auth/email/signup', { method: 'POST', body: JSON.stringify({ name, email, password }) });
      if (signedIn) openFresh('/dashboard');
      else setSent(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <span className="s-sticker mx-auto"><MailCheck size={25} aria-hidden /></span>
        <h1 className="s-display mt-3">Check your email</h1>
        <p className="mt-2 text-sm text-ink-2">We sent a confirmation link to {form.email.trim()}. Open it, then sign in.</p>
        <Link href="/login" className="s-btn mt-5 w-full">Go to login</Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="s-display">Create your account</h1>
      <p className="mt-1 text-sm text-ink-2">Give your agent a budget in a few minutes.</p>

      <form onSubmit={submit} noValidate className="mt-5 space-y-4">
        <TextField label="Name" autoComplete="name" {...field('name')} />
        <TextField label="Email" type="email" autoComplete="email" {...field('email')} />
        <PasswordField autoComplete="new-password" {...field('password')} />
        <PasswordField label="Confirm password" autoComplete="new-password" {...field('confirm')} />
        {error && <NotificationToast tone="bad" title={error} />}
        <button type="submit" className="s-btn w-full" disabled={busy}>
          {busy && <Loader2 size={17} className="animate-spin" aria-hidden />}
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-5 text-center text-sm">Already have an account? <Link href="/login" className="s-link">Login</Link></p>
    </>
  );
}
