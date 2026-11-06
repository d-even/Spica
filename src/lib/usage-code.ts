/**
 * The code a buyer receives after paying for an API. Providers write it, and it
 * travels only in the paid response, so a listing or a 402 never reveals it.
 * Safe for client bundles.
 */
export const USAGE_CODE_HEADER = 'PAYGATE-USAGE-CODE';
export const MAX_USAGE_LINES = 3;
const MAX_USAGE_LENGTH = 600;

const lines = (code: string) => code.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);

export const isValidUsageCode = (code: string) => lines(code).length <= MAX_USAGE_LINES && code.length <= MAX_USAGE_LENGTH;

export const encodeUsageCode = (code: string) => Buffer.from(lines(code).join('\n'), 'utf8').toString('base64');

/** Returns null for anything that is not a valid code block. */
export function decodeUsageCode(header: string | null): string | null {
  if (!header) return null;
  const code = Buffer.from(header, 'base64').toString('utf8');
  return code.trim() && isValidUsageCode(code) ? code : null;
}

/** Runs as it is: the key stands in for a wallet, and PayGate pays on each call. */
export const developerApiCode = (url: string, apiKey: string) =>
  [
    `const res = await fetch(${JSON.stringify(url)}, { headers: { Authorization: "Bearer ${apiKey}" } });`,
    `const data = await res.json();`,
    `console.log(data);`,
  ].join('\n');

/** For catalog services PayGate does not sell. Each call needs a new x402 payment proof. */
export const defaultUsageCode = (url: string) =>
  [
    `const unpaid = await fetch(${JSON.stringify(url)}); // 402 with the price`,
    `const proof = await payWithAnyX402Client(unpaid.headers.get("PAYMENT-REQUIRED"));`,
    `const data = await fetch(${JSON.stringify(url)}, { headers: { "PAYMENT-SIGNATURE": proof } }).then((res) => res.json());`,
  ].join('\n');
