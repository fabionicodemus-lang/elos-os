-- A contract can include several units. sales.unit_id remains its observed
-- principal; allocations are nullable evidence, never an automatic division.
begin;

create table public.commercial_sale_units(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),sale_id uuid not null references public.sales(id),unit_id uuid not null references public.units(id),
  is_primary boolean not null default false,allocated_amount numeric(16,2) check(allocated_amount is null or allocated_amount>=0),
  status text not null default 'active' check(status in('active','inactive')),
  source_system text,source_id text,source_relation_id text,source_record_id uuid references public.eobra_migration_records(id),
  created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(sale_id,unit_id),unique(company_id,source_system,source_id)
);
create unique index commercial_sale_units_primary_idx on public.commercial_sale_units(sale_id) where is_primary;
create unique index commercial_sale_units_active_unit_idx on public.commercial_sale_units(unit_id) where status='active';
create index commercial_sale_units_project_idx on public.commercial_sale_units(company_id,project_id,sale_id,status);
alter table public.commercial_sale_units enable row level security;
revoke all on public.commercial_sale_units from public,anon,authenticated;
grant select,insert,update on public.commercial_sale_units to authenticated;
create policy commercial_sale_units_read on public.commercial_sale_units for select to authenticated
using((public.has_company_permission(company_id,'sales.view') or public.has_company_permission(company_id,'sales.manage')) and exists(select 1 from public.projects p where p.id=commercial_sale_units.project_id and p.company_id=commercial_sale_units.company_id));
create policy commercial_sale_units_write on public.commercial_sale_units for all to authenticated
using(public.has_company_permission(company_id,'sales.manage') and exists(select 1 from public.projects p where p.id=commercial_sale_units.project_id and p.company_id=commercial_sale_units.company_id))
with check(public.has_company_permission(company_id,'sales.manage') and exists(select 1 from public.projects p where p.id=commercial_sale_units.project_id and p.company_id=commercial_sale_units.company_id));

create or replace function public.commercial_guard_sale_unit()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare s public.sales%rowtype;u public.units%rowtype;r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;rel public.eobra_migration_relations%rowtype;begin
  if tg_op='DELETE' then raise exception 'Vínculo de unidade deve ser preservado no histórico.';end if;
  select * into s from public.sales where id=new.sale_id and company_id=new.company_id and project_id=new.project_id for update;
  select * into u from public.units where id=new.unit_id and company_id=new.company_id and project_id=new.project_id for update;
  if s.id is null or u.id is null then raise exception 'Venda e unidade devem pertencer à mesma empresa e obra.';end if;
  if new.is_primary is distinct from (new.unit_id=s.unit_id) then raise exception 'Unidade principal deve corresponder à principal da venda.';end if;
  if new.status is distinct from (case when s.status='active' then 'active' else 'inactive' end) then raise exception 'Situação do vínculo deve acompanhar a situação da venda.';end if;
  if new.status='active' and (u.status='inactive' or exists(select 1 from public.sales other where other.company_id=new.company_id and other.unit_id=u.id and other.status='active' and other.id<>s.id)
    or exists(select 1 from public.commercial_sale_units other where other.unit_id=u.id and other.status='active' and other.sale_id<>s.id)) then raise exception 'Unidade inativa ou já vinculada a outra venda ativa.';end if;
  if tg_op='UPDATE' and old.source_system='eobra_snapshot' and (to_jsonb(new)-array['status','updated_at']) is distinct from (to_jsonb(old)-array['status','updated_at']) then raise exception 'Vínculo importado é evidência imutável; ajuste exige revisão explícita.';end if;
  if tg_op='INSERT' and new.source_system='eobra_snapshot' then
    select * into r from public.eobra_migration_records where id=new.source_record_id and company_id=new.company_id and project_id=new.project_id and entity='sale';
    select * into b from public.eobra_migration_runs where id=r.run_id;
    if r.id is null or b.status<>'ready' or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) or s.source_system<>'eobra_snapshot' or s.source_id is distinct from b.source_host||'|sale|'||r.source_id then raise exception 'Venda não corresponde à prévia importada.';end if;
    select link.* into rel from public.eobra_migration_relations link join public.eobra_migration_ledger l on l.company_id=b.company_id and l.source_host=b.source_host and l.entity='unit' and l.source_id=link.target_source_id and l.archive_type=''
      where link.record_id=r.id and link.role='unit' and link.target_entity='unit' and public.eobra_import_uuid(l.targets->>'units')=new.unit_id;
    if rel.id is null or new.allocated_amount is distinct from rel.allocated_amount or new.source_relation_id is distinct from rel.source_relation_id
      or new.source_id is distinct from b.source_host||'|sale|'||r.source_id||'|unit|'||rel.target_source_id then raise exception 'Alocação e identidade da unidade divergem da origem.';end if;
  elsif new.source_system is distinct from 'eobra_snapshot' and (new.source_record_id is not null or new.source_relation_id is not null and new.source_system is null) then raise exception 'Proveniência da relação incompleta.';end if;
  if tg_op='INSERT' then new.created_by:=auth.uid();new.created_at:=now();end if;
  new.updated_at:=now();return new;
end; $$;
create trigger commercial_sale_unit_guard before insert or update or delete on public.commercial_sale_units for each row execute function public.commercial_guard_sale_unit();

-- The row lock on units serializes claims from both the native principal path
-- and relational secondary units. No second active owner can slip between them.
create or replace function public.commercial_guard_sale_unit_claims()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare u public.units%rowtype;extra record;begin
  select * into u from public.units where id=new.unit_id and company_id=new.company_id and project_id=new.project_id for update;
  if u.id is null or not exists(select 1 from public.clients where id=new.client_id and company_id=new.company_id) then raise exception 'Unidade, cliente e venda devem pertencer à empresa e obra.';end if;
  if tg_op='UPDATE' and (new.unit_id,new.company_id,new.project_id) is distinct from (old.unit_id,old.company_id,old.project_id) and exists(select 1 from public.commercial_sale_units where sale_id=old.id) then raise exception 'Venda com unidades vinculadas exige revisão de todos os vínculos antes de alterar a principal.';end if;
  if new.status='active' then
    if u.status='inactive' or exists(select 1 from public.commercial_sale_units link where link.unit_id=new.unit_id and link.status='active' and link.sale_id<>new.id) then raise exception 'Unidade principal indisponível ou vinculada a outra venda ativa.';end if;
    for extra in select unit_id from public.commercial_sale_units where sale_id=new.id order by unit_id loop
      select * into u from public.units where id=extra.unit_id and company_id=new.company_id and project_id=new.project_id for update;
      if u.id is null or u.status='inactive' or exists(select 1 from public.sales other where other.unit_id=u.id and other.status='active' and other.id<>new.id)
        or exists(select 1 from public.commercial_sale_units other where other.unit_id=u.id and other.status='active' and other.sale_id<>new.id) then raise exception 'Uma das unidades da venda já está indisponível.';end if;
    end loop;
  end if;
  return new;
end; $$;
create trigger commercial_sale_unit_claims_guard before insert or update of company_id,project_id,unit_id,client_id,status on public.sales for each row execute function public.commercial_guard_sale_unit_claims();

create or replace function public.commercial_sync_sale_unit_status()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare link record;begin
  update public.commercial_sale_units set status=case when new.status='active' then 'active' else 'inactive' end,updated_at=now() where sale_id=new.id and status is distinct from (case when new.status='active' then 'active' else 'inactive' end);
  for link in select unit_id from public.commercial_sale_units where sale_id=new.id loop
    if new.status='active' then update public.units set status='sold',updated_at=now() where id=link.unit_id and company_id=new.company_id and project_id=new.project_id;
    elsif not exists(select 1 from public.sales where unit_id=link.unit_id and status='active') and not exists(select 1 from public.commercial_sale_units where unit_id=link.unit_id and status='active') then
      update public.units set status='available',updated_at=now() where id=link.unit_id and company_id=new.company_id and project_id=new.project_id and status='sold';
    end if;
  end loop;
  return new;
end; $$;
create trigger commercial_sale_units_sync after update of status on public.sales for each row when(old.status is distinct from new.status) execute function public.commercial_sync_sale_unit_status();

create or replace function public.commercial_guard_owned_unit_status()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ begin
  if new.status<>'sold' and (exists(select 1 from public.sales where unit_id=new.id and status='active') or exists(select 1 from public.commercial_sale_units where unit_id=new.id and status='active')) then raise exception 'Unidade vinculada a venda ativa deve permanecer vendida.';end if;
  return new;
end; $$;
create trigger commercial_owned_unit_status_guard before update of status on public.units for each row when(old.status is distinct from new.status) execute function public.commercial_guard_owned_unit_status();

create or replace function public.eobra_snapshot_promote_sale_units(p_record_id uuid,p_sale_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;s public.sales%rowtype;link record;target uuid;begin
  select * into r from public.eobra_migration_records where id=p_record_id and entity='sale';select * into b from public.eobra_migration_runs where id=r.run_id;
  select * into s from public.sales where id=p_sale_id and company_id=r.company_id and project_id=r.project_id;
  if r.id is null or b.status<>'ready' or r.review_status<>'ready' or s.id is null or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Venda sem prévia autorizada.';end if;
  for link in select rel.*,public.eobra_import_uuid(l.targets->>'units') target_id from public.eobra_migration_relations rel
    join public.eobra_migration_ledger l on l.company_id=b.company_id and l.source_host=b.source_host and l.entity='unit' and l.archive_type='' and l.source_id=rel.target_source_id
    where rel.record_id=r.id and rel.role='unit' and rel.target_entity='unit' order by public.eobra_import_uuid(l.targets->>'units') loop
    insert into public.commercial_sale_units(company_id,project_id,sale_id,unit_id,is_primary,allocated_amount,status,source_system,source_id,source_relation_id,source_record_id)
    values(r.company_id,r.project_id,s.id,link.target_id,link.target_id=s.unit_id,link.allocated_amount,case when s.status='active' then 'active' else 'inactive' end,'eobra_snapshot',b.source_host||'|sale|'||r.source_id||'|unit|'||link.target_source_id,link.source_relation_id,r.id);
    if s.status='active' then update public.units set status='sold',updated_at=now() where id=link.target_id and company_id=r.company_id and project_id=r.project_id;end if;
  end loop;
end; $$;

create or replace function public.eobra_snapshot_sale_units_match(p_record_id uuid,p_sale_id uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog,public
as $$ select
  (select count(*) from public.commercial_sale_units where sale_id=p_sale_id)=(select count(*) from public.eobra_migration_relations where record_id=p_record_id and role='unit' and target_entity='unit')
  and not exists(select 1 from public.eobra_migration_records r join public.eobra_migration_runs b on b.id=r.run_id join public.eobra_migration_relations rel on rel.record_id=r.id and rel.role='unit' and rel.target_entity='unit'
    join public.eobra_migration_ledger l on l.company_id=b.company_id and l.source_host=b.source_host and l.entity='unit' and l.archive_type='' and l.source_id=rel.target_source_id
    where r.id=p_record_id and not exists(select 1 from public.commercial_sale_units link where link.sale_id=p_sale_id and link.company_id=r.company_id and link.project_id=r.project_id and link.unit_id=public.eobra_import_uuid(l.targets->>'units') and link.allocated_amount is not distinct from rel.allocated_amount and link.source_relation_id is not distinct from rel.source_relation_id and link.source_record_id=r.id)); $$;

create or replace function public.eobra_snapshot_multi_unit_supported() returns boolean language sql immutable security invoker as $$ select true; $$;
do $$ declare f record;begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('commercial_guard_sale_unit','commercial_guard_sale_unit_claims','commercial_sync_sale_unit_status','commercial_guard_owned_unit_status','eobra_snapshot_promote_sale_units','eobra_snapshot_sale_units_match','eobra_snapshot_multi_unit_supported') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end; $$;
comment on table public.commercial_sale_units is 'All units of a contract. sales.unit_id is the observed principal; nullable allocations are never inferred.';
commit;
