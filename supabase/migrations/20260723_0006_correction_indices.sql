-- Elos OS — Índices de correção monetária
-- Execute após 20260723_0005_receivables.sql.

create table if not exists public.correction_indices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  value_type text not null check (value_type in ('index_number', 'percentage')),
  unit_label text not null,
  source_name text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists public.correction_index_values (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  correction_index_id uuid not null references public.correction_indices(id) on delete cascade,
  reference_month date not null,
  value numeric(18,6) not null,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reference_month = date_trunc('month', reference_month)::date),
  unique (company_id, correction_index_id, reference_month)
);

create index if not exists correction_indices_company_status_idx
  on public.correction_indices(company_id, status, code);
create index if not exists correction_index_values_company_month_idx
  on public.correction_index_values(company_id, reference_month desc);
create index if not exists correction_index_values_index_month_idx
  on public.correction_index_values(correction_index_id, reference_month desc);

insert into public.permissions (key, module, action, description) values
  ('indices.view', 'finance', 'view_correction_indices', 'Visualizar índices de correção e valores mensais'),
  ('indices.manage', 'finance', 'manage_correction_indices', 'Cadastrar e atualizar valores mensais dos índices')
on conflict (key) do update set
  module = excluded.module,
  action = excluded.action,
  description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select role.id, permission_key
from public.roles role
cross join lateral (
  select unnest(
    case
      when role.key in ('owner', 'admin', 'director', 'finance') then
        array['indices.view', 'indices.manage']::text[]
      when role.key in ('commercial', 'engineering', 'viewer') then
        array['indices.view']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

alter table public.correction_indices enable row level security;
alter table public.correction_index_values enable row level security;

drop policy if exists correction_indices_select on public.correction_indices;
create policy correction_indices_select on public.correction_indices
for select using (
  public.has_company_permission(company_id, 'indices.view')
  or public.has_company_permission(company_id, 'indices.manage')
  or public.has_company_permission(company_id, 'receivables.view')
  or public.has_company_permission(company_id, 'receivables.manage')
);

drop policy if exists correction_indices_insert on public.correction_indices;
create policy correction_indices_insert on public.correction_indices
for insert with check (public.has_company_permission(company_id, 'indices.manage'));

drop policy if exists correction_indices_update on public.correction_indices;
create policy correction_indices_update on public.correction_indices
for update using (public.has_company_permission(company_id, 'indices.manage'))
with check (public.has_company_permission(company_id, 'indices.manage'));

drop policy if exists correction_index_values_select on public.correction_index_values;
create policy correction_index_values_select on public.correction_index_values
for select using (
  public.has_company_permission(company_id, 'indices.view')
  or public.has_company_permission(company_id, 'indices.manage')
  or public.has_company_permission(company_id, 'receivables.view')
  or public.has_company_permission(company_id, 'receivables.manage')
);

drop policy if exists correction_index_values_insert on public.correction_index_values;
create policy correction_index_values_insert on public.correction_index_values
for insert with check (public.has_company_permission(company_id, 'indices.manage'));

drop policy if exists correction_index_values_update on public.correction_index_values;
create policy correction_index_values_update on public.correction_index_values
for update using (public.has_company_permission(company_id, 'indices.manage'))
with check (public.has_company_permission(company_id, 'indices.manage'));

insert into public.correction_indices (
  company_id, code, name, value_type, unit_label, source_name, status, created_by
)
select company.id, seed.code, seed.name, seed.value_type, seed.unit_label, seed.source_name, 'active', company.created_by
from public.companies company
cross join (
  values
    ('CUB-SC', 'CUB-SC', 'index_number', 'R$/m²', 'Sinduscon/SC'),
    ('IPCA', 'IPCA', 'percentage', '% no mês', 'IBGE'),
    ('INCC', 'INCC', 'percentage', '% no mês', 'FGV')
) as seed(code, name, value_type, unit_label, source_name)
on conflict (company_id, code) do update set
  name = excluded.name,
  value_type = excluded.value_type,
  unit_label = excluded.unit_label,
  source_name = excluded.source_name,
  status = 'active',
  updated_at = now();

alter table public.receivables
  add column if not exists correction_index_id uuid references public.correction_indices(id),
  add column if not exists correction_base_month date,
  add column if not exists correction_base_value numeric(18,6);

create index if not exists receivables_correction_index_idx
  on public.receivables(correction_index_id, correction_base_month);

grant select, insert, update on public.correction_indices to authenticated;
grant select, insert, update on public.correction_index_values to authenticated;
