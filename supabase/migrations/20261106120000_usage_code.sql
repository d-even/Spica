-- The code a provider gives buyers after payment. Nullable: PayGate generates a
-- snippet for APIs without one. It is read only by the seller route and the owner.
alter table apis add column if not exists usage_code text;

notify pgrst, 'reload schema';
