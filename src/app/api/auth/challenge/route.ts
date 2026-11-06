import { NextResponse } from 'next/server';
import { isAddress, type Address } from 'viem';
import { z } from 'zod';
import { setChallengeNonce, signInSecret } from '@/server/auth';
import { publicUrl } from '@/server/env';
import { apiError } from '@/server/http/api';
import { allowRequest } from '@/server/http/rate-limit';
import { createChallenge } from '@/server/wallet-auth';

const body = z.object({
  address: z.string().refine((value) => isAddress(value), 'Enter a valid wallet address.'),
  chainId: z.number().int().positive(),
});

/** Issues the message a wallet signs to sign in. */
export async function POST(request: Request) {
  const secret = signInSecret();
  if (!secret) return apiError('Sign-in is not configured.', 503);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);
  const address = parsed.data.address as Address;
  if (!allowRequest(`challenge:${address.toLowerCase()}`, 10, 10 * 60_000)) return apiError('Too many attempts. Try again later.', 429);

  const url = new URL(publicUrl());
  const challenge = createChallenge({ address, chainId: parsed.data.chainId, domain: url.host, uri: url.origin });
  await setChallengeNonce(challenge.nonce, challenge.expiresAt, secret);
  return NextResponse.json({ message: challenge.message });
}
