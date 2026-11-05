import { usdToMicros } from '@/lib/money';

const BUDGET_WORDS = /\b(budget|spend|spending|limit|max|maximum|up to|no more than|at most|under|cap)\b/i;
const DOLLARS = /\$\s?(\d+(?:\.\d{1,6})?)|(\d+(?:\.\d{1,6})?)\s?(?:usd|usdc|dollars?)\b/gi;

/**
 * Reads the budget a person stated, in plain code. It must not depend on the
 * model, because the model is exactly what the budget constrains. With several
 * amounts it keeps the smallest, so ambiguity errs toward spending less.
 */
export function parseTaskBudget(message: string): bigint | undefined {
  if (!BUDGET_WORDS.test(message)) return undefined;
  const amounts = [...message.matchAll(DOLLARS)].map((match) => usdToMicros(match[1] ?? match[2]));
  if (amounts.length === 0) return undefined;
  return amounts.reduce((low, value) => (value < low ? value : low));
}
