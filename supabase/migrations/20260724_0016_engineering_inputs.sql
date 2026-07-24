-- Elos OS — Engenharia: catálogo técnico de insumos
-- Base corporativa separada do histórico de preços e cotações.

begin;

create table if not exists public.engineering_inputs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  description text not null,
  unit text not null default 'un',
  category text not null default 'material'
    check (category in ('material', 'labor', 'equipment', 'service', 'freight', 'other')),
  family_code text,
  family_label text,
  brand_reference text,
  technical_specification text,
  source_system text not null default 'elos_os',
  source_code text,
  source_id text,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, source_system, source_id)
);

create index if not exists engineering_inputs_company_status_idx
  on public.engineering_inputs(company_id, status, category, family_code, code);
create index if not exists engineering_inputs_description_idx
  on public.engineering_inputs(company_id, description);
create index if not exists engineering_inputs_source_code_idx
  on public.engineering_inputs(company_id, source_system, source_code)
  where source_code is not null;

insert into public.permissions (key, module, action, description) values
  ('inputs.view', 'engineering_inputs', 'view', 'Visualizar o catálogo técnico de insumos'),
  ('inputs.manage', 'engineering_inputs', 'manage', 'Criar e editar o catálogo técnico de insumos')
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
      when role.key in ('owner', 'admin', 'director', 'engineering') then
        array['inputs.view', 'inputs.manage']::text[]
      when role.key in ('finance', 'viewer', 'procurement') then
        array['inputs.view']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

alter table public.engineering_inputs enable row level security;

drop policy if exists engineering_inputs_select on public.engineering_inputs;
create policy engineering_inputs_select on public.engineering_inputs
for select using (
  public.has_company_permission(company_id, 'inputs.view')
  or public.has_company_permission(company_id, 'inputs.manage')
);

drop policy if exists engineering_inputs_insert on public.engineering_inputs;
create policy engineering_inputs_insert on public.engineering_inputs
for insert with check (
  public.has_company_permission(company_id, 'inputs.manage')
);

drop policy if exists engineering_inputs_update on public.engineering_inputs;
create policy engineering_inputs_update on public.engineering_inputs
for update using (
  public.has_company_permission(company_id, 'inputs.manage')
) with check (
  public.has_company_permission(company_id, 'inputs.manage')
);

grant select, insert, update on public.engineering_inputs to authenticated;

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'engineering_inputs';
