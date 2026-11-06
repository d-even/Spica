-- Newer Supabase projects do not grant the service role access to new tables
-- by default, so it needs explicit grants. Only the service role: anon and
-- authenticated stay locked out, because the browser never talks to these tables.

grant select, insert, update, delete on table
  developers,
  apis,
  transactions,
  agents,
  spending_policies,
  spend_reservations,
  payment_approvals,
  audit_logs,
  service_observations,
  payment_proofs
to service_role;

grant execute on function paygate_reserve_spend(uuid, text, bigint, bigint, bigint, bigint, text, text) to service_role;
grant execute on function paygate_spend_totals(uuid, text, timestamptz) to service_role;
