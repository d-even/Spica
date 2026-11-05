import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authClient } from '@/server/auth';
import { supabaseConfig } from '@/server/env';
import { apiError } from '@/server/http/api';
import { allowRequest } from '@/server/http/rate-limit';

const body = z.object({ email: z.string().email('Enter a valid email address.') });

/** Sends a one-time sign-in code. Only reachable when Supabase is configured. */
export async function POST(request: Request) {
  if (!supabaseConfig()) return apiError('Sign-in is not configured.', 503);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);
  if (!allowRequest(`otp:${parsed.data.email}`, 5, 10 * 60_000)) return apiError('Too many attempts. Try again later.', 429);

  const { error } = await authClient().auth.signInWithOtp({ email: parsed.data.email });
  if (error) {
    console.error('OTP request failed:', error.message);
    return apiError('Could not send a code. Try again.', 502);
  }
  return NextResponse.json({ sent: true });
}
