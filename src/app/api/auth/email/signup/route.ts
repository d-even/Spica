import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SHORT_SESSION_TTL_SECONDS, startSession } from '@/server/auth';
import { authClient, limited, NOT_AVAILABLE } from '@/server/email-auth';
import { publicUrl } from '@/server/env';
import { apiError } from '@/server/http/api';

const body = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(100),
  email: z.string().trim().email('Enter a valid email address.').max(254),
  password: z.string().min(8, 'Use at least 8 characters for your password.').max(200),
});

export async function POST(request: Request) {
  const refused = limited(request, 'signup', 5);
  if (refused) return refused;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);

  const auth = authClient();
  if (!auth) return apiError(NOT_AVAILABLE, 503);
  const { name, email, password } = parsed.data;
  const { data, error } = await auth.auth.signUp({
    email,
    password,
    options: { data: { name }, emailRedirectTo: `${publicUrl()}/login` },
  });
  if (error) {
    if (error.code === 'weak_password') return apiError('Choose a stronger password.', 400);
    if (error.code === 'email_address_invalid') return apiError('That email address cannot be used.', 400);
    if (error.code === 'over_email_send_rate_limit') return apiError('Too many sign-ups right now. Try again later.', 429);
    if (error.code !== 'user_already_exists') {
      console.error('Sign-up failed:', error.message);
      return apiError('Sign-up is unavailable right now. Try again shortly.', 503);
    }
  }

  // Without email confirmation Supabase returns a session straight away.
  if (data.session && data.user) {
    await startSession({ id: data.user.id, address: null, chain: null }, SHORT_SESSION_TTL_SECONDS);
    return NextResponse.json({ signedIn: true });
  }
  // The same answer whether or not the address already has an account.
  return NextResponse.json({ signedIn: false });
}
