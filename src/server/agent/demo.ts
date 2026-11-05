import 'server-only';
import { formatUsd } from '@/lib/money';
import type { AgentSession } from './session';

const STOP_WORDS = new Set(
  "a an and the of to for me my is are in on at give find get show today's today latest provide updates update budget spending spend total please with what".split(' '),
);

export const extractSearchTerm = (message: string) =>
  message
    .toLowerCase()
    .replace(/\$?\d+(\.\d+)?/g, ' ')
    .split(/[^a-z'-]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .slice(0, 3)
    .join(' ');

/**
 * A fixed plan used when no Claude key is set. It runs the same discovery,
 * firewall and payment path as the real agent, but does no reasoning, and the
 * interface labels its answers as coming from the demo planner.
 */
export async function runDemoAgent(session: AgentSession, message: string) {
  const query = extractSearchTerm(message);
  session.emit({ type: 'status', message: `Searching for "${query}"` });
  const { services } = await session.discover({ query });
  const candidates = services
    .filter((service) => service.purchasable && service.price !== null)
    .sort((a, b) => Number(a.price!.slice(1)) - Number(b.price!.slice(1)));

  if (candidates.length === 0) {
    session.emit({ type: 'answer', text: 'I could not find a service for that.', source: 'demo' });
    return;
  }

  for (const candidate of candidates.slice(0, 2)) {
    const result = await session.buy({ service_id: candidate.id });
    if (result.outcome === 'delivered') {
      const cost = result.transaction ? `${formatUsd(result.transaction.amountMicros)} (simulated)` : 'nothing';
      session.emit({
        type: 'answer',
        text: `Here is the data from ${candidate.name}. This cost ${cost}. Add a Claude key in Settings for a written summary.`,
        source: 'demo',
      });
      return;
    }
    if (result.outcome === 'needs_approval') {
      session.emit({ type: 'answer', text: `${candidate.name} is waiting for your approval.`, source: 'demo' });
      return;
    }
    if (result.outcome !== 'denied') {
      session.emit({ type: 'answer', text: `I could not complete that: ${result.reason}`, source: 'demo' });
      return;
    }
    session.emit({ type: 'status', message: `${candidate.name} was refused: ${result.reason}` });
  }
  session.emit({ type: 'answer', text: 'Every matching service was refused by your spending policy.', source: 'demo' });
}
