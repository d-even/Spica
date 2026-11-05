-- PayGate spending firewall schema.
--
-- Additive and idempotent: it never drops or rewrites anything. The repository
-- held no earlier schema, so existing tables are declared with IF NOT EXISTS
-- and extended with ADD COLUMN IF NOT EXISTS. Review against your live database
-- before applying. Money columns are integer micro-USD.

create extension if not exists pgcrypto;

-- Existing PayGate tables ---------------------------------------------------

create table if not exists developers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  wallet_address text not null,
  ens_name text,
  created_at timestamptz not null default now()
);

create table if not exists apis (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid not null references developers(id) on delete cascade,
  endpoint text not null,
  price text not null,
  pay_to text not null,
  category text default 'Other',
  description text default '',
  tags text[] default '{}',
  is_public boolean default true,
  enabled boolean default true,
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  api_id uuid references apis(id) on delete set null,
  tx_hash text,
  amount text not null,
  from_address text,
  to_address text,
  verified boolean default false,
  created_at timestamptz not null default now()
);

-- Earlier versions required these; firewall records can lack them.
alter table transactions alter column api_id drop not null;
alter table transactions alter column tx_hash drop not null;

-- API providers map onto developers, API services onto apis.
alter table developers add column if not exists owner_user_id uuid;
alter table developers add column if not exists name text;
alter table developers add column if not exists hedera_account text;
create unique index if not exists developers_owner_user_id_key on developers (owner_user_id) where owner_user_id is not null;

alter table apis add column if not exists name text;
alter table apis add column if not exists price_micros bigint;
alter table apis add column if not exists supported_networks text[] not null default '{}';

alter table transactions add column if not exists user_id uuid;
alter table transactions add column if not exists agent_id uuid;
alter table transactions add column if not exists task_id text;
alter table transactions add column if not exists provider_key text;
alter table transactions add column if not exists provider_name text;
alter table transactions add column if not exists provider_ens text;
alter table transactions add column if not exists service_id text;
alter table transactions add column if not exists service_name text;
alter table transactions add column if not exists resource text;
alter table transactions add column if not exists amount_micros bigint;
alter table transactions add column if not exists token text;
alter table transactions add column if not exists network text;
alter table transactions add column if not exists status text;
alter table transactions add column if not exists status_detail text;
create index if not exists transactions_user_created_idx on transactions (user_id, created_at desc);
create index if not exists transactions_service_idx on transactions (service_id);

-- New tables ---------------------------------------------------------------

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  name text not null default 'PayGate Agent',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists spending_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  daily_limit bigint not null,
  monthly_limit bigint not null,
  per_request_limit bigint not null,
  approval_threshold bigint not null,
  auto_pay_enabled boolean not null default true,
  allowed_networks text[] not null default '{}',
  allowed_providers text[] not null default '{}',
  blocked_providers text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists spend_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  task_id text not null,
  amount_micros bigint not null check (amount_micros > 0),
  dedupe_hash text not null,
  requirement_hash text not null,
  status text not null default 'held' check (status in ('held', 'signing', 'committed', 'released')),
  created_at timestamptz not null default now()
);
create index if not exists spend_reservations_user_idx on spend_reservations (user_id, created_at desc);

create table if not exists payment_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  task_id text not null,
  service_id text not null,
  service_name text not null,
  provider_name text not null,
  amount_micros bigint not null,
  network text not null,
  requirement_hash text not null,
  reason text not null,
  request jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  transaction_id uuid,
  event_type text not null,
  event_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_user_idx on audit_logs (user_id, created_at desc);

create table if not exists service_observations (
  id bigint generated always as identity primary key,
  service_key text not null,
  reachable boolean not null,
  succeeded boolean not null,
  paid boolean not null,
  latency_ms integer not null,
  quoted_micros bigint,
  created_at timestamptz not null default now()
);
create index if not exists service_observations_key_idx on service_observations (service_key, created_at desc);

create table if not exists payment_proofs (
  id text primary key,
  created_at timestamptz not null default now()
);

-- Atomic reservation --------------------------------------------------------
-- The advisory lock serializes one user's reservations, so concurrent requests
-- cannot both pass the budget check. Limits and windows mirror MemoryStore.

create or replace function paygate_spend_totals(p_user uuid, p_task text, p_now timestamptz)
returns table (today bigint, month bigint, task bigint)
language sql stable as $$
  select
    coalesce(sum(amount_micros) filter (where created_at >= date_trunc('day', p_now at time zone 'utc') at time zone 'utc'), 0)::bigint,
    coalesce(sum(amount_micros) filter (where created_at >= date_trunc('month', p_now at time zone 'utc') at time zone 'utc'), 0)::bigint,
    coalesce(sum(amount_micros) filter (where task_id = p_task), 0)::bigint
  from spend_reservations
  where user_id = p_user
    and status <> 'released'
    and not (status = 'held' and created_at < p_now - interval '5 minutes');
$$;

create or replace function paygate_reserve_spend(
  p_user uuid,
  p_task text,
  p_amount bigint,
  p_daily_limit bigint,
  p_monthly_limit bigint,
  p_task_budget bigint,
  p_dedupe_hash text,
  p_requirement_hash text
) returns jsonb
language plpgsql as $$
declare
  v_now timestamptz := now();
  v_totals record;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  if exists (
    select 1 from spend_reservations
    where user_id = p_user
      and dedupe_hash = p_dedupe_hash
      and status <> 'released'
      and created_at > v_now - interval '60 seconds'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  select * into v_totals from paygate_spend_totals(p_user, p_task, v_now);

  if p_task_budget is not null and v_totals.task + p_amount > p_task_budget then
    return jsonb_build_object('ok', false, 'reason', 'task_budget');
  end if;
  if v_totals.today + p_amount > p_daily_limit then
    return jsonb_build_object('ok', false, 'reason', 'daily_limit');
  end if;
  if v_totals.month + p_amount > p_monthly_limit then
    return jsonb_build_object('ok', false, 'reason', 'monthly_limit');
  end if;

  insert into spend_reservations (user_id, task_id, amount_micros, dedupe_hash, requirement_hash)
  values (p_user, p_task, p_amount, p_dedupe_hash, p_requirement_hash)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'reservation_id', v_id);
end;
$$;

-- Row-level security --------------------------------------------------------
-- The browser never talks to these tables. The server uses the service-role
-- key, which bypasses RLS, and enforces ownership itself. With RLS on and no
-- policies, the public anon key can read and write nothing.

alter table developers enable row level security;
alter table apis enable row level security;
alter table transactions enable row level security;
alter table agents enable row level security;
alter table spending_policies enable row level security;
alter table spend_reservations enable row level security;
alter table payment_approvals enable row level security;
alter table audit_logs enable row level security;
alter table service_observations enable row level security;
alter table payment_proofs enable row level security;

revoke execute on function paygate_reserve_spend(uuid, text, bigint, bigint, bigint, bigint, text, text) from public, anon, authenticated;
revoke execute on function paygate_spend_totals(uuid, text, timestamptz) from public, anon, authenticated;
