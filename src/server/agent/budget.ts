import { usdToMicros } from '@/lib/money';
import type { NetworkId } from '@/lib/networks';

const BUDGET_WORDS = /\b(budget|spend|spending|limit|max|maximum|up to|no more than|at most|under|cap|within|below|less than|cost|costing|for\s+\$?\d+|at\s+\$?\d+)\b/i;
const DOLLARS = /\$\s?(\d+(?:\.\d{1,6})?)|(\d+(?:\.\d{1,6})?)\s?(?:usd|usdc|dollars?)\b/gi;
/** An amount with no currency, as in "budget 0.05". */
const BARE_AMOUNT = /\b(?:budget|cost|costing|max|maximum|under|below)(?:\s+(?:is|of))*\s+(\d+(?:\.\d{1,6})?)\b/gi;

/**
 * Reads the budget a person stated, in plain code. It must not depend on the
 * model, because the model is exactly what the budget constrains. With several
 * amounts it keeps the smallest, so ambiguity errs toward spending less.
 */
export function parseTaskBudget(message: string): bigint | undefined {
  if (!BUDGET_WORDS.test(message)) return undefined;
  const dollars = [...message.matchAll(DOLLARS)].map((match) => match[1] ?? match[2]);
  const stated = dollars.length ? dollars : [...message.matchAll(BARE_AMOUNT)].map((match) => match[1]);
  const amounts = stated.map((amount) => usdToMicros(amount));
  if (amounts.length === 0) return undefined;
  return amounts.reduce((low, value) => (value < low ? value : low));
}

/** The network a person named, also in plain code. Naming both, or neither, leaves it open. */
export function parseTaskNetwork(message: string): NetworkId | undefined {
  const arc = /\barc\b/i.test(message);
  const hedera = /\bhedera\b/i.test(message);
  if (arc === hedera) return undefined;
  return arc ? 'arc-testnet' : 'hedera-testnet';
}
