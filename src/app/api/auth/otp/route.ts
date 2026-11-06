import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminAuthClient, authClient } from '@/server/auth';
import { resendConfigured, sendSignInCode } from '@/server/email';
import { supabaseConfig } from '@/server/env';
import { apiError } from '@/server/http/api';
import { allowRequest } from '@/server/http/rate-limit';

const body = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email address.') });

/**
 * Sends a one-time sign-in code. Only reachable when Supabase is configured.
 *
 * With Resend configured, Supabase only creates the code (generateLink sends no
 * email, and creates the user on first sign-in) and Resend delivers it, so
 * Supabase's email quota does not apply. The limits below are then the only
 * guard against abuse. Without Resend, Supabase sends the email itself.
 * Either way, /api/auth/verify checks the code with Supabase.
 */
export async function POST(request: Request) {
  if (!supabaseConfig()) return apiError('Sign-in is not configured.', 503);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);
  const { email } = parsed.data;

  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!allowRequest(`otp:${email}`, 5, 10 * 60_000) || !allowRequest(`otp-ip:${client}`, 20, 10 * 60_000)) {
    return apiError('Too many attempts. Try again later.', 429);
  }

  if (resendConfigured()) {
    try {
      const { data, error } = await adminAuthClient().generateLink({ type: 'magiclink', email });
      const code = data?.properties?.email_otp;
      if (error || !code) throw new Error(error?.message ?? 'Supabase returned no code.');
      await sendSignInCode(email, code);
    } catch (error) {
      console.error('OTP request failed:', (error as Error).message);
      return apiError('Could not send a code. Try again.', 502);
    }
    return NextResponse.json({ sent: true });
  }

  const { error } = await authClient().auth.signInWithOtp({ email });
  if (error) {
    console.error('OTP request failed:', error.message);
    return apiError('Could not send a code. Try again.', 502);
  }
  return NextResponse.json({ sent: true });
}
