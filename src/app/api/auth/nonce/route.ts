import { NextResponse } from 'next/server';
import { generateSiweNonce } from 'viem/siwe';
import { issueNonce } from '@/server/auth';
import { apiError } from '@/server/http/api';
import { allowRequest } from '@/server/http/rate-limit';

/** Starts wallet sign-in: a fresh nonce for the browser to put in its Sign-In with Ethereum message. */
export async function POST(request: Request) {
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!allowRequest(`nonce:${client}`, 30, 10 * 60_000)) return apiError('Too many attempts. Try again later.', 429);

  const nonce = generateSiweNonce();
  try {
    await issueNonce(nonce);
  } catch (error) {
    console.error('Wallet sign-in unavailable:', (error as Error).message);
    return apiError('Wallet sign-in is not configured on this server.', 503);
  }
  return NextResponse.json({ nonce });
}
