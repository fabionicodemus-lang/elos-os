-- A customer/supplier catalog may be loaded before its financial snapshot.
-- Missing tax IDs never authorize name matching: reuse only the canonical
-- source identity, scoped to the same company and eObra host, under caller RLS.
begin;

create or replace function public.eobra_snapshot_expected_targets(p_record_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;v text;source_key text;target uuid;n integer;result jsonb:='{}';begin
  select * into r from public.eobra_migration_records where id=p_record_id;
  if r.entity='project' and r.project_id is not null then return jsonb_build_object('projects',r.project_id);end if;
  if r.entity='unit' then
    select * into b from public.eobra_migration_runs where id=r.run_id;
    if b.unit_map_confirmed_at is not null and b.unit_map->r.source_id->>'action'='reuse' then
      return jsonb_build_object('units',public.eobra_import_uuid(b.unit_map->r.source_id->>'unit_id'));
    end if;
  end if;
  if r.entity<>'person' then return result;end if;
  v:=nullif(regexp_replace(coalesce(r.normalized_data->>'tax_id',''),'[^0-9]','','g'),'');
  if v is null then
    select * into b from public.eobra_migration_runs where id=r.run_id and company_id=r.company_id;
    source_key:=b.source_host||'|person|'||r.source_id;
    if r.normalized_data->'roles' ? 'client' then
      select id into target from public.clients where company_id=r.company_id
        and source_system='eobra_snapshot' and source_id=source_key;
      if target is not null then result:=result||jsonb_build_object('clients',target);end if;
    end if;
    if r.normalized_data->'roles' ? 'supplier' then
      select id into target from public.suppliers where company_id=r.company_id
        and source_system='eobra_snapshot' and source_id=source_key;
      if target is not null then result:=result||jsonb_build_object('suppliers',target);end if;
    end if;
    return result;
  end if;
  if r.normalized_data->'roles' ? 'client' then
    select count(*),min(id::text)::uuid into n,target from public.clients where company_id=r.company_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=v;
    if n=1 then result:=result||jsonb_build_object('clients',target);end if;
  end if;
  if r.normalized_data->'roles' ? 'supplier' then
    select count(*),min(id::text)::uuid into n,target from public.suppliers where company_id=r.company_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=v;
    if n=1 then result:=result||jsonb_build_object('suppliers',target);end if;
  end if;
  return result;
end; $$;

commit;
