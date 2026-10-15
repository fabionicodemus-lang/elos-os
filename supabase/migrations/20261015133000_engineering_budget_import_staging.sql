-- Elos OS — staging do importador de orçamento
-- O arquivo externo é interpretado primeiro; nenhum serviço/insumo/orçamento é criado
-- até que o lote seja revisado e promovido explicitamente.

begin;

alter table public.engineering_budget_groups
  add column if not exists parent_group_id uuid references public.engineering_budget_groups(id) on delete set null;

create index if not exists engineering_budget_groups_parent_idx
  on public.engineering_budget_groups(budget_id, parent_group_id, sort_order, code);

create table if not exists public.engineering_budget_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  source_system text not null default 'xlsx',
  catalog_namespace text not null default 'elos_os',
  parser_key text not null,
  file_name text not null,
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  source_sheet text,
  source_budget_code text,
  source_budget_name text,
  source_version text,
  source_reference_date date,
  source_area_m2 numeric(18,4),
  source_total numeric(18,6),
  status text not null default 'staged'
    check (status in ('staged', 'review', 'ready', 'promoted', 'failed', 'cancelled')),
  groups_total integer not null default 0 check (groups_total >= 0),
  services_total integer not null default 0 check (services_total >= 0),
  inputs_total integer not null default 0 check (inputs_total >= 0),
  matched_total integer not null default 0 check (matched_total >= 0),
  suggested_total integer not null default 0 check (suggested_total >= 0),
  ambiguous_total integer not null default 0 check (ambiguous_total >= 0),
  new_total integer not null default 0 check (new_total >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.engineering_budget_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.engineering_budget_import_batches(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  entity_kind text not null check (entity_kind in ('group', 'service', 'input')),
  source_sheet text not null,
  source_row integer not null check (source_row > 0),
  sort_order integer not null default 0,
  source_group_code text,
  source_group_name text,
  source_service_code text,
  source_service_name text,
  external_code text,
  external_name text,
  external_unit text,
  quantity numeric(18,8),
  unit_cost numeric(18,8),
  total_cost numeric(18,8),
  coefficient numeric(18,8),
  raw_coefficient numeric(18,8),
  target_entity_type text,
  target_entity_id uuid,
  target_label text,
  match_status text not null default 'new'
    check (match_status in ('mapped', 'exact_code', 'exact_name_unit', 'suggested', 'ambiguous', 'new', 'ignored')),
  match_method text,
  confidence numeric(5,2) check (confidence is null or (confidence >= 0 and confidence <= 100)),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists engineering_budget_import_batches_project_idx
  on public.engineering_budget_import_batches(company_id, project_id, created_at desc);
create index if not exists engineering_budget_import_batches_hash_idx
  on public.engineering_budget_import_batches(company_id, project_id, file_hash, created_at desc);
create index if not exists engineering_budget_import_rows_batch_idx
  on public.engineering_budget_import_rows(batch_id, entity_kind, match_status, sort_order);
create index if not exists engineering_budget_import_rows_target_idx
  on public.engineering_budget_import_rows(company_id, target_entity_type, target_entity_id)
  where target_entity_id is not null;

create or replace function public.validate_engineering_budget_import_batch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.projects project
    where project.id = new.project_id
      and project.company_id = new.company_id
  ) then
    raise exception 'Empreendimento do lote não pertence à empresa informada.';
  end if;
  return new;
end;
$$;

create or replace function public.validate_engineering_budget_import_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch record;
begin
  select company_id, project_id into v_batch
  from public.engineering_budget_import_batches
  where id = new.batch_id;

  if not found then
    raise exception 'Lote de importação não localizado.';
  end if;
  if new.company_id <> v_batch.company_id or new.project_id <> v_batch.project_id then
    raise exception 'Linha de staging deve pertencer à mesma empresa e obra do lote.';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_engineering_budget_import_batch() from public, anon, authenticated;
revoke all on function public.validate_engineering_budget_import_row() from public, anon, authenticated;

drop trigger if exists engineering_budget_import_batch_validate on public.engineering_budget_import_batches;
create trigger engineering_budget_import_batch_validate
before insert or update of company_id, project_id on public.engineering_budget_import_batches
for each row execute function public.validate_engineering_budget_import_batch();

drop trigger if exists engineering_budget_import_row_validate on public.engineering_budget_import_rows;
create trigger engineering_budget_import_row_validate
before insert or update of batch_id, company_id, project_id on public.engineering_budget_import_rows
for each row execute function public.validate_engineering_budget_import_row();

alter table public.engineering_budget_import_batches enable row level security;
alter table public.engineering_budget_import_rows enable row level security;

drop policy if exists engineering_budget_import_batches_select on public.engineering_budget_import_batches;
create policy engineering_budget_import_batches_select on public.engineering_budget_import_batches
for select to authenticated using (
  public.has_company_permission(company_id, 'budgets.view')
  or public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budget_import_batches_manage on public.engineering_budget_import_batches;
create policy engineering_budget_import_batches_manage on public.engineering_budget_import_batches
for all to authenticated using (
  public.has_company_permission(company_id, 'budgets.manage')
) with check (
  public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budget_import_rows_select on public.engineering_budget_import_rows;
create policy engineering_budget_import_rows_select on public.engineering_budget_import_rows
for select to authenticated using (
  public.has_company_permission(company_id, 'budgets.view')
  or public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budget_import_rows_manage on public.engineering_budget_import_rows;
create policy engineering_budget_import_rows_manage on public.engineering_budget_import_rows
for all to authenticated using (
  public.has_company_permission(company_id, 'budgets.manage')
) with check (
  public.has_company_permission(company_id, 'budgets.manage')
);

grant select, insert, update, delete on public.engineering_budget_import_batches to authenticated;
grant select, insert, update, delete on public.engineering_budget_import_rows to authenticated;

comment on table public.engineering_budget_import_batches is
  'Lotes temporários do importador de orçamento. A origem nunca é promovida automaticamente para a base canônica.';
comment on table public.engineering_budget_import_rows is
  'Linhas normalizadas do orçamento externo, classificadas antes da promoção para grupos, serviços, insumos e composições.';
comment on column public.engineering_budget_groups.parent_group_id is
  'Permite preservar hierarquias como Grupo > Subgrupo sem achatar a estrutura do orçamento original.';

commit;
