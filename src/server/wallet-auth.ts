import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getAddress, verifyMessage, type Address, type Hex } from 'viem';
import { createSiweMessage, generateSiweNonce, parseSiweMessage, validateSiweMessage } from 'viem/siwe';

const CHALLENGE_TTL_MS = 5 * 60_000;
const STATEMENT = 'Sign in to PayGate. This does not send a transaction or cost anything.';

export type TokenPurpose = 'session' | 'challenge';

const mac = (purpose: TokenPurpose, body: string, secret: string) =>
  createHmac('sha256', secret).update(`${purpose}.${body}`).digest();

/** A signed, expiring cookie value. The purpose stops one kind standing in for the other. */
export function signToken(purpose: TokenPurpose, value: string, expiresAtMs: number, secret: string) {
  const body = Buffer.from(JSON.stringify({ value, expiresAtMs })).toString('base64url');
  return `${body}.${mac(purpose, body, secret).toString('base64url')}`;
}

export function readToken(purpose: TokenPurpose, token: string, secret: string, now = Date.now()): string | null {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = mac(purpose, body, secret);
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const { value, expiresAtMs } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  return expiresAtMs > now ? value : null;
}

/** Sign-In with Ethereum (EIP-4361). Built on the server so the client only signs it. */
export function createChallenge(input: { address: Address; chainId: number; domain: string; uri: string; now?: Date }) {
  const now = input.now ?? new Date();
  const nonce = generateSiweNonce();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  const message = createSiweMessage({
    address: getAddress(input.address),
    chainId: input.chainId,
    domain: input.domain,
    uri: input.uri,
    nonce,
    version: '1',
    statement: STATEMENT,
    issuedAt: now,
    expirationTime: expiresAt,
  });
  return { message, nonce, expiresAt };
}

/**
 * Returns the wallet that signed the challenge, or null. Verified locally, so
 * it needs no RPC, which also means EOAs only: smart-contract wallets are refused.
 */
export async function verifyChallenge(input: { message: string; signature: Hex; domain: string; nonce: string; now?: Date }): Promise<Address | null> {
  const fields = parseSiweMessage(input.message);
  if (!fields.address) return null;
  const valid = validateSiweMessage({ message: fields, domain: input.domain, nonce: input.nonce, time: input.now ?? new Date() });
  if (!valid) return null;
  const signed = await verifyMessage({ address: fields.address, message: input.message, signature: input.signature }).catch(() => false);
  return signed ? getAddress(fields.address) : null;
}

/** Tables key on a uuid, so each wallet maps to one stable id. */
export function walletUserId(address: string) {
  const bytes = createHash('sha256').update(`paygate:wallet:${address.toLowerCase()}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80; // RFC 9562 version 8: custom
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
