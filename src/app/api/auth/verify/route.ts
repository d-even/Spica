import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authClient, setSession } from '@/server/auth';
import { supabaseConfig } from '@/server/env';
import { apiError } from '@/server/http/api';
import { allowRequest } from '@/server/http/rate-limit';

const body = z.object({ email: z.string().trim().toLowerCase().email(), token: z.string().trim().min(6).max(10) });

export async function POST(request: Request) {
  if (!supabaseConfig()) return apiError('Sign-in is not configured.', 503);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError('Enter the code from your email.', 400);
  if (!allowRequest(`verify:${parsed.data.email}`, 10, 10 * 60_000)) return apiError('Too many attempts. Try again later.', 429);

  const { data, error } = await authClient().auth.verifyOtp({ ...parsed.data, type: 'email' });
  if (error || !data.session) {
    // Supabase's reason, never the code itself. All verifications come from this server's IP,
    // so Supabase's per-IP limit is shared by every user.
    console.error('OTP verify failed:', error?.status, error?.code, error?.message ?? 'no session returned');
    if (error?.status === 429) return apiError('Too many attempts. Try again in a few minutes.', 429);
    return apiError('That code is not valid or has expired. Request a new code and use the latest email.', 401);
  }
  await setSession(data.session.access_token, data.session.expires_in);
  return NextResponse.json({ signedIn: true });
}
