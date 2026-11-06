-- The key a provider's own API needs. The hash identifies the key and cannot be
-- reversed. The encrypted copy is what lets PayGate call the API after payment.
-- The plain key is never stored. RLS stays on, so the public anon key reads nothing.
alter table apis add column if not exists api_key_hash text;
alter table apis add column if not exists api_key_encrypted text;
alter table apis add column if not exists api_key_placement text;
alter table apis add column if not exists api_key_name text;

alter table apis drop constraint if exists apis_api_key_placement_check;
alter table apis add constraint apis_api_key_placement_check
  check (api_key_placement is null or api_key_placement in ('bearer', 'header', 'query'));

notify pgrst, 'reload schema';
