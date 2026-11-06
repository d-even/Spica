import 'server-only';
import { mode, supabaseConfig } from '@/server/env';
import { MemoryStore } from './memory';
import { SupabaseStore } from './supabase';
import type { SpendStore } from './types';

export * from './types';

const globals = globalThis as typeof globalThis & { paygateStore?: SpendStore };

/** One store per process. The global survives dev-server module reloads. */
export function getStore(): SpendStore {
  const supabase = supabaseConfig();
  // A store from before a dev reload runs old code. Supabase holds no state in memory, so it is safe to replace.
  const current = globals.paygateStore;
  if (current && (!supabase || current instanceof SupabaseStore)) return current;
  if (supabase) {
    globals.paygateStore = new SupabaseStore(supabase.url, supabase.serviceRoleKey);
  } else if (mode() === 'demo') {
    globals.paygateStore = new MemoryStore();
  } else {
    throw new Error('Live mode needs Supabase. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  return globals.paygateStore;
}
