'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from './ui';

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
  }

  return (
    <div className="space-y-2">
      <pre className="max-w-full overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-xs">{code}</pre>
      <Button variant="ghost" onClick={copy}>
        {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
        {copied ? 'Copied' : 'Copy code'}
      </Button>
    </div>
  );
}
