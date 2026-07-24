-- Elos OS — Engenharia: composições de serviços
-- Vincula insumos e coeficientes ao catálogo corporativo de serviços.

begin;

create table if not exists public.engineering_service_compositions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  service_id uuid not null references public.engineering_services(id) on delete cascade,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, service_id)
);

create table if not exists public.engineering_service_composition_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  composition_id uuid not null references public.engineering_service_compositions(id) on delete cascade,
  input_id uuid not null references public.engineering_inputs(id) on delete restrict,
  coefficient numeric(18,8) not null default 0 check (coefficient > 0),
  waste_percentage numeric(9,4) not null default 0
    check (waste_percentage >= 0 and waste_percentage <= 1000),
  effective_coefficient numeric(18,8) generated always as (
    coefficient * (1 + waste_percentage / 100.0)
  ) stored,
  sort_order integer not null default 0,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (composition_id, input_id)
);

create index if not exists engineering_service_compositions_company_idx
  on public.engineering_service_compositions(company_id, status, service_id);
create index if not exists engineering_service_composition_items_composition_idx
  on public.engineering_service_composition_items(composition_id, status, sort_order, created_at);
create index if not exists engineering_service_composition_items_input_idx
  on public.engineering_service_composition_items(input_id, status);

insert into public.permissions (key, module, action, description) values
  ('compositions.view', 'engineering_service_compositions', 'view', 'Visualizar composições de serviços'),
  ('compositions.manage', 'engineering_service_compositions', 'manage', 'Criar e editar composições de serviços')
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
        array['compositions.view', 'compositions.manage']::text[]
      when role.key in ('finance', 'viewer', 'procurement') then
        array['compositions.view']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

alter table public.engineering_service_compositions enable row level security;
alter table public.engineering_service_composition_items enable row level security;

drop policy if exists engineering_service_compositions_select on public.engineering_service_compositions;
create policy engineering_service_compositions_select on public.engineering_service_compositions
for select using (
  public.has_company_permission(company_id, 'compositions.view')
  or public.has_company_permission(company_id, 'compositions.manage')
);

drop policy if exists engineering_service_compositions_insert on public.engineering_service_compositions;
create policy engineering_service_compositions_insert on public.engineering_service_compositions
for insert with check (
  public.has_company_permission(company_id, 'compositions.manage')
);

drop policy if exists engineering_service_compositions_update on public.engineering_service_compositions;
create policy engineering_service_compositions_update on public.engineering_service_compositions
for update using (
  public.has_company_permission(company_id, 'compositions.manage')
) with check (
  public.has_company_permission(company_id, 'compositions.manage')
);

drop policy if exists engineering_service_composition_items_select on public.engineering_service_composition_items;
create policy engineering_service_composition_items_select on public.engineering_service_composition_items
for select using (
  public.has_company_permission(company_id, 'compositions.view')
  or public.has_company_permission(company_id, 'compositions.manage')
);

drop policy if exists engineering_service_composition_items_insert on public.engineering_service_composition_items;
create policy engineering_service_composition_items_insert on public.engineering_service_composition_items
for insert with check (
  public.has_company_permission(company_id, 'compositions.manage')
);

drop policy if exists engineering_service_composition_items_update on public.engineering_service_composition_items;
create policy engineering_service_composition_items_update on public.engineering_service_composition_items
for update using (
  public.has_company_permission(company_id, 'compositions.manage')
) with check (
  public.has_company_permission(company_id, 'compositions.manage')
);

grant select, insert, update on public.engineering_service_compositions to authenticated;
grant select, insert, update on public.engineering_service_composition_items to authenticated;

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'engineering_service_compositions',
    'engineering_service_composition_items'
  )
order by table_name;
