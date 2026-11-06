import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authClient, limited, NOT_AVAILABLE } from '@/server/email-auth';
import { apiError } from '@/server/http/api';

const body = z.object({
  token: z.string().min(1).max(4_000),
  password: z.string().min(8, 'Use at least 8 characters for your password.').max(200),
});

/** The token comes from the emailed link and proves who is asking. */
export async function POST(request: Request) {
  const refused = limited(request, 'reset');
  if (refused) return refused;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);

  const auth = authClient();
  if (!auth) return apiError(NOT_AVAILABLE, 503);
  const { data, error } = await auth.auth.getUser(parsed.data.token);
  if (error || !data.user) return apiError('This reset link has expired. Ask for a new one.', 400);
  const updated = await auth.auth.admin.updateUserById(data.user.id, { password: parsed.data.password });
  if (updated.error) {
    console.error('Password reset failed:', updated.error.message);
    return apiError('Could not change the password. Try a stronger one.', 400);
  }
  return NextResponse.json({ reset: true });
}
