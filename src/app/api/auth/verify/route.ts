import { NextResponse } from 'next/server';
import { z } from 'zod';
import { setSession, signInSecret, takeChallengeNonce } from '@/server/auth';
import { publicUrl } from '@/server/env';
import { apiError } from '@/server/http/api';
import { verifyChallenge } from '@/server/wallet-auth';

const body = z.object({
  message: z.string().min(1).max(2_000),
  signature: z.custom<`0x${string}`>((value) => typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value)),
});

export async function POST(request: Request) {
  const secret = signInSecret();
  if (!secret) return apiError('Sign-in is not configured.', 503);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError('That signature is not valid.', 400);

  const nonce = await takeChallengeNonce(secret);
  if (!nonce) return apiError('This sign-in request expired. Try again.', 401);
  const wallet = await verifyChallenge({ ...parsed.data, nonce, domain: new URL(publicUrl()).host });
  if (!wallet) return apiError('That signature is not valid.', 401);
  await setSession(wallet, secret);
  return NextResponse.json({ signedIn: true });
}
