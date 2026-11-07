'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

const TOKENS = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\b(?:import|from|const|await|new|return|async)\b)/g;

function tone(token: string) {
  if (token.startsWith('//')) return '#a39d8f';
  return /^["'`]/.test(token) ? '#ffe34d' : '#a9e8b7';
}

export function CodeBlock({ code, title, badge }: { code: string; title?: string; badge?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
  }

  return (
    <figure className="m-0 overflow-hidden rounded-2xl border-2 border-[#111] bg-[#111] text-[#f8f5ec]" style={{ boxShadow: 'var(--shadow)' }}>
      <figcaption className="flex items-center justify-between gap-2 border-b-2 border-[#3a352b] px-3 py-2 font-mono text-xs">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{title ?? 'Code'}</span>
          {badge && <span className="shrink-0 rounded-md bg-[#ffe34d] px-1.5 py-0.5 font-bold text-[#111]">{badge}</span>}
        </span>
        <button type="button" onClick={copy} className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 hover:bg-[#2b2720]">
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </figcaption>
      <pre className="max-w-full overflow-auto p-4 font-mono text-[13px] leading-relaxed">
        {code.split(TOKENS).map((part, index) => (index % 2 ? <span key={index} style={{ color: tone(part) }}>{part}</span> : part))}
      </pre>
    </figure>
  );
}
