import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from '@/server/env';
import { apiError } from '@/server/http/api';
import { allowRequest } from '@/server/http/rate-limit';

/**
 * Email accounts live in Supabase Auth. Only the server talks to it, and each
 * call gets its own client, so a signed-in user never leaks into the
 * service-role client the store uses.
 */
export function authClient() {
  const config = supabaseConfig();
  if (!config) return null;
  return createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export const NOT_AVAILABLE = 'Email sign-in is not available on this server. Connect a wallet instead.';

/** Slows password guessing per client. Returns the refusal, or null to continue. */
export function limited(request: Request, action: string, requests = 10) {
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  return allowRequest(`email:${action}:${client}`, requests, 10 * 60_000) ? null : apiError('Too many attempts. Try again later.', 429);
}
