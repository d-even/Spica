'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/components/api';
import { Button, Card, ErrorNote, Field, Input } from '@/components/ui';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (sent) {
        await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ email, token }) });
        router.push('/dashboard');
      } else {
        await api('/api/auth/otp', { method: 'POST', body: JSON.stringify({ email }) });
        setSent(true);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm" title="Sign in to PayGate">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <Input type="email" required autoComplete="email" disabled={sent} value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          {sent && (
            <Field label="Code" hint="We emailed you a one-time code.">
              <Input required inputMode="numeric" autoComplete="one-time-code" value={token} onChange={(event) => setToken(event.target.value)} />
            </Field>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" className="w-full" disabled={busy}>{sent ? 'Sign in' : 'Email me a code'}</Button>
        </form>
      </Card>
    </main>
  );
}
