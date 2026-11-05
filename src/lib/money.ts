/**
 * Money is held as integer micro-USD (1 USDC = 1,000,000 atomic units) so
 * limits never drift through floating point. Safe for client bundles.
 */
export const MICROS_PER_USD = 1_000_000n;

export function usdToMicros(value: string | number): bigint {
  const text = typeof value === 'number' ? value.toFixed(6) : value.trim().replace(/^\$/, '');
  const match = /^(\d+)(?:\.(\d{1,6})\d*)?$/.exec(text);
  if (!match) throw new Error(`Invalid USD amount: ${value}`);
  const [, whole, fraction = ''] = match;
  return BigInt(whole) * MICROS_PER_USD + BigInt(fraction.padEnd(6, '0'));
}

export function microsToUsd(micros: bigint | string): string {
  const value = BigInt(micros);
  const whole = value / MICROS_PER_USD;
  const fraction = (value % MICROS_PER_USD).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Display form: at least two decimals, keeping sub-cent precision. */
export function formatUsd(micros: bigint | string): string {
  const [whole, fraction = ''] = microsToUsd(micros).split('.');
  return `$${whole}.${fraction.padEnd(2, '0')}`;
}
