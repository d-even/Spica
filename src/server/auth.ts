import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { mode, supabaseConfig } from '@/server/env';

export const SESSION_COOKIE = 'paygate_session';
export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001';

export interface SessionUser {
  id: string;
  email: string;
  demo: boolean;
}

export const authClient = () => {
  const config = supabaseConfig();
  if (!config) throw new Error('Supabase is not configured.');
  return createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
};

/**
 * The identity of every request comes from here, never from the request body.
 * With Supabase configured a real session is required. Without it, demo mode
 * uses one shared demo user, and live mode refuses (see getStore).
 */
export async function currentUser(): Promise<SessionUser | null> {
  if (!supabaseConfig()) {
    return mode() === 'demo' ? { id: DEMO_USER_ID, email: 'demo@paygate.local', demo: true } : null;
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { data, error } = await authClient().auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? '', demo: false };
}

export async function setSession(accessToken: string, maxAgeSeconds: number) {
  (await cookies()).set(SESSION_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
