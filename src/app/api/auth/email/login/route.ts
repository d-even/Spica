import { NextResponse } from 'next/server';
import { z } from 'zod';
import { LONG_SESSION_TTL_SECONDS, SHORT_SESSION_TTL_SECONDS, startSession } from '@/server/auth';
import { authClient, limited, NOT_AVAILABLE } from '@/server/email-auth';
import { apiError } from '@/server/http/api';

const body = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(254),
  password: z.string().min(1, 'Enter your password.').max(200),
  remember: z.boolean().default(false),
});

export async function POST(request: Request) {
  const refused = limited(request, 'login');
  if (refused) return refused;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);

  const auth = authClient();
  if (!auth) return apiError(NOT_AVAILABLE, 503);
  const { email, password, remember } = parsed.data;
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    if (error?.code === 'email_not_confirmed') return apiError('Confirm your email first, then sign in.', 403);
    if (error?.status !== undefined && error.status >= 500) {
      console.error('Email sign-in failed:', error.message);
      return apiError('Sign-in is unavailable right now. Try again shortly.', 503);
    }
    return apiError('That email or password is incorrect.', 401);
  }

  await startSession({ id: data.user.id, address: null, chain: null }, remember ? LONG_SESSION_TTL_SECONDS : SHORT_SESSION_TTL_SECONDS);
  return NextResponse.json({ signedIn: true });
}
