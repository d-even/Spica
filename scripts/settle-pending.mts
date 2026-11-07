/**
 * Asks Circle about every payment still marked settling.
 *   npm run payments:settle
 * A page load only refreshes its owner's payments, so accounts nobody reopens
 * stay stale. A record changes only when Circle gives a final answer, and that
 * change is published to the audit topic like any other.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.');
  process.exit(1);
}

const { refreshTransaction } = await import('@/server/settlement');
const { getStore } = await import('@/server/store');

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await db.from('transactions').select('id,user_id').eq('status', 'settling');
if (error) throw new Error(error.message);

const store = getStore();
const results: Record<string, number> = {};
for (const row of data) {
  const transaction = await store.getTransaction(row.user_id, row.id);
  const status = transaction ? (await refreshTransaction(store, transaction)).status : 'missing';
  results[status] = (results[status] ?? 0) + 1;
}

console.log(`Checked ${data.length} settling payments:`, results);
process.exit(0);
