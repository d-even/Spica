import { NextResponse } from 'next/server';
import { createPublicClient, getAddress, http } from 'viem';
import { arcTestnet } from 'viem/chains';
import { parseSiweMessage, verifySiweMessage } from 'viem/siwe';
import { z } from 'zod';
import { NONCE_TTL_SECONDS, startSession, takeNonce, walletUserId } from '@/server/auth';
import { publicUrl } from '@/server/env';
import { apiError } from '@/server/http/api';
import { allowRequest } from '@/server/http/rate-limit';

const body = z.object({
  chain: z.literal('arc-testnet', { message: 'Only Arc Testnet sign-in is available right now.' }),
  message: z.string().min(1).max(2_000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, 'Invalid signature.'),
});

const CLOCK_SKEW_MS = 60_000;

/**
 * Finishes wallet sign-in. The message must be for this site, on Arc Testnet,
 * carry the nonce this browser was given, be recent, and be signed by its
 * address. EOAs are checked by signature recovery; smart wallets through the
 * Arc RPC (ERC-1271 / ERC-6492).
 */
export async function POST(request: Request) {
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!allowRequest(`wallet:${client}`, 20, 10 * 60_000)) return apiError('Too many attempts. Try again later.', 429);

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);
  const { message, signature } = parsed.data;

  let nonce: string | null;
  try {
    nonce = await takeNonce();
  } catch (error) {
    console.error('Wallet sign-in unavailable:', (error as Error).message);
    return apiError('Wallet sign-in is not configured on this server.', 503);
  }
  if (!nonce) return apiError('This sign-in request expired. Try again.', 400);

  // The configured public URL, not the Host or X-Forwarded-Host headers, which a client can set.
  const host = new URL(publicUrl()).host;
  const fields = parseSiweMessage(message);
  const issuedAt = fields.issuedAt?.getTime();
  if (!fields.address || fields.chainId !== arcTestnet.id || fields.domain !== host) {
    if (fields.domain && fields.domain !== host) {
      console.error(`Wallet sign-in for ${fields.domain}, but PAYGATE_PUBLIC_URL is for ${host}.`);
    }
    return apiError('This sign-in message is not for this site or for Arc Testnet.', 400);
  }
  if (!issuedAt || issuedAt > Date.now() + CLOCK_SKEW_MS || Date.now() - issuedAt > NONCE_TTL_SECONDS * 1000) {
    return apiError('This sign-in request expired. Try again.', 400);
  }

  const rpc = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_TESTNET_RPC_URL) });
  const valid = await verifySiweMessage(rpc, {
    message,
    signature: signature as `0x${string}`,
    domain: host,
    nonce,
  }).catch((error) => {
    console.error('Signature check failed:', (error as Error).message);
    return false;
  });
  if (!valid) return apiError('The signature could not be verified.', 401);

  const address = getAddress(fields.address);
  await startSession({ id: walletUserId('evm', address), address, chain: 'arc-testnet' });
  return NextResponse.json({ address });
}
