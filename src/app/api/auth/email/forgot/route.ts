import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authClient, limited, NOT_AVAILABLE } from '@/server/email-auth';
import { publicUrl } from '@/server/env';
import { apiError } from '@/server/http/api';

const body = z.object({ email: z.string().trim().email('Enter a valid email address.').max(254) });

/** Answers the same way for every address, so it cannot be used to find accounts. */
export async function POST(request: Request) {
  const refused = limited(request, 'forgot', 5);
  if (refused) return refused;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);

  const auth = authClient();
  if (!auth) return apiError(NOT_AVAILABLE, 503);
  const { error } = await auth.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${publicUrl()}/reset-password` });
  if (error) console.error('Password reset email failed:', error.message);
  return NextResponse.json({ sent: true });
}
