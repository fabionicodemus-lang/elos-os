-- eObra complete snapshots: immutable source evidence and explicit review.
-- This migration never modifies production records. Promotion is a separate RPC.
begin;

create or replace function public.eobra_snapshot_permissions(p_entity text,p_data jsonb default '{}'::jsonb)
returns text[] language sql immutable security invoker set search_path=pg_catalog
as $$ select case p_entity
  when 'project' then array['projects.manage']
  when 'unit' then array['projects.manage','sales.manage']
  when 'person' then array_remove(array['clients.manage','suppliers.manage',
    case when coalesce(p_data->'roles','[]'::jsonb) ? 'broker' then 'sales.manage' end],null)
  when 'sale' then array['sales.manage','clients.manage']
  when 'receivable' then array['receivables.manage','sales.manage','clients.manage']
  when 'payable' then array['payables.manage','suppliers.manage']
  when 'settlement' then array['receivables.manage','payables.manage']
  when 'bank_account' then array['finance.bank_accounts.manage']
  when 'bank_transaction' then array['finance.bank_accounts.manage']
  when 'correction_index' then array['receivables.manage']
  when 'index_value' then array['receivables.manage']
  when 'raw_archive' then array['projects.manage','sales.manage','clients.manage','suppliers.manage','payables.manage','receivables.manage','finance.bank_accounts.manage']
  else array[]::text[] end; $$;

create or replace function public.eobra_snapshot_authorized(p_company_id uuid,p_permissions text[])
returns boolean language sql stable security invoker set search_path=pg_catalog,public
as $$ select auth.uid() is not null and public.is_company_member(p_company_id)
  and public.has_company_permission(p_company_id,'admin.company.manage')
  and not exists(select 1 from unnest(coalesce(p_permissions,array[]::text[])) p
    where not public.has_company_permission(p_company_id,p)); $$;

create or replace function public.eobra_snapshot_projects_visible(p_company_id uuid,p_map jsonb)
returns boolean language sql stable security invoker set search_path=pg_catalog,public
as $$ select not exists(select 1 from jsonb_each(p_map) m where jsonb_typeof(m.value)<>'string' or not exists(select 1 from public.projects p where p.id=public.eobra_import_uuid(m.value#>>'{}') and p.company_id=p_company_id)); $$;

create table public.eobra_migration_runs(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id),
  source_host text not null check(source_host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.eobra\.com\.br$'),
  format text not null check(format='elos.eobra.snapshot.v1'),
  captured_at timestamptz not null,
  reference_date date not null,
  scope jsonb not null check(jsonb_typeof(scope)='object'),
  archive_types jsonb not null default '[]' check(jsonb_typeof(archive_types)='array'),
  project_map jsonb not null check(jsonb_typeof(project_map)='object'),
  required_permissions text[] not null,
  snapshot_hash text not null check(snapshot_hash ~ '^[0-9a-f]{64}$'),
  fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
  preview_hash text,
  status text not null default 'building' check(status in('building','review','ready','imported','cancelled')),
  summary jsonb not null default '{}' check(jsonb_typeof(summary)='object'),
  promotion_result jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  promoted_by uuid references auth.users(id),promoted_at timestamptz,
  cancelled_by uuid references auth.users(id),cancelled_at timestamptz
);
create index eobra_migration_runs_company_idx on public.eobra_migration_runs(company_id,created_at desc);
create index eobra_migration_runs_fingerprint_idx on public.eobra_migration_runs(company_id,fingerprint,status);

create table public.eobra_migration_snapshots(
  id uuid primary key default gen_random_uuid(),run_id uuid not null unique references public.eobra_migration_runs(id),
  company_id uuid not null references public.companies(id),project_id uuid references public.projects(id),
  document jsonb not null check(jsonb_typeof(document)='object'),
  snapshot_hash text not null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

create table public.eobra_migration_project_links(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),source_host text not null,source_id text not null,
  confirmed_by uuid not null default auth.uid() references auth.users(id),confirmed_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(company_id,source_host,source_id),unique(company_id,source_host,project_id)
);

create table public.eobra_migration_records(
  id uuid primary key default gen_random_uuid(),run_id uuid not null references public.eobra_migration_runs(id),
  company_id uuid not null references public.companies(id),project_id uuid references public.projects(id),
  source_ordinal integer not null check(source_ordinal>0),
  entity text not null check(entity in('project','person','unit','sale','receivable','payable','settlement','bank_account','bank_transaction','correction_index','index_value','raw_archive')),
  source_id text not null check(length(btrim(source_id)) between 1 and 200),
  source_project_id text,archive_type text not null default '',parent_source_id text,
  links jsonb not null default '[]' check(jsonb_typeof(links)='array'),
  raw_data jsonb not null check(jsonb_typeof(raw_data)='object'),
  normalized_data jsonb not null check(jsonb_typeof(normalized_data)='object'),
  source_errors jsonb not null default '[]' check(jsonb_typeof(source_errors)='array'),
  errors jsonb not null default '[]' check(jsonb_typeof(errors)='array'),
  warnings jsonb not null default '[]' check(jsonb_typeof(warnings)='array'),
  record_hash text not null,
  status text not null default 'ready' check(status in('ready','blocked','conflict','duplicate','archived','imported')),
  review_status text not null default 'ready' check(review_status in('ready','blocked','conflict','duplicate','archived')),
  expected_targets jsonb not null default '{}' check(jsonb_typeof(expected_targets)='object'),
  canonical_targets jsonb not null default '{}' check(jsonb_typeof(canonical_targets)='object'),
  created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(run_id,source_ordinal),
  check((entity='raw_archive' and length(archive_type)>0) or (entity<>'raw_archive' and archive_type=''))
);
create index eobra_migration_records_scope_idx on public.eobra_migration_records(company_id,project_id,run_id,entity,status);
create index eobra_migration_records_run_idx on public.eobra_migration_records(run_id,status,entity,source_id);
create index eobra_migration_records_identity_idx on public.eobra_migration_records(run_id,entity,archive_type,source_id);

create table public.eobra_migration_relations(
  id uuid primary key default gen_random_uuid(),run_id uuid not null references public.eobra_migration_runs(id),
  record_id uuid not null references public.eobra_migration_records(id),company_id uuid not null references public.companies(id),project_id uuid references public.projects(id),
  ordinal integer not null check(ordinal>0),target_entity text not null,target_source_id text not null,target_archive_type text not null default '',
  role text not null,source_relation_id text,is_primary boolean,allocated_amount numeric(16,2),ownership_percent numeric(8,4),
  attributes jsonb not null check(jsonb_typeof(attributes)='object'),
  created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(record_id,ordinal)
);
create index eobra_migration_relations_target_idx on public.eobra_migration_relations(run_id,target_entity,target_source_id);

create table public.eobra_migration_coverage(
  id uuid primary key default gen_random_uuid(),run_id uuid not null references public.eobra_migration_runs(id),
  company_id uuid not null references public.companies(id),project_id uuid references public.projects(id),
  entity text not null,source_project_id text,archive_type text not null default '',
  declared jsonb not null check(jsonb_typeof(declared)='object'),expected_count integer,actual_count integer not null default 0,
  verified boolean not null default false,errors jsonb not null default '[]' check(jsonb_typeof(errors)='array'),
  created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index eobra_migration_coverage_identity_idx on public.eobra_migration_coverage(run_id,entity,coalesce(source_project_id,''),archive_type);

create table public.eobra_migration_ledger(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid references public.projects(id),
  source_host text not null,entity text not null,source_id text not null,source_project_id text,archive_type text not null default '',
  record_hash text not null,targets jsonb not null default '{}' check(jsonb_typeof(targets)='object'),
  disposition text not null check(disposition in('canonical','source_archive')),
  run_id uuid not null references public.eobra_migration_runs(id),record_id uuid not null references public.eobra_migration_records(id),
  required_permissions text[] not null,
  created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(company_id,source_host,entity,archive_type,source_id)
);
create index eobra_migration_ledger_scope_idx on public.eobra_migration_ledger(company_id,project_id,entity);

-- Source banking and correction values are retained separately from cash operations.
create table public.eobra_source_accounts(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid references public.projects(id),
  run_id uuid not null references public.eobra_migration_runs(id),record_id uuid not null unique references public.eobra_migration_records(id),
  source_host text not null,source_id text not null,details jsonb not null,
  created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(company_id,source_host,source_id)
);
create table public.eobra_source_indices(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid references public.projects(id),
  run_id uuid not null references public.eobra_migration_runs(id),record_id uuid not null unique references public.eobra_migration_records(id),
  source_host text not null,source_id text not null,entity text not null check(entity in('correction_index','index_value')),
  parent_index_id uuid references public.eobra_source_indices(id),reference_month date,index_value numeric(24,10),details jsonb not null,
  created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(company_id,source_host,entity,source_id)
);
create table public.eobra_source_events(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid references public.projects(id),
  run_id uuid not null references public.eobra_migration_runs(id),record_id uuid not null unique references public.eobra_migration_records(id),
  source_host text not null,source_id text not null,entity text not null check(entity in('settlement','bank_transaction')),
  title_ledger_id uuid references public.eobra_migration_ledger(id),account_id uuid references public.eobra_source_accounts(id),
  receivable_id uuid references public.receivables(id),payable_id uuid references public.payables(id),
  reverses_event_id uuid references public.eobra_source_events(id),settlement_event_id uuid references public.eobra_source_events(id),
  kind text not null,occurred_on date not null,amount numeric(16,2) not null check(amount>0),medium text,
  posting_policy text not null default 'historical_source_only' check(posting_policy='historical_source_only'),details jsonb not null,
  bank_transaction_id uuid references public.finance_bank_transactions(id) check(bank_transaction_id is null),
  created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(company_id,source_host,entity,source_id)
);
create index eobra_source_events_title_idx on public.eobra_source_events(company_id,project_id,title_ledger_id,occurred_on);
create index eobra_source_events_receivable_idx on public.eobra_source_events(company_id,receivable_id,occurred_on) where receivable_id is not null;
create index eobra_source_events_payable_idx on public.eobra_source_events(company_id,payable_id,occurred_on) where payable_id is not null;

do $$ declare t text;begin
  foreach t in array array['eobra_migration_runs','eobra_migration_snapshots','eobra_migration_records','eobra_migration_relations','eobra_migration_coverage','eobra_migration_ledger','eobra_migration_project_links','eobra_source_accounts','eobra_source_indices','eobra_source_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
  end loop;
end; $$;
create policy eobra_migration_runs_access on public.eobra_migration_runs for all to authenticated
using(public.eobra_snapshot_authorized(company_id,required_permissions) and public.eobra_snapshot_projects_visible(company_id,project_map)) with check(public.eobra_snapshot_authorized(company_id,required_permissions) and public.eobra_snapshot_projects_visible(company_id,project_map));
create policy eobra_migration_ledger_access on public.eobra_migration_ledger for all to authenticated
using(public.eobra_snapshot_authorized(company_id,required_permissions) and (project_id is null or exists(select 1 from public.projects p where p.id=eobra_migration_ledger.project_id and p.company_id=eobra_migration_ledger.company_id)))
with check(public.eobra_snapshot_authorized(company_id,required_permissions) and (project_id is null or exists(select 1 from public.projects p where p.id=eobra_migration_ledger.project_id and p.company_id=eobra_migration_ledger.company_id)));
create policy eobra_migration_project_links_access on public.eobra_migration_project_links for all to authenticated
using(public.eobra_snapshot_authorized(company_id,array['projects.manage']) and exists(select 1 from public.projects p where p.id=eobra_migration_project_links.project_id and p.company_id=eobra_migration_project_links.company_id))
with check(public.eobra_snapshot_authorized(company_id,array['projects.manage']) and exists(select 1 from public.projects p where p.id=eobra_migration_project_links.project_id and p.company_id=eobra_migration_project_links.company_id));
do $$ declare t text;begin
  foreach t in array array['eobra_migration_snapshots','eobra_migration_records','eobra_migration_relations','eobra_migration_coverage','eobra_source_accounts','eobra_source_indices','eobra_source_events'] loop
    execute format('create policy %I on public.%I for all to authenticated using(exists(select 1 from public.eobra_migration_runs r where r.id=%I.run_id and r.company_id=%I.company_id and (%I.project_id is null or exists(select 1 from public.projects p where p.id=%I.project_id and p.company_id=r.company_id)))) with check(exists(select 1 from public.eobra_migration_runs r where r.id=%I.run_id and r.company_id=%I.company_id and (%I.project_id is null or exists(select 1 from public.projects p where p.id=%I.project_id and p.company_id=r.company_id))))',t||'_access',t,t,t,t,t,t,t,t,t);
  end loop;
end; $$;
grant select,insert,update on public.eobra_migration_runs,public.eobra_migration_records,public.eobra_migration_coverage to authenticated;
grant select,insert on public.eobra_migration_snapshots,public.eobra_migration_relations,public.eobra_migration_project_links,public.eobra_migration_ledger,public.eobra_source_accounts,public.eobra_source_indices,public.eobra_source_events to authenticated;
create policy eobra_source_settlement_read on public.eobra_source_events for select to authenticated
using(entity='settlement' and public.is_company_member(company_id) and (
  exists(select 1 from public.receivables r where r.id=eobra_source_events.receivable_id and r.company_id=eobra_source_events.company_id and r.project_id=eobra_source_events.project_id)
  or exists(select 1 from public.payables p where p.id=eobra_source_events.payable_id and p.company_id=eobra_source_events.company_id and p.project_id=eobra_source_events.project_id)));

create or replace function public.eobra_snapshot_record_hash(p_entity text,p_id text,p_project text,p_archive text,p_parent text,p_raw jsonb,p_data jsonb,p_links jsonb)
returns text language sql immutable security invoker set search_path=pg_catalog,public
as $$ select public.eobra_import_hash(jsonb_build_object('entity',p_entity,'sourceId',p_id,'sourceProjectId',p_project,'archiveType',p_archive,'parentSourceId',p_parent,'raw',p_raw,'normalized',p_data,'links',coalesce((select jsonb_agg(x order by x::text) from jsonb_array_elements(p_links) x),'[]'::jsonb))); $$;

create or replace function public.eobra_snapshot_resolve_link(p_record_id uuid,p_role text,p_entity text default null)
returns uuid language sql stable security invoker set search_path=pg_catalog,public
as $$ select t.id from public.eobra_migration_records r join public.eobra_migration_relations l on l.record_id=r.id
  join public.eobra_migration_records t on t.run_id=r.run_id and t.entity=l.target_entity and t.source_id=l.target_source_id and t.archive_type=l.target_archive_type
  where r.id=p_record_id and l.role=p_role and (p_entity is null or t.entity=p_entity)
  order by l.is_primary desc nulls last,l.ordinal limit 1; $$;

create or replace function public.eobra_snapshot_expected_targets(p_record_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare r public.eobra_migration_records%rowtype;v text;target uuid;n integer;result jsonb:='{}';begin
  select * into r from public.eobra_migration_records where id=p_record_id;
  if r.entity='project' and r.project_id is not null then return jsonb_build_object('projects',r.project_id);end if;
  if r.entity<>'person' then return result;end if;
  v:=nullif(regexp_replace(coalesce(r.normalized_data->>'tax_id',''),'[^0-9]','','g'),'');
  if v is null then return result;end if;
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

create or replace function public.eobra_snapshot_guard_source()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare r public.eobra_migration_runs%rowtype;row_data jsonb:=to_jsonb(new);perms text[];record_row public.eobra_migration_records%rowtype;source_link jsonb;begin
  if tg_op<>'INSERT' then raise exception 'A evidência de origem é imutável; prepare outro snapshot.';end if;
  select * into r from public.eobra_migration_runs where id=(row_data->>'run_id')::uuid for update;
  if not found or r.status<>'building' or r.company_id<>(row_data->>'company_id')::uuid then raise exception 'Origem fora do snapshot em preparação.';end if;
  if nullif(row_data->>'project_id','') is not null and not exists(select 1 from public.projects where id=(row_data->>'project_id')::uuid and company_id=r.company_id) then raise exception 'Obra fora da empresa do snapshot.';end if;
  if tg_table_name='eobra_migration_snapshots' then
    if public.eobra_import_hash(row_data->'document')<>r.snapshot_hash or row_data->>'snapshot_hash'<>r.snapshot_hash then raise exception 'Hash do snapshot divergente.';end if;
    if row_data->'document'->>'format' is distinct from r.format
      or coalesce(row_data->'document'->'source'->>'capturedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or lower(btrim(row_data->'document'->'source'->>'host')) is distinct from r.source_host
      or (row_data->'document'->'source'->>'capturedAt')::timestamptz is distinct from r.captured_at
      or public.eobra_import_date(row_data->'document'->'source'->>'referenceDate') is distinct from r.reference_date
      or row_data->'document'->'scope' is distinct from r.scope
      or coalesce(row_data->'document'->'archiveTypes','[]'::jsonb) is distinct from r.archive_types
      or row_data->>'project_id' is not null
      or jsonb_typeof(row_data->'document'->'coverage') is distinct from 'array'
      or jsonb_typeof(r.scope->'projectIds') is distinct from 'array' or jsonb_typeof(r.scope->'allProjects') is distinct from 'boolean'
      or jsonb_array_length(row_data->'document'->'records') not between 1 and 100000
      or octet_length((row_data->'document')::text)>62914560 then raise exception 'Metadados do snapshot divergem do documento de origem.';end if;
    if r.fingerprint is distinct from public.eobra_import_hash(jsonb_build_object('company',r.company_id,'host',r.source_host,'snapshot',r.snapshot_hash,'project_map',r.project_map))
      or exists(select 1 from jsonb_each(r.project_map) m where not r.scope->'projectIds' ? m.key)
      or exists(select 1 from jsonb_array_elements(r.scope->'projectIds') v where jsonb_typeof(v)<>'string' or nullif(btrim(v#>>'{}'),'') is null)
      or (select count(*) from jsonb_array_elements(r.scope->'projectIds'))<>(select count(distinct v) from jsonb_array_elements(r.scope->'projectIds') v) then raise exception 'Escopo ou identidade do snapshot inválidos.';end if;
    select coalesce(array_agg(distinct permission order by permission),array[]::text[]) into perms from jsonb_array_elements(row_data->'document'->'records') v cross join lateral unnest(public.eobra_snapshot_permissions(v->>'entity',coalesce(v->'normalized','{}'))) permission;
    if perms is distinct from r.required_permissions or not public.eobra_snapshot_authorized(r.company_id,perms) then raise exception 'Permissões do snapshot divergem das entidades capturadas.';end if;
  elsif tg_table_name='eobra_migration_relations' then
    select * into record_row from public.eobra_migration_records where id=(row_data->>'record_id')::uuid and run_id=r.id and company_id=r.company_id;
    source_link:=record_row.links->((row_data->>'ordinal')::int-1);
    if record_row.id is null or row_data->'attributes' is distinct from source_link or row_data->>'target_entity' is distinct from source_link->>'entity' or row_data->>'target_source_id' is distinct from source_link->>'sourceId' or row_data->>'role' is distinct from source_link->>'role' or row_data->>'project_id' is distinct from record_row.project_id::text then raise exception 'Relação diverge dos vínculos capturados.';end if;
    if row_data->>'is_primary' is distinct from source_link->>'primary' or row_data->>'target_archive_type' is distinct from coalesce(source_link->>'archiveType','') then raise exception 'Metadados da relação divergem da origem.';end if;
    if nullif(row_data->>'source_relation_id','') is distinct from nullif(source_link->>'source_relation_id','')
      or (row_data->>'allocated_amount')::numeric is distinct from public.eobra_import_money(source_link->>'allocated_amount')
      or (row_data->>'ownership_percent')::numeric is distinct from (case when source_link->>'ownership_percent' ~ '^[0-9]{1,3}(\.[0-9]{1,4})?$' then (source_link->>'ownership_percent')::numeric end) then raise exception 'Valores da relação divergem da origem.';end if;
  end if;
  new.created_by:=auth.uid();new.created_at:=now();new.updated_at:=now();return new;
end; $$;
create trigger eobra_snapshot_document_guard before insert or update or delete on public.eobra_migration_snapshots for each row execute function public.eobra_snapshot_guard_source();
create trigger eobra_snapshot_relations_guard before insert or update or delete on public.eobra_migration_relations for each row execute function public.eobra_snapshot_guard_source();

create or replace function public.eobra_snapshot_guard_project_link()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ begin
  if tg_op<>'INSERT' then raise exception 'O de-para confirmado é imutável.';end if;
  if not public.eobra_snapshot_authorized(new.company_id,array['projects.manage']) or not exists(select 1 from public.projects where id=new.project_id and company_id=new.company_id) then raise exception 'Obra fora da empresa ou sem permissão.';end if;
  if new.source_host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.eobra\.com\.br$' or nullif(btrim(new.source_id),'') is null then raise exception 'Identidade de obra de origem inválida.';end if;
  new.created_by:=auth.uid();new.confirmed_by:=auth.uid();new.created_at:=now();new.confirmed_at:=now();new.updated_at:=now();return new;
end; $$;
create trigger eobra_snapshot_project_link_guard before insert or update or delete on public.eobra_migration_project_links for each row execute function public.eobra_snapshot_guard_project_link();

-- Additional validators/RPCs are appended below; none trusts caller-provided totals.
create or replace function public.eobra_snapshot_partial_supported() returns boolean language sql immutable security invoker as $$ select false; $$;
create or replace function public.eobra_snapshot_payable_adjustments_supported() returns boolean language sql immutable security invoker as $$ select false; $$;
create or replace function public.eobra_snapshot_multi_unit_supported() returns boolean language sql immutable security invoker as $$ select false; $$;
create or replace function public.eobra_snapshot_signed_money(p_value text)
returns numeric language sql immutable security invoker set search_path=pg_catalog
as $$ select case when p_value ~ '^-?[0-9]{1,14}(\.[0-9]{1,2})?$' then p_value::numeric end; $$;

create or replace function public.eobra_snapshot_record_errors(p_record_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$
declare r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;t public.eobra_migration_records%rowtype;l record;
  d jsonb;e jsonb:='[]';v text;k text;n integer;n_primary integer;original numeric;current_value numeric;paid numeric;balance numeric;adjustment numeric:=0;net_events numeric;target uuid;
  index_record public.eobra_migration_records%rowtype;point_count integer;point_value numeric;effective_value numeric;base_month date;reference_month date;months_expected integer;
begin
  select * into r from public.eobra_migration_records where id=p_record_id;
  if not found then return jsonb_build_array('Registro indisponível.');end if;
  select * into b from public.eobra_migration_runs where id=r.run_id;d:=r.normalized_data;e:=r.source_errors;
  if exists(select 1 from public.eobra_migration_records q where q.run_id=r.run_id and q.entity=r.entity and q.archive_type=r.archive_type and q.source_id=r.source_id and q.id<>r.id) then e:=e||jsonb_build_array('Identidade repetida no pacote; todas as versões foram preservadas e exigem conferência.');end if;
  if not public.eobra_snapshot_authorized(r.company_id,public.eobra_snapshot_permissions(r.entity,d)) then raise exception 'Sem permissão nativa para esta entidade.';end if;
  if r.entity in('unit','sale','receivable','payable','settlement') and r.source_project_id is null then e:=e||jsonb_build_array('Obra de origem obrigatória para esta entidade.');end if;
  if r.source_project_id is not null then
    if not b.scope->'projectIds' ? r.source_project_id then e:=e||jsonb_build_array('Obra de origem fora do escopo declarado.');end if;
    if r.project_id is null or not exists(select 1 from public.eobra_migration_project_links m where m.company_id=r.company_id and m.source_host=b.source_host and m.source_id=r.source_project_id and m.project_id=r.project_id) then e:=e||jsonb_build_array('Confirme o de-para desta obra com uma obra real da empresa.');end if;
  end if;
  for l in select * from public.eobra_migration_relations where record_id=r.id loop
    select * into t from public.eobra_migration_records where run_id=r.run_id and entity=l.target_entity and source_id=l.target_source_id and archive_type=l.target_archive_type;
    if not found then e:=e||jsonb_build_array('Referência ausente no pacote: '||l.role||' / '||l.target_entity||' / '||l.target_source_id);continue;end if;
    if r.source_project_id is not null and t.source_project_id is not null and r.source_project_id<>t.source_project_id then e:=e||jsonb_build_array('Referência pertence a outra obra: '||l.role);end if;
    if t.entity='project' and r.source_project_id is not null and t.source_id<>r.source_project_id then e:=e||jsonb_build_array('Link de obra diverge da obra de origem do registro.');end if;
    if l.allocated_amount is not null and l.allocated_amount<0 or l.ownership_percent is not null and (l.ownership_percent<0 or l.ownership_percent>100) then e:=e||jsonb_build_array('Alocação ou participação da relação é inválida.');end if;
    if l.attributes->>'allocated_amount' is not null and l.allocated_amount is null or l.attributes->>'ownership_percent' is not null and l.ownership_percent is null then e:=e||jsonb_build_array('Valor da relação não pôde ser interpretado sem arredondamento.');end if;
  end loop;
  if r.parent_source_id is not null and (select count(*) from public.eobra_migration_relations where record_id=r.id and role='parent' and target_source_id=r.parent_source_id)<>1 then e:=e||jsonb_build_array('Pai informado exige uma única relação parent correspondente.');end if;
  if r.entity='raw_archive' then
    if not exists(select 1 from jsonb_array_elements(b.archive_types) a where a->>'key'=r.archive_type) then e:=e||jsonb_build_array('Tipo de arquivo complementar não declarado.');end if;
    return e;
  end if;
  if r.entity='project' then
    if jsonb_typeof(d->'name') is distinct from 'string' or nullif(btrim(d->>'name'),'') is null then e:=e||jsonb_build_array('Nome da obra obrigatório.');end if;
    if b.scope->'projectIds' ? r.source_id and (r.project_id is null or not exists(select 1 from public.eobra_migration_project_links m where m.company_id=r.company_id and m.source_host=b.source_host and m.source_id=r.source_id and m.project_id=r.project_id)) then e:=e||jsonb_build_array('Obra do escopo sem de-para confirmado.');end if;
  elsif r.entity='person' then
    if jsonb_typeof(d->'name') is distinct from 'string' or nullif(btrim(d->>'name'),'') is null then e:=e||jsonb_build_array('Nome da pessoa obrigatório.');end if;
    if coalesce(d->>'person_type','') not in('PF','PJ','OTHER') or coalesce(d->>'status','') not in('active','inactive') then e:=e||jsonb_build_array('Tipo de pessoa ou situação inválidos.');end if;
    if jsonb_typeof(d->'roles') is distinct from 'array' or not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(d->'roles')='array' then d->'roles' else '[]'::jsonb end) role where role in('client','supplier','broker','other')) then e:=e||jsonb_build_array('Papéis da pessoa devem ser explícitos.');end if;
    if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(d->'roles')='array' then d->'roles' else '[]'::jsonb end) role where jsonb_typeof(role)<>'string' or role#>>'{}' not in('client','supplier','broker','other')) then e:=e||jsonb_build_array('Papel de pessoa não reconhecido.');end if;
    if not public.eobra_import_tax_id_valid(d->>'tax_id') then e:=e||jsonb_build_array('CPF/CNPJ inválido.');end if;
    v:=nullif(regexp_replace(coalesce(d->>'tax_id',''),'[^0-9]','','g'),'');
    if v is not null then
      if (length(v)=11 and d->>'person_type'='PJ') or (length(v)=14 and d->>'person_type'='PF') then e:=e||jsonb_build_array('Tipo de pessoa diverge do CPF/CNPJ.');end if;
      if d->'roles' ? 'client' and (select count(*) from public.clients where company_id=r.company_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=v)>1 then e:=e||jsonb_build_array('CPF/CNPJ corresponde a mais de um cliente no Elos.');end if;
      if d->'roles' ? 'supplier' and (select count(*) from public.suppliers where company_id=r.company_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=v)>1 then e:=e||jsonb_build_array('CPF/CNPJ corresponde a mais de um fornecedor no Elos.');end if;
      if exists(select 1 from public.eobra_migration_records p where p.run_id=r.run_id and p.entity='person' and p.id<>r.id and regexp_replace(coalesce(p.normalized_data->>'tax_id',''),'[^0-9]','','g')=v and ((p.normalized_data->'roles' ? 'client' and d->'roles' ? 'client') or (p.normalized_data->'roles' ? 'supplier' and d->'roles' ? 'supplier'))) then e:=e||jsonb_build_array('Pessoas distintas na origem compartilham CPF/CNPJ e papel; confirme a identidade antes de promover.');end if;
    end if;
    if b.status<>'building' and public.eobra_snapshot_expected_targets(r.id) is distinct from r.expected_targets then e:=e||jsonb_build_array('O cadastro correspondente mudou após a revisão; prepare outro snapshot.');end if;
  elsif r.entity='unit' then
    if nullif(btrim(d->>'code'),'') is null or coalesce(d->>'status','') not in('available','reserved','sold','inactive') then e:=e||jsonb_build_array('Código ou situação da unidade inválidos.');end if;
    if (select count(*) from public.eobra_migration_relations where record_id=r.id and role='project' and target_entity='project')<>1 then e:=e||jsonb_build_array('Unidade exige uma relação explícita com a obra.');end if;
    if exists(select 1 from public.eobra_migration_records u where u.run_id=r.run_id and u.entity='unit' and u.id<>r.id and u.source_project_id=r.source_project_id and u.normalized_data->>'code'=d->>'code') then e:=e||jsonb_build_array('Código de unidade repetido na mesma obra.');end if;
    if exists(select 1 from public.units u where u.company_id=r.company_id and u.project_id=r.project_id and u.code=d->>'code' and (u.source_system is distinct from 'eobra_snapshot' or u.source_id is distinct from b.source_host||'|unit|'||r.source_id)) then e:=e||jsonb_build_array('Unidade já existe no Elos sem identidade desta importação; não será sobrescrita.');end if;
    foreach k in array array['private_area','total_area','common_area','uncovered_private_area','fractional_share','list_price'] loop
      if d->>k is not null and (case when k='fractional_share' then d->>k !~ '^[0-9]{1,4}(\.[0-9]{1,10})?$' when k='list_price' then public.eobra_import_money(d->>k) is null else d->>k !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' end) then e:=e||jsonb_build_array('Detalhe numérico de unidade inválido ou excede a precisão do destino: '||k);end if;
    end loop;
    foreach k in array array['floor','bedrooms','suites','parking_spaces'] loop
      if d->>k is not null and (case when d->>k ~ '^-?[0-9]{1,6}$' then k<>'floor' and (d->>k)::numeric<0 else true end) then e:=e||jsonb_build_array('Detalhe inteiro de unidade inválido: '||k);end if;
    end loop;
  elsif r.entity='sale' then
    if d->>'status'='draft' then return e;end if;
    if nullif(btrim(d->>'number'),'') is null or coalesce(d->>'status','') not in('active','cancelled') or public.eobra_import_date(d->>'sale_date') is null or public.eobra_import_money(d->>'total_amount') is null then e:=e||jsonb_build_array('Número, data, valor ou situação da venda inválidos.');end if;
    foreach k in array array['unit','buyer'] loop
      select count(*),count(*) filter(where is_primary) into n,n_primary from public.eobra_migration_relations where record_id=r.id and role=k and target_entity=case when k='unit' then 'unit' else 'person' end;
      if n=0 or (n>1 and n_primary<>1) or n_primary>1 then e:=e||jsonb_build_array('Venda exige '||k||' principal observado; nenhuma relação será escolhida por posição.');end if;
      if n=1 and exists(select 1 from public.eobra_migration_relations where record_id=r.id and role=k and is_primary=false) then e:=e||jsonb_build_array('Único vínculo capturado está explicitamente marcado como secundário: '||k);end if;
      if k='unit' and n>1 and not public.eobra_snapshot_multi_unit_supported() then e:=e||jsonb_build_array('Venda com múltiplas unidades preservada; promoção depende do suporte relacional do destino.');end if;
      if exists(select 1 from public.eobra_migration_relations where record_id=r.id and role=k and target_entity<>case when k='unit' then 'unit' else 'person' end) then e:=e||jsonb_build_array('Tipo de vínculo de venda inválido: '||k);end if;
      if exists(select 1 from public.eobra_migration_relations where record_id=r.id and role=k group by target_entity,target_source_id,target_archive_type having count(*)>1) then e:=e||jsonb_build_array('Vínculo de venda repetido: '||k);end if;
      if exists(select 1 from public.eobra_migration_relations where record_id=r.id and role=k and allocated_amount is not null)
        and ((select count(*) from public.eobra_migration_relations where record_id=r.id and role=k and allocated_amount is not null)<>n or (select sum(allocated_amount) from public.eobra_migration_relations where record_id=r.id and role=k) is distinct from public.eobra_import_money(d->>'total_amount')) then e:=e||jsonb_build_array('Alocações da venda precisam cobrir todos os vínculos e reconciliar o valor total: '||k);end if;
      if exists(select 1 from public.eobra_migration_relations where record_id=r.id and role=k and ownership_percent is not null)
        and ((select count(*) from public.eobra_migration_relations where record_id=r.id and role=k and ownership_percent is not null)<>n or (select sum(ownership_percent) from public.eobra_migration_relations where record_id=r.id and role=k)<>100) then e:=e||jsonb_build_array('Participações da venda devem ser completas e somar 100%: '||k);end if;
    end loop;
    if d->>'status'='active' and exists(select 1 from public.eobra_migration_relations own join public.eobra_migration_relations other on other.run_id=own.run_id and other.role='unit' and other.target_entity='unit' and other.target_source_id=own.target_source_id and other.record_id<>r.id join public.eobra_migration_records sr on sr.id=other.record_id and sr.entity='sale' and sr.normalized_data->>'status'='active' where own.record_id=r.id and own.role='unit') then e:=e||jsonb_build_array('A mesma unidade aparece em mais de uma venda ativa no pacote.');end if;
    if d->>'commission_pct' is not null and (d->>'commission_pct' !~ '^[0-9]{1,4}(\.[0-9]{1,4})?$') or d->>'commission_amount' is not null and public.eobra_import_money(d->>'commission_amount') is null then e:=e||jsonb_build_array('Comissão da venda inválida.');end if;
    for l in select * from public.eobra_migration_relations where record_id=r.id and role='buyer' loop
      select * into t from public.eobra_migration_records where run_id=r.run_id and entity='person' and source_id=l.target_source_id;
      if not coalesce(t.normalized_data->'roles','[]'::jsonb) ? 'client' then e:=e||jsonb_build_array('Comprador precisa ter papel de cliente explícito.');end if;
    end loop;
  elsif r.entity in('receivable','payable') then
    if nullif(btrim(d->>'description'),'') is null and nullif(btrim(d->>'document'),'') is null then e:=e||jsonb_build_array('Descrição ou documento obrigatório.');end if;
    if public.eobra_import_date(d->>'due_date') is null then e:=e||jsonb_build_array('Vencimento inválido.');end if;
    foreach k in array array['original_amount','current_amount','paid_amount','balance_amount','interest_amount','penalty_amount','correction_amount','other_accrual_amount','discount_amount'] loop
      if jsonb_typeof(d->k) is distinct from 'string' or (case when k='correction_amount' then public.eobra_snapshot_signed_money(d->>k) else public.eobra_import_money(d->>k) end) is null then e:=e||jsonb_build_array('Valor explícito inválido ou ausente: '||k);end if;
    end loop;
    original:=public.eobra_import_money(d->>'original_amount');current_value:=public.eobra_import_money(d->>'current_amount');paid:=public.eobra_import_money(d->>'paid_amount');balance:=public.eobra_import_money(d->>'balance_amount');
    adjustment:=coalesce(public.eobra_import_money(d->>'interest_amount'),0)+coalesce(public.eobra_import_money(d->>'penalty_amount'),0)+coalesce(public.eobra_snapshot_signed_money(d->>'correction_amount'),0)+coalesce(public.eobra_import_money(d->>'other_accrual_amount'),0)-coalesce(public.eobra_import_money(d->>'discount_amount'),0);
    if current_value is distinct from original+adjustment then e:=e||jsonb_build_array('Valor atual não reconcilia original e componentes.');end if;
    if coalesce(d->>'status','') not in('open','paid','partial','cancelled') then e:=e||jsonb_build_array('Situação financeira não reconhecida.');end if;
    if current_value is distinct from paid+balance then e:=e||jsonb_build_array('Valor atual não reconcilia baixa e saldo.');end if;
    if d->>'status'='paid' and (paid is null or paid<=0 or paid<>current_value or balance<>0) then e:=e||jsonb_build_array('Parcela quitada sem reconciliação integral.');end if;
    if d->>'status'='partial' and (paid is null or paid<=0 or balance is null or balance<=0) then e:=e||jsonb_build_array('Parcela parcial exige baixa e saldo positivos.');end if;
    if d->>'status'='open' and balance=0 and current_value>0 then e:=e||jsonb_build_array('Parcela aberta com valor positivo exige saldo pendente.');end if;
    if d->>'status'='open' and paid>0 then e:=e||jsonb_build_array('Pagamento líquido positivo com saldo deve estar explicitamente parcial na origem.');end if;
    if d->>'status'='partial' then
      if not public.eobra_snapshot_partial_supported() then e:=e||jsonb_build_array('Pagamento parcial preservado; promoção aguarda suporte nas leituras e baixas nativas.');end if;
    end if;
    if r.entity='payable' and current_value<>original and not public.eobra_snapshot_payable_adjustments_supported() then e:=e||jsonb_build_array('Ajustes do contas a pagar preservados; promoção aguarda suporte nativo aos componentes.');end if;
    select coalesce(sum(case when s.normalized_data->>'kind'='reversal' then -public.eobra_import_money(s.normalized_data->>'amount') when s.normalized_data->>'kind'='payment' then public.eobra_import_money(s.normalized_data->>'amount') else 0 end),0) into net_events
      from public.eobra_migration_records s join public.eobra_migration_relations sl on sl.record_id=s.id and sl.role='installment'
      where s.run_id=r.run_id and s.entity='settlement' and sl.target_entity=r.entity and sl.target_source_id=r.source_id;
    if net_events is distinct from paid then e:=e||jsonb_build_array('Baixa líquida não reconcilia com os eventos individuais capturados.');end if;
    if r.entity='receivable' then
      if (select count(*) from public.eobra_migration_relations where record_id=r.id and role='sale' and target_entity='sale')<>1 then e:=e||jsonb_build_array('Recebível exige uma venda real na origem.');end if;
      target:=public.eobra_snapshot_resolve_link(r.id,'sale','sale');
      if exists(select 1 from public.eobra_migration_records where id=target and normalized_data->>'status'='draft') then e:=e||jsonb_build_array('Recebível não pode ser promovido sobre rascunho de venda.');end if;
      if coalesce(d->>'sequence_number','') !~ '^[1-9][0-9]{0,5}$' or coalesce(d->>'sequence_total','') !~ '^[1-9][0-9]{0,5}$' then e:=e||jsonb_build_array('Sequência e quantidade de parcelas obrigatórias.');
      elsif (d->>'sequence_number')::int>(d->>'sequence_total')::int then e:=e||jsonb_build_array('Sequência ultrapassa quantidade de parcelas.');end if;
      if coalesce(d->>'category','other') not in('entry','monthly','reinforcement','keys','post_keys','other') then e:=e||jsonb_build_array('Categoria financeira inválida.');end if;
    else
      select count(*) into n from public.eobra_migration_relations where record_id=r.id and role='supplier' and target_entity='person';
      if n>1 or n=0 and nullif(btrim(d->>'counterparty_name'),'') is null then e:=e||jsonb_build_array('Fornecedor ou favorecido explícito obrigatório.');end if;
      if n=1 then
        target:=public.eobra_snapshot_resolve_link(r.id,'supplier','person');
        if not exists(select 1 from public.eobra_migration_records where id=target and normalized_data->'roles' ? 'supplier') then e:=e||jsonb_build_array('Pessoa vinculada precisa ter papel de fornecedor.');end if;
      end if;
    end if;
    if jsonb_typeof(d->'correction_locked') is distinct from 'boolean' then e:=e||jsonb_build_array('Travamento de correção precisa ser explícito.');end if;
    if coalesce(d->'correction'->>'mode','') not in('none','index_number') and not(d->'correction'->>'mode' is null and (d->'correction_locked'='true'::jsonb or d->>'status' in('paid','cancelled'))) then e:=e||jsonb_build_array('Política de correção ausente ou não suportada para promoção.');end if;
    if d->'correction'->>'mode'='none' and exists(select 1 from public.eobra_migration_relations where record_id=r.id and role='correction_index') then e:=e||jsonb_build_array('Política sem correção contradiz vínculo de índice aplicável.');end if;
    if d->'correction'->>'mode'='none' and d->'correction_locked'='false'::jsonb and d->>'status' in('open','partial') and public.eobra_snapshot_signed_money(d->>'correction_amount')<>0 then e:=e||jsonb_build_array('Parcela sem correção futura possui componente de correção não reconciliado.');end if;
    if d->'correction'->>'mode'='index_number' then
      if coalesce(d->'correction'->>'base_month','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or coalesce(d->'correction'->>'reference_month','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then e:=e||jsonb_build_array('Base e referência do índice devem ser explícitas.');end if;
      if (select count(*) from public.eobra_migration_relations where record_id=r.id and role='correction_index' and target_entity='correction_index')<>1 then e:=e||jsonb_build_array('Índice da parcela sem referência explícita.');end if;
      foreach k in array array['base_value','reference_value'] loop
        if coalesce(d->'correction'->>k,'') !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then e:=e||jsonb_build_array('Valor de índice explícito inválido: '||k);
        elsif (d->'correction'->>k)::numeric<=0 then e:=e||jsonb_build_array('Índice numérico precisa ser positivo: '||k);end if;
      end loop;
      select * into index_record from public.eobra_migration_records where id=public.eobra_snapshot_resolve_link(r.id,'correction_index','correction_index');
      if index_record.id is null or index_record.normalized_data->>'value_type'<>'index_number' then e:=e||jsonb_build_array('Política index_number exige um índice numérico explícito.');end if;
      foreach k in array array['base','reference'] loop
        select count(*),min(case when iv.normalized_data->>'value' ~ '^[0-9]{1,14}(\.[0-9]{1,6})?$' then (iv.normalized_data->>'value')::numeric end) into point_count,point_value
          from public.eobra_migration_records iv join public.eobra_migration_relations il on il.record_id=iv.id and il.role='index' and il.target_entity='correction_index'
          where iv.run_id=r.run_id and iv.entity='index_value' and il.target_source_id=index_record.source_id and iv.normalized_data->>'reference_month'=d->'correction'->>(k||'_month');
        if point_count<>1 or point_value is null or point_value<=0 or d->'correction'->>(k||'_value') !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then e:=e||jsonb_build_array('Valor mensal do índice não está conferido: '||k);
        elsif point_value is distinct from (d->'correction'->>(k||'_value'))::numeric then e:=e||jsonb_build_array('Valor declarado diverge do cadastro mensal do índice: '||k);end if;
      end loop;
      base_month:=public.eobra_import_date(d->'correction'->>'base_month'||'-01');reference_month:=public.eobra_import_date(d->'correction'->>'reference_month'||'-01');
      if base_month>reference_month then e:=e||jsonb_build_array('Competência de correção anterior à base.');end if;
      if d->'correction_locked'='false'::jsonb and d->>'status' in('open','partial') and d->'correction'->>'base_value' ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' and d->'correction'->>'reference_value' ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' and (d->'correction'->>'base_value')::numeric>0 then
        effective_value:=(d->'correction'->>'reference_value')::numeric;
        if d->'correction'->>'negative_variation_policy'='maximum_of_period' and base_month is not null and reference_month>=base_month then
          months_expected:=(extract(year from reference_month)::int-extract(year from base_month)::int)*12+extract(month from reference_month)::int-extract(month from base_month)::int+1;
          select count(distinct iv.normalized_data->>'reference_month'),max(case when iv.normalized_data->>'value' ~ '^[0-9]{1,14}(\.[0-9]{1,6})?$' then (iv.normalized_data->>'value')::numeric end) into point_count,effective_value
            from public.eobra_migration_records iv join public.eobra_migration_relations il on il.record_id=iv.id and il.role='index' and il.target_entity='correction_index'
            where iv.run_id=r.run_id and iv.entity='index_value' and il.target_source_id=index_record.source_id and public.eobra_import_date(iv.normalized_data->>'reference_month'||'-01') between base_month and reference_month;
          if point_count<>months_expected then e:=e||jsonb_build_array('Política de máximo do período exige série mensal completa.');end if;
        elsif coalesce(d->'correction'->>'negative_variation_policy','use_negative')<>'use_negative' then e:=e||jsonb_build_array('Política de variação negativa não suportada.');end if;
        if public.eobra_snapshot_signed_money(d->>'correction_amount') is distinct from round(original*effective_value/(d->'correction'->>'base_value')::numeric,2)-original then e:=e||jsonb_build_array('Correção informada diverge da regra e dos valores de índice capturados.');end if;
      end if;
    end if;
  elsif r.entity='settlement' then
    if coalesce(d->>'kind','') not in('payment','reversal','voided_payment') or public.eobra_import_money(d->>'amount') is null or public.eobra_import_money(d->>'amount')<=0 or public.eobra_import_date(d->>'occurred_on') is null then e:=e||jsonb_build_array('Evento de baixa inválido.');end if;
    if public.eobra_import_date(d->>'occurred_on')>b.reference_date then e:=e||jsonb_build_array('Evento de baixa posterior à data de referência.');end if;
    if (select count(*) from public.eobra_migration_relations where record_id=r.id and role='installment' and target_entity in('receivable','payable'))<>1 then e:=e||jsonb_build_array('Baixa exige exatamente uma parcela de origem.');end if;
    if coalesce(d->>'medium','') not in('bank','cash','non_cash') and not(d->>'kind'='voided_payment' and d->>'medium'='unknown') then e:=e||jsonb_build_array('Meio da baixa ainda não identificado.');end if;
    if d->>'kind'='voided_payment' then
      if d->'voided_date_unknown' is distinct from 'true'::jsonb or nullif(btrim(d->>'voided_by_source_id'),'') is null
        or (select count(*) from public.eobra_migration_relations where record_id=r.id and role='voided_by' and target_entity='raw_archive' and target_source_id=d->>'voided_by_source_id')<>1 then e:=e||jsonb_build_array('Baixa anulada exige evidência explícita do estorno sem data, arquivado e vinculado.');end if;
    elsif d ? 'voided_by_source_id' or d ? 'voided_date_unknown' then e:=e||jsonb_build_array('Baixa efetiva não pode carregar sinalização de anulação.');end if;
    if d->>'medium' in('bank','cash') and (select count(*) from public.eobra_migration_relations where record_id=r.id and role='account' and target_entity='bank_account')<>1 then e:=e||jsonb_build_array('Baixa bancária/caixa exige a conta efetiva.');end if;
    if d->>'kind'='reversal' then
      if (select count(*) from public.eobra_migration_relations where record_id=r.id and role='reverses' and target_entity='settlement')<>1 then e:=e||jsonb_build_array('Estorno exige exatamente um pagamento original.');end if;
      target:=public.eobra_snapshot_resolve_link(r.id,'reverses','settlement');select * into t from public.eobra_migration_records where id=target;
      if t.id is null or t.normalized_data->>'kind'<>'payment' or public.eobra_snapshot_resolve_link(t.id,'installment') is distinct from public.eobra_snapshot_resolve_link(r.id,'installment') then e:=e||jsonb_build_array('Estorno precisa referenciar pagamento da mesma parcela.');
      else
        if public.eobra_import_date(d->>'occurred_on')<public.eobra_import_date(t.normalized_data->>'occurred_on') then e:=e||jsonb_build_array('Estorno anterior ao pagamento.');end if;
        select coalesce(sum(public.eobra_import_money(s.normalized_data->>'amount')),0) into net_events from public.eobra_migration_records s join public.eobra_migration_relations sl on sl.record_id=s.id where s.run_id=r.run_id and s.entity='settlement' and s.normalized_data->>'kind'='reversal' and sl.role='reverses' and sl.target_source_id=t.source_id and sl.target_entity='settlement';
        if net_events>public.eobra_import_money(t.normalized_data->>'amount') then e:=e||jsonb_build_array('Estornos excedem o pagamento original.');end if;
      end if;
    end if;
  elsif r.entity='bank_account' then
    if nullif(btrim(d->>'name'),'') is null or coalesce(d->>'status','') not in('active','inactive') or coalesce(d->>'currency','')<>'BRL' then e:=e||jsonb_build_array('Conta de origem sem identificação, moeda BRL ou situação válida.');end if;
  elsif r.entity='bank_transaction' then
    if public.eobra_import_date(d->>'occurred_on') is null or public.eobra_import_money(d->>'amount') is null or public.eobra_import_money(d->>'amount')<=0 or coalesce(d->>'direction','') not in('credit','debit') or coalesce(d->>'status','') not in('posted','cancelled') then e:=e||jsonb_build_array('Movimento bancário de origem inválido.');end if;
    if (select count(*) from public.eobra_migration_relations where record_id=r.id and role='account' and target_entity='bank_account')<>1 then e:=e||jsonb_build_array('Movimento sem conta de origem explícita.');end if;
  elsif r.entity='correction_index' then
    if nullif(btrim(d->>'code'),'') is null or nullif(btrim(d->>'name'),'') is null or coalesce(d->>'value_type','') not in('index_number','percentage') then e:=e||jsonb_build_array('Cadastro de índice inválido.');end if;
  elsif r.entity='index_value' then
    if coalesce(d->>'reference_month','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or coalesce(d->>'value','') !~ '^-?[0-9]{1,14}(\.[0-9]{1,6})?$' then e:=e||jsonb_build_array('Mês ou valor do índice inválidos.');end if;
    if (select count(*) from public.eobra_migration_relations where record_id=r.id and role='index' and target_entity='correction_index')<>1 then e:=e||jsonb_build_array('Valor mensal sem índice explícito.');end if;
  end if;
  return (select coalesce(jsonb_agg(distinct x),'[]'::jsonb) from jsonb_array_elements(e) x);
end; $$;

create or replace function public.eobra_snapshot_coverage_errors(p_coverage_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare c public.eobra_migration_coverage%rowtype;d jsonb;e jsonb:='[]';n integer;expected integer;page_count integer;v jsonb;seen text[]:=array[]::text[];begin
  select * into c from public.eobra_migration_coverage where id=p_coverage_id;d:=c.declared;
  select count(*) into n from public.eobra_migration_records where run_id=c.run_id and entity=c.entity and source_project_id is not distinct from c.source_project_id and archive_type=c.archive_type;
  if coalesce(d->>'expectedCount','') !~ '^[0-9]{1,6}$' then e:=e||jsonb_build_array('Contagem esperada não verificada.');
  elsif (d->>'expectedCount')::int<>n then e:=e||jsonb_build_array('Quantidade capturada diverge da contagem da origem.');end if;
  if d ? 'collectedCount' and d->>'collectedCount' is distinct from n::text then e:=e||jsonb_build_array('A contagem declarada de coleta diverge dos registros.');end if;
  if coalesce(d->>'expectedPages','') !~ '^[0-9]{1,6}$' or jsonb_typeof(d->'collectedPages') is distinct from 'array' then e:=e||jsonb_build_array('Paginação da coleta não verificada.');
  else
    expected:=(d->>'expectedPages')::int;page_count:=jsonb_array_length(d->'collectedPages');
    if page_count<>expected then e:=e||jsonb_build_array('Páginas ausentes ou excedentes.');end if;
    for v in select value from jsonb_array_elements(d->'collectedPages') loop
      if v::text !~ '^[1-9][0-9]{0,5}$' then e:=e||jsonb_build_array('Número de página inválido.');
      elsif v::text=any(seen) or (v::text)::int>expected then e:=e||jsonb_build_array('Páginas repetidas ou fora do intervalo.');end if;
      seen:=array_append(seen,v::text);
    end loop;
  end if;
  seen:=array[]::text[];
  if coalesce(d->>'detailsExpected','') !~ '^[0-9]{1,6}$' or jsonb_typeof(d->'detailsCollected') is distinct from 'array' then e:=e||jsonb_build_array('Cobertura dos detalhes não verificada.');
  else
    if (d->>'detailsExpected')::int<>jsonb_array_length(d->'detailsCollected') then e:=e||jsonb_build_array('Detalhes ausentes ou excedentes.');end if;
    for v in select value from jsonb_array_elements(d->'detailsCollected') loop
      if jsonb_typeof(v)<>'string' or (v#>>'{}')=any(seen) or not exists(select 1 from public.eobra_migration_records where run_id=c.run_id and entity=c.entity and source_project_id is not distinct from c.source_project_id and archive_type=c.archive_type and source_id=v#>>'{}') then e:=e||jsonb_build_array('Detalhe repetido ou sem registro correspondente.');end if;
      seen:=array_append(seen,v#>>'{}');
    end loop;
  end if;
  if d->'complete' is distinct from 'true'::jsonb then e:=e||jsonb_build_array('A origem ainda não declarou esta coleta concluída.');end if;
  if jsonb_typeof(d->'filters') is distinct from 'object' then e:=e||jsonb_build_array('Filtros aplicados na captura não informados.');end if;
  return (select coalesce(jsonb_agg(distinct x),'[]'::jsonb) from jsonb_array_elements(e) x);
end; $$;

create or replace function public.eobra_snapshot_summary(p_run_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;result jsonb;e jsonb:='[]';k text;p text;v record;complete boolean;all_complete boolean;totals jsonb:='{}';begin
  select * into b from public.eobra_migration_runs where id=p_run_id;
  if not found then raise exception 'Snapshot indisponível.';end if;
  foreach k in array array['project','person','unit','sale','receivable','payable','settlement','bank_account','bank_transaction','correction_index','index_value'] loop
    if not exists(select 1 from public.eobra_migration_coverage where run_id=b.id and entity=k) then e:=e||jsonb_build_array('Entidade sem inventário de cobertura: '||k);end if;
  end loop;
  if not exists(select 1 from public.eobra_migration_coverage where run_id=b.id and entity='project' and source_project_id is null and verified) then e:=e||jsonb_build_array('Cadastro global de obras não conferido.');end if;
  for p in select jsonb_array_elements_text(b.scope->'projectIds') loop
    if not exists(select 1 from public.eobra_migration_records where run_id=b.id and entity='project' and source_id=p) then e:=e||jsonb_build_array('Obra do escopo ausente do pacote: '||p);end if;
    foreach k in array array['unit','sale','receivable','payable','settlement'] loop
      if not exists(select 1 from public.eobra_migration_coverage where run_id=b.id and entity=k and source_project_id=p) then e:=e||jsonb_build_array('Cobertura ausente por obra: '||k||' / '||p);end if;
    end loop;
  end loop;
  for v in select distinct entity,source_project_id,archive_type from public.eobra_migration_records where run_id=b.id loop
    if not exists(select 1 from public.eobra_migration_coverage c where c.run_id=b.id and c.entity=v.entity and c.source_project_id is not distinct from v.source_project_id and c.archive_type=v.archive_type) then e:=e||jsonb_build_array('Conjunto capturado sem cobertura exata: '||v.entity||' / '||coalesce(v.source_project_id,'global'));end if;
  end loop;
  complete:=jsonb_array_length(e)=0 and not exists(select 1 from public.eobra_migration_coverage where run_id=b.id and not verified);
  all_complete:=complete and b.scope->'allProjects'='true'::jsonb and not exists(select 1 from public.eobra_migration_records where run_id=b.id and entity='project' and not b.scope->'projectIds' ? source_id);
  if exists(select 1 from public.eobra_migration_coverage where run_id=b.id and not verified) then e:=e||jsonb_build_array('Há conjuntos com contagens, páginas ou detalhes ainda não conferidos.');end if;
  foreach k in array array['receivable','payable'] loop
    select jsonb_build_object('original_amount',coalesce(sum(public.eobra_import_money(normalized_data->>'original_amount')),0)::numeric(24,2)::text,
      'current_amount',coalesce(sum(public.eobra_import_money(normalized_data->>'current_amount')),0)::numeric(24,2)::text,
      'paid_amount',coalesce(sum(public.eobra_import_money(normalized_data->>'paid_amount')),0)::numeric(24,2)::text,
      'balance_amount',coalesce(sum(public.eobra_import_money(normalized_data->>'balance_amount')),0)::numeric(24,2)::text,
      'collectible_balance_amount',coalesce(sum(public.eobra_import_money(normalized_data->>'balance_amount')) filter(where normalized_data->>'status'<>'cancelled'),0)::numeric(24,2)::text,
      'complete',coalesce(bool_and(public.eobra_import_money(normalized_data->>'original_amount') is not null and public.eobra_import_money(normalized_data->>'current_amount') is not null and public.eobra_import_money(normalized_data->>'paid_amount') is not null and public.eobra_import_money(normalized_data->>'balance_amount') is not null),true)) into result
      from public.eobra_migration_records where run_id=b.id and entity=k;
    totals:=totals||jsonb_build_object(k,result);
  end loop;
  select jsonb_build_object('total',count(*),'ready',count(*) filter(where review_status='ready'),'blocked',count(*) filter(where review_status='blocked'),'conflicts',count(*) filter(where review_status='conflict'),'duplicates',count(*) filter(where review_status='duplicate'),'archived',count(*) filter(where review_status='archived'),
    'counts',coalesce((select jsonb_object_agg(entity,n) from (select entity,count(*) n from public.eobra_migration_records where run_id=b.id group by entity) counts),'{}'::jsonb),
    'coverage_complete',complete,'all_projects_complete',all_complete,
    'history_dates_complete',not exists(select 1 from public.eobra_migration_records where run_id=b.id and (normalized_data->>'kind'='voided_payment' or normalized_data->'history_dates_complete'='false'::jsonb)),
    'totals',totals,'errors',e) into result from public.eobra_migration_records where run_id=b.id;
  return result;
end; $$;

create or replace function public.eobra_snapshot_preview_hash(p_run_id uuid)
returns text language sql stable security invoker set search_path=pg_catalog,public
as $$ select public.eobra_import_hash(jsonb_build_object('snapshot',b.snapshot_hash,'project_map',b.project_map,'summary',public.eobra_snapshot_summary(b.id),
  'records',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'hash',r.record_hash,'errors',r.errors,'warnings',r.warnings,'status',r.review_status,'expected',r.expected_targets) order by r.entity,r.archive_type,r.source_id) from public.eobra_migration_records r where r.run_id=b.id),'[]'::jsonb),
  'coverage',coalesce((select jsonb_agg(jsonb_build_object('declared',c.declared,'actual',c.actual_count,'verified',c.verified,'errors',c.errors) order by c.entity,c.source_project_id,c.archive_type) from public.eobra_migration_coverage c where c.run_id=b.id),'[]'::jsonb)))
  from public.eobra_migration_runs b where b.id=p_run_id; $$;

-- Called both when sealing and immediately before promotion. Direct INSERT /
-- UPDATE privileges never make caller-supplied statuses or totals authoritative.
create or replace function public.eobra_snapshot_assert_review(p_run_id uuid)
returns void language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;doc jsonb;r record;c record;l public.eobra_migration_ledger%rowtype;issues jsonb;expected_state text;actual integer;begin
  select * into b from public.eobra_migration_runs where id=p_run_id;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) or not public.eobra_snapshot_projects_visible(b.company_id,b.project_map) then raise exception 'Snapshot indisponível ou sem permissões.';end if;
  select document into doc from public.eobra_migration_snapshots where run_id=b.id;
  if doc is null or public.eobra_import_hash(doc) is distinct from b.snapshot_hash
    or (select count(*) from public.eobra_migration_records where run_id=b.id)<>jsonb_array_length(doc->'records')
    or (select count(*) from public.eobra_migration_coverage where run_id=b.id)<>jsonb_array_length(doc->'coverage') then raise exception 'Evidência incompleta ou hash de origem divergente.';end if;
  if exists(select 1 from jsonb_array_elements(doc->'records') with ordinality source(v,ord)
    left join public.eobra_migration_records rec on rec.run_id=b.id and rec.source_ordinal=source.ord
    where rec.id is null or rec.record_hash is distinct from public.eobra_snapshot_record_hash(v->>'entity',v->>'sourceId',nullif(v->>'sourceProjectId',''),coalesce(v->>'archiveType',''),nullif(v->>'parentSourceId',''),v->'raw',v->'normalized',coalesce(v->'links','[]'))
      or rec.source_errors is distinct from coalesce(v->'errors','[]'::jsonb)) then raise exception 'Registro diverge do documento imutável de origem.';end if;
  if exists(select 1 from jsonb_array_elements(doc->'coverage') source(v) where not exists(select 1 from public.eobra_migration_coverage cov where cov.run_id=b.id and cov.declared=source.v and cov.entity=source.v->>'entity' and cov.source_project_id is not distinct from nullif(source.v->>'sourceProjectId','') and cov.archive_type=coalesce(source.v->>'archiveType',''))) then raise exception 'Cobertura diverge do manifesto imutável.';end if;
  for r in select * from public.eobra_migration_records where run_id=b.id loop
    if (select count(*) from public.eobra_migration_relations where record_id=r.id)<>jsonb_array_length(r.links) then raise exception 'Relações incompletas para o registro %.',r.source_id;end if;
    if public.eobra_snapshot_expected_targets(r.id) is distinct from r.expected_targets then raise exception 'O cadastro correspondente mudou após a revisão; prepare outro snapshot.';end if;
    issues:=public.eobra_snapshot_record_errors(r.id);
    expected_state:=case when jsonb_array_length(issues)>0 then 'blocked' else 'ready' end;
    select * into l from public.eobra_migration_ledger where company_id=b.company_id and source_host=b.source_host and entity=r.entity and archive_type=r.archive_type and source_id=r.source_id;
    if found then
      if l.record_hash<>r.record_hash then expected_state:='conflict';issues:=issues||jsonb_build_array('Identidade já importada com conteúdo diferente; nenhum registro será sobrescrito.');
      elsif jsonb_array_length(issues)=0 then expected_state:='duplicate';end if;
    elsif jsonb_array_length(issues)=0 and (r.entity='project' and r.project_id is null or r.entity in('raw_archive','bank_account','bank_transaction','correction_index','index_value','settlement') or r.entity='sale' and r.normalized_data->>'status'='draft' or r.entity='person' and not (r.normalized_data->'roles' ?| array['client','supplier'])) then expected_state:='archived';end if;
    if r.status is distinct from expected_state or r.review_status is distinct from expected_state or not(r.errors @> issues and issues @> r.errors) then raise exception 'A revisão dos registros mudou ou foi adulterada; prepare outro snapshot.';end if;
  end loop;
  for c in select * from public.eobra_migration_coverage where run_id=b.id loop
    issues:=public.eobra_snapshot_coverage_errors(c.id);
    select count(*) into actual from public.eobra_migration_records where run_id=b.id and entity=c.entity and source_project_id is not distinct from c.source_project_id and archive_type=c.archive_type;
    if c.actual_count<>actual or c.verified is distinct from (jsonb_array_length(issues)=0) or not(c.errors @> issues and issues @> c.errors) then raise exception 'Cobertura calculada diverge da evidência de origem.';end if;
  end loop;
end; $$;

create or replace function public.eobra_snapshot_guard_run()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare s jsonb;begin
  if not public.eobra_snapshot_authorized(new.company_id,new.required_permissions) then raise exception 'Permissões de empresa e módulos são obrigatórias.';end if;
  if tg_op='INSERT' then
    if new.status<>'building' or new.promotion_result is not null or new.project_id is not null then raise exception 'Snapshot deve iniciar em preparação no escopo da empresa.';end if;
    new.created_by:=auth.uid();new.created_at:=now();
  else
    if old.status in('imported','cancelled') then raise exception 'Snapshot encerrado é imutável.';end if;
    if (to_jsonb(new)-array['status','summary','preview_hash','promotion_result','promoted_by','promoted_at','cancelled_by','cancelled_at','updated_at']) is distinct from (to_jsonb(old)-array['status','summary','preview_hash','promotion_result','promoted_by','promoted_at','cancelled_by','cancelled_at','updated_at']) then raise exception 'A origem e o de-para revisados são imutáveis.';end if;
    if new.status='building' and old.status<>'building' then raise exception 'Snapshot selado não pode ser reaberto.';end if;
    if new.status in('review','ready') then
      if not exists(select 1 from public.eobra_migration_snapshots where run_id=new.id) then raise exception 'Documento de origem ausente.';end if;
      perform public.eobra_snapshot_assert_review(new.id);
      s:=public.eobra_snapshot_summary(new.id);new.summary:=s;new.preview_hash:=public.eobra_snapshot_preview_hash(new.id);
      if new.status='ready' and (s->'coverage_complete' is distinct from 'true'::jsonb or (s->>'blocked')::int+(s->>'conflicts')::int>0 or (s->>'total')::int=0) then raise exception 'Cobertura ou registros ainda possuem pendências.';end if;
    elsif new.status='imported' then
      if old.status<>'ready' or new.promotion_result is null or exists(select 1 from public.eobra_migration_records r where r.run_id=new.id and (r.status not in('imported','duplicate','archived') or not exists(select 1 from public.eobra_migration_ledger l where l.company_id=r.company_id and l.source_host=new.source_host and l.entity=r.entity and l.archive_type=r.archive_type and l.source_id=r.source_id and l.record_hash=r.record_hash))) then raise exception 'Snapshot possui registros ainda não concluídos.';end if;
      new.summary:=old.summary;new.preview_hash:=old.preview_hash;new.promoted_by:=auth.uid();new.promoted_at:=now();
      select jsonb_build_object('total',count(*),'duplicates',count(*) filter(where r.review_status='duplicate'),'archived',count(*) filter(where r.review_status='archived'),
        'created',coalesce(sum((select count(*) from jsonb_object_keys(r.canonical_targets) k where not r.expected_targets ? k)) filter(where r.review_status='ready'),0),
        'reused',coalesce(sum((select count(*) from jsonb_object_keys(r.expected_targets))) filter(where r.review_status='ready'),0)) into new.promotion_result from public.eobra_migration_records r where r.run_id=new.id;
    elsif new.status='cancelled' then new.summary:=old.summary;new.preview_hash:=old.preview_hash;new.cancelled_by:=auth.uid();new.cancelled_at:=now();
    end if;
  end if;
  new.updated_at:=now();return new;
end; $$;
create trigger eobra_snapshot_run_guard before insert or update on public.eobra_migration_runs for each row execute function public.eobra_snapshot_guard_run();

create or replace function public.eobra_snapshot_guard_record()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;begin
  select * into b from public.eobra_migration_runs where id=new.run_id for update;
  if not found or b.company_id<>new.company_id or b.status in('cancelled','imported') then raise exception 'Registro fora de um snapshot disponível.';end if;
  if not public.eobra_snapshot_permissions(new.entity,new.normalized_data)<@b.required_permissions or not public.eobra_snapshot_authorized(new.company_id,public.eobra_snapshot_permissions(new.entity,new.normalized_data)) then raise exception 'Permissão nativa da entidade ausente.';end if;
  if new.project_id is not null and not exists(select 1 from public.projects where id=new.project_id and company_id=new.company_id) then raise exception 'Obra fora da empresa.';end if;
  if tg_op='INSERT' then
    if b.status<>'building' then raise exception 'Não é possível acrescentar registros após selar o snapshot.';end if;
    new.record_hash:=public.eobra_snapshot_record_hash(new.entity,new.source_id,new.source_project_id,new.archive_type,new.parent_source_id,new.raw_data,new.normalized_data,new.links);
    if new.project_id is distinct from public.eobra_import_uuid(b.project_map->>(case when new.entity='project' then new.source_id else new.source_project_id end)) then raise exception 'Obra diverge do de-para declarado.';end if;
    new.created_by:=auth.uid();new.created_at:=now();
  else
    if b.status='building' then
      if (to_jsonb(new)-array['status','review_status','errors','warnings','expected_targets','updated_at']) is distinct from (to_jsonb(old)-array['status','review_status','errors','warnings','expected_targets','updated_at']) then raise exception 'Dados de origem são imutáveis.';end if;
    else
      if (to_jsonb(new)-array['status','canonical_targets','updated_at']) is distinct from (to_jsonb(old)-array['status','canonical_targets','updated_at']) then raise exception 'Dados revisados são imutáveis.';end if;
      if new.status is distinct from (case new.review_status when 'duplicate' then 'duplicate' when 'archived' then 'archived' when 'ready' then 'imported' end) or not exists(select 1 from public.eobra_migration_ledger l where l.company_id=new.company_id and l.source_host=b.source_host and l.entity=new.entity and l.archive_type=new.archive_type and l.source_id=new.source_id and l.record_hash=new.record_hash and l.targets=new.canonical_targets) then raise exception 'Resultado sem identidade registrada no ledger.';end if;
    end if;
  end if;
  if exists(select 1 from jsonb_array_elements(new.errors||new.warnings||new.source_errors) x where jsonb_typeof(x)<>'string') then raise exception 'Erros e avisos devem conter somente texto.';end if;
  new.updated_at:=now();return new;
end; $$;
create trigger eobra_snapshot_record_guard before insert or update on public.eobra_migration_records for each row execute function public.eobra_snapshot_guard_record();

create or replace function public.eobra_snapshot_guard_coverage()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;begin
  select * into b from public.eobra_migration_runs where id=new.run_id for update;
  if not found or b.status<>'building' or b.company_id<>new.company_id then raise exception 'Cobertura selada é imutável.';end if;
  if tg_op='UPDATE' and (to_jsonb(new)-array['actual_count','verified','errors','updated_at']) is distinct from (to_jsonb(old)-array['actual_count','verified','errors','updated_at']) then raise exception 'Manifesto de cobertura é imutável.';end if;
  if tg_op='INSERT' then new.created_by:=auth.uid();new.created_at:=now();end if;
  if new.declared->>'entity' is distinct from new.entity or nullif(new.declared->>'sourceProjectId','') is distinct from new.source_project_id or coalesce(new.declared->>'archiveType','') is distinct from new.archive_type then raise exception 'Identidade da cobertura diverge do manifesto.';end if;
  if new.project_id is distinct from public.eobra_import_uuid(b.project_map->>new.source_project_id)
    or new.expected_count is distinct from (case when new.declared->>'expectedCount' ~ '^[0-9]{1,6}$' then (new.declared->>'expectedCount')::int end) then raise exception 'Escopo ou contagem da cobertura diverge da origem.';end if;
  new.updated_at:=now();return new;
end; $$;
create trigger eobra_snapshot_coverage_guard before insert or update on public.eobra_migration_coverage for each row execute function public.eobra_snapshot_guard_coverage();

create or replace function public.stage_eobra_snapshot(p_company_id uuid,p_snapshot jsonb,p_project_map jsonb)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public
as $$
declare v_run_id uuid;existing_run uuid;host text;captured timestamptz;reference_day date;perms text[];v_snapshot_hash text;v_fingerprint text;
  x jsonb;m record;item record;issues jsonb;targets jsonb;result_summary jsonb;record_state text;old_ledger public.eobra_migration_ledger%rowtype;
begin
  if not public.eobra_snapshot_authorized(p_company_id,array[]::text[]) then raise exception 'Sem permissão para preparar a migração desta empresa.' using errcode='42501';end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot->>'format'<>'elos.eobra.snapshot.v1' or jsonb_typeof(p_snapshot->'records') is distinct from 'array' or jsonb_typeof(p_snapshot->'coverage') is distinct from 'array' or jsonb_typeof(p_snapshot->'scope'->'projectIds') is distinct from 'array' or jsonb_typeof(p_project_map) is distinct from 'object' then raise exception 'Estrutura do pacote de migração inválida.';end if;
  if octet_length(p_snapshot::text)>62914560 or jsonb_array_length(p_snapshot->'records') not between 1 and 100000 then raise exception 'Pacote excede 60 MiB normalizado ou 100.000 registros.';end if;
  host:=lower(btrim(p_snapshot->'source'->>'host'));
  if host is null or host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.eobra\.com\.br$' then raise exception 'Ambiente de origem inválido.';end if;
  reference_day:=public.eobra_import_date(p_snapshot->'source'->>'referenceDate');
  begin captured:=(p_snapshot->'source'->>'capturedAt')::timestamptz;exception when others then raise exception 'Data de captura inválida.';end;
  if reference_day is null or captured is null or coalesce(p_snapshot->'source'->>'capturedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' or jsonb_typeof(p_snapshot->'scope'->'allProjects') is distinct from 'boolean' then raise exception 'Data de referência ou escopo não informado.';end if;
  if exists(select 1 from jsonb_array_elements(p_snapshot->'scope'->'projectIds') v where jsonb_typeof(v)<>'string' or nullif(btrim(v#>>'{}'),'') is null) or (select count(*) from jsonb_array_elements(p_snapshot->'scope'->'projectIds'))<>(select count(distinct v) from jsonb_array_elements(p_snapshot->'scope'->'projectIds') v) then raise exception 'Obras do escopo devem ter IDs textuais únicos.';end if;
  select coalesce(array_agg(distinct permission order by permission),array[]::text[]) into perms
    from jsonb_array_elements(p_snapshot->'records') v cross join lateral unnest(public.eobra_snapshot_permissions(v->>'entity',coalesce(v->'normalized','{}'))) permission;
  if not public.eobra_snapshot_authorized(p_company_id,perms) then raise exception 'Permissões nativas de todos os módulos do pacote são obrigatórias.' using errcode='42501';end if;
  if not public.eobra_snapshot_projects_visible(p_company_id,p_project_map) then raise exception 'De-para contém obra indisponível nesta empresa.' using errcode='42501';end if;
  v_snapshot_hash:=public.eobra_import_hash(p_snapshot);v_fingerprint:=public.eobra_import_hash(jsonb_build_object('company',p_company_id,'host',host,'snapshot',v_snapshot_hash,'project_map',p_project_map));
  perform pg_advisory_xact_lock(hashtextextended('eobra-snapshot:'||p_company_id::text,0));
  select id into existing_run from public.eobra_migration_runs b where b.company_id=p_company_id and b.fingerprint=v_fingerprint and b.status='imported' order by b.created_at desc limit 1;
  if found then return existing_run;end if;
  for m in select key,value from jsonb_each(p_project_map) loop
    if not p_snapshot->'scope'->'projectIds' ? m.key then raise exception 'De-para contém obra fora do escopo declarado.';end if;
    if jsonb_typeof(m.value)='string' and exists(select 1 from public.projects p where p.id=public.eobra_import_uuid(m.value#>>'{}') and p.company_id=p_company_id)
      and not exists(select 1 from public.eobra_migration_project_links l where l.company_id=p_company_id and l.source_host=host and (l.source_id=m.key or l.project_id=public.eobra_import_uuid(m.value#>>'{}'))) then
      insert into public.eobra_migration_project_links(company_id,project_id,source_host,source_id) values(p_company_id,public.eobra_import_uuid(m.value#>>'{}'),host,m.key);
    end if;
  end loop;
  insert into public.eobra_migration_runs(company_id,source_host,format,captured_at,reference_date,scope,archive_types,project_map,required_permissions,snapshot_hash,fingerprint)
  values(p_company_id,host,'elos.eobra.snapshot.v1',captured,reference_day,p_snapshot->'scope',coalesce(p_snapshot->'archiveTypes','[]'),p_project_map,perms,v_snapshot_hash,v_fingerprint) returning id into v_run_id;
  insert into public.eobra_migration_snapshots(run_id,company_id,document,snapshot_hash) values(v_run_id,p_company_id,p_snapshot,v_snapshot_hash);
  insert into public.eobra_migration_records(run_id,company_id,project_id,source_ordinal,entity,source_id,source_project_id,archive_type,parent_source_id,links,raw_data,normalized_data,source_errors,record_hash)
  select v_run_id,p_company_id,(select p.id from public.projects p where p.company_id=p_company_id and p.id=public.eobra_import_uuid(p_project_map->>(case when v->>'entity'='project' then v->>'sourceId' else v->>'sourceProjectId' end))),
    ord::int,v->>'entity',v->>'sourceId',nullif(v->>'sourceProjectId',''),coalesce(v->>'archiveType',''),nullif(v->>'parentSourceId',''),coalesce(v->'links','[]'),v->'raw',v->'normalized',coalesce(v->'errors','[]'),'pending'
  from jsonb_array_elements(p_snapshot->'records') with ordinality x(v,ord);
  insert into public.eobra_migration_relations(run_id,record_id,company_id,project_id,ordinal,target_entity,target_source_id,target_archive_type,role,source_relation_id,is_primary,allocated_amount,ownership_percent,attributes)
  select v_run_id,r.id,p_company_id,r.project_id,ord::int,v->>'entity',v->>'sourceId',coalesce(v->>'archiveType',''),v->>'role',nullif(v->>'source_relation_id',''),
    case when v->'primary'='true'::jsonb then true when v->'primary'='false'::jsonb then false end,
    public.eobra_import_money(v->>'allocated_amount'),case when v->>'ownership_percent' ~ '^[0-9]{1,3}(\.[0-9]{1,4})?$' then (v->>'ownership_percent')::numeric end,v
  from public.eobra_migration_records r cross join lateral jsonb_array_elements(r.links) with ordinality x(v,ord) where r.run_id=v_run_id;
  insert into public.eobra_migration_coverage(run_id,company_id,project_id,entity,source_project_id,archive_type,declared,expected_count)
  select v_run_id,p_company_id,(select p.id from public.projects p where p.company_id=p_company_id and p.id=public.eobra_import_uuid(p_project_map->>(v->>'sourceProjectId'))),v->>'entity',nullif(v->>'sourceProjectId',''),coalesce(v->>'archiveType',''),v,
    case when v->>'expectedCount' ~ '^[0-9]{1,6}$' then (v->>'expectedCount')::int end from jsonb_array_elements(p_snapshot->'coverage') v;
  for item in select id,entity,source_id,archive_type,normalized_data,record_hash from public.eobra_migration_records q where q.run_id=v_run_id loop
    issues:=public.eobra_snapshot_record_errors(item.id);targets:=public.eobra_snapshot_expected_targets(item.id);record_state:=case when jsonb_array_length(issues)>0 then 'blocked' else 'ready' end;
    select * into old_ledger from public.eobra_migration_ledger l where l.company_id=p_company_id and l.source_host=host and l.entity=item.entity and l.archive_type=item.archive_type and l.source_id=item.source_id;
    if found then
      if old_ledger.record_hash<>item.record_hash then record_state:='conflict';issues:=issues||jsonb_build_array('Identidade já importada com conteúdo diferente; nenhum registro será sobrescrito.');
      elsif jsonb_array_length(issues)=0 then record_state:='duplicate';end if;
    elsif jsonb_array_length(issues)=0 and (item.entity='project' and not targets ? 'projects' or item.entity in('raw_archive','bank_account','bank_transaction','correction_index','index_value','settlement') or item.entity='sale' and item.normalized_data->>'status'='draft' or item.entity='person' and not (item.normalized_data->'roles' ?| array['client','supplier'])) then record_state:='archived';end if;
    update public.eobra_migration_records q set errors=issues,status=record_state,review_status=record_state,expected_targets=targets,
      warnings=case when targets<>'{}'::jsonb and item.entity='person' then jsonb_build_array('CPF/CNPJ corresponde a cadastro existente; o vínculo será reutilizado sem alterar os dados atuais.') else '[]'::jsonb end
      where q.id=item.id;
  end loop;
  for item in select id from public.eobra_migration_coverage c where c.run_id=v_run_id loop
    issues:=public.eobra_snapshot_coverage_errors(item.id);
    update public.eobra_migration_coverage c set errors=issues,verified=jsonb_array_length(issues)=0,
      actual_count=(select count(*) from public.eobra_migration_records q where q.run_id=c.run_id and q.entity=c.entity and q.source_project_id is not distinct from c.source_project_id and q.archive_type=c.archive_type) where c.id=item.id;
  end loop;
  result_summary:=public.eobra_snapshot_summary(v_run_id);
  update public.eobra_migration_runs b set status=case when result_summary->'coverage_complete'='true'::jsonb and (result_summary->>'blocked')::int+(result_summary->>'conflicts')::int=0 then 'ready' else 'review' end where b.id=v_run_id;
  return v_run_id;
end; $$;

create or replace function public.review_eobra_snapshot(p_run_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;begin
  select * into b from public.eobra_migration_runs where id=p_run_id;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.' using errcode='42501';end if;
  return jsonb_build_object('run_id',b.id,'status',b.status,'source_host',b.source_host,'reference_date',b.reference_date,'preview_hash',b.preview_hash,'summary',b.summary,
    'coverage',coalesce((select jsonb_agg(jsonb_build_object('entity',c.entity,'source_project_id',c.source_project_id,'archive_type',c.archive_type,'expected_count',c.expected_count,'actual_count',c.actual_count,'verified',c.verified,'errors',c.errors) order by c.entity,c.source_project_id) from public.eobra_migration_coverage c where c.run_id=b.id),'[]'::jsonb),
    'promotion_result',b.promotion_result);
end; $$;

create or replace function public.cancel_eobra_snapshot(p_run_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;begin
  select * into b from public.eobra_migration_runs where id=p_run_id for update;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.' using errcode='42501';end if;
  if b.status='imported' then raise exception 'Snapshot promovido não pode ser cancelado.';end if;
  if b.status='cancelled' then return;end if;
  update public.eobra_migration_runs set status='cancelled' where id=b.id;
end; $$;

-- Foundation can be deployed independently: results stay unwritable until the
-- promotion migration installs provenance guards for every result column.
create or replace function public.eobra_snapshot_guard_result()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ begin raise exception 'Promoção do pacote ainda não instalada.';end; $$;
do $$ declare t text;begin
  foreach t in array array['eobra_migration_ledger','eobra_source_accounts','eobra_source_indices','eobra_source_events'] loop
    execute format('create trigger eobra_snapshot_result_guard before insert or update or delete on public.%I for each row execute function public.eobra_snapshot_guard_result()',t);
  end loop;
end; $$;

do $$ declare f record;begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'eobra_snapshot_%' or p.proname in('stage_eobra_snapshot','review_eobra_snapshot','cancel_eobra_snapshot')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end; $$;
comment on table public.eobra_migration_snapshots is 'Complete, immutable source package. Captured/archived does not mean promoted into operational tables.';
comment on table public.eobra_source_events is 'Historical source evidence. No native bank posting is produced by storing these events.';
commit;
