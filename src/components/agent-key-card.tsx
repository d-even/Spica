'use client';

import { useState } from 'react';
import { api } from './api';
import { CodeBlock } from './code-block';
import { Button, Card, ErrorNote } from './ui';

/** The key is shown once and never stored, so it can't be read back later. */
export function AgentKeyCard() {
  const [key, setKey] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      setKey((await api<{ key: string }>('/api/sdk/v1/keys', { method: 'POST' })).key);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Agent SDK key">
      <p className="mb-3 text-sm text-ink-2">
        Lets your code buy APIs through the SDK, inside your spending limits. It cannot change those limits. It lasts 30 days and cannot be cancelled early, so keep it private.
      </p>
      {key ? <CodeBlock code={`SPICA_API_KEY=${key}`} title="Copy this now. It won't be shown again." /> : <Button onClick={create} disabled={busy}>{busy ? 'Creating' : 'Create agent key'}</Button>}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </Card>
  );
}
