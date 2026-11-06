-- saveProvider upserts with ON CONFLICT (owner_user_id). Postgres cannot use a
-- partial unique index (WHERE owner_user_id IS NOT NULL) to resolve that
-- conflict target, so the upsert failed with "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification".
-- A plain unique constraint works and still allows any number of NULLs.
drop index if exists developers_owner_user_id_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'developers_owner_user_id_key'
  ) then
    alter table developers
      add constraint developers_owner_user_id_key unique (owner_user_id);
  end if;
end $$;
