-- The original auto-generated constraint name was truncated by PostgreSQL;
-- resolve it by its column identity rather than guessing its physical name.
begin;
do $$
declare legacy_constraint record;
begin
  if not exists (select 1 from pg_attribute where attrelid='public.execution_contract_measurement_items'::regclass and attname='contract_stage_id' and not attisdropped) then
    raise exception 'Migração de etapas contratuais ausente.';
  end if;
  for legacy_constraint in
    select c.conname from pg_constraint c
    where c.conrelid='public.execution_contract_measurement_items'::regclass and c.contype='u'
      and array_length(c.conkey,1)=2
      and (select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid=c.conrelid and a.attnum=any(c.conkey))=array['contract_item_id','measurement_id']::text[]
  loop
    execute format('alter table public.execution_contract_measurement_items drop constraint %I',legacy_constraint.conname);
  end loop;
end $$;
create unique index if not exists execution_contract_measurement_items_legacy_unique
  on public.execution_contract_measurement_items(measurement_id,contract_item_id) where contract_stage_id is null;
create unique index if not exists execution_contract_measurement_items_stage_unique
  on public.execution_contract_measurement_items(measurement_id,contract_stage_id) where contract_stage_id is not null;
commit;
