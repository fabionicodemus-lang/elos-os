-- Elos OS — Cadastro central de fornecedores e clientes
-- Execute após 20260722_0001_multitenancy.sql.

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_type text not null default 'company' check (person_type in ('company', 'individual', 'other')),
  legal_name text not null,
  trade_name text,
  tax_id text,
  state_registration text,
  category text,
  contact_name text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  source_system text,
  source_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_system, source_id)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_type text not null default 'PF' check (person_type in ('PF', 'PJ', 'OTHER')),
  name text not null,
  tax_id text,
  identity_document text,
  birth_date date,
  marital_status text,
  profession text,
  email text,
  phone text,
  secondary_phone text,
  address text,
  postal_code text,
  city text,
  state text,
  nationality text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  source_system text,
  source_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_system, source_id)
);

create index if not exists suppliers_company_name_idx
  on public.suppliers(company_id, legal_name);
create index if not exists suppliers_company_status_idx
  on public.suppliers(company_id, status);
create index if not exists suppliers_company_tax_idx
  on public.suppliers(company_id, tax_id);

create index if not exists clients_company_name_idx
  on public.clients(company_id, name);
create index if not exists clients_company_status_idx
  on public.clients(company_id, status);
create index if not exists clients_company_tax_idx
  on public.clients(company_id, tax_id);

insert into public.permissions (key, module, action, description) values
  ('suppliers.view', 'suppliers', 'view', 'Visualizar fornecedores e prestadores'),
  ('suppliers.manage', 'suppliers', 'manage', 'Criar, editar e inativar fornecedores'),
  ('clients.view', 'clients', 'view', 'Visualizar clientes e investidores'),
  ('clients.manage', 'clients', 'manage', 'Criar, editar e inativar clientes')
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
      when role.key in ('owner', 'admin', 'director') then
        array['suppliers.view', 'suppliers.manage', 'clients.view', 'clients.manage']::text[]
      when role.key = 'engineering' then
        array['suppliers.view', 'suppliers.manage']::text[]
      when role.key = 'finance' then
        array['suppliers.view', 'suppliers.manage', 'clients.view']::text[]
      when role.key = 'commercial' then
        array['clients.view', 'clients.manage']::text[]
      when role.key = 'field' then
        array['suppliers.view']::text[]
      when role.key = 'viewer' then
        array['suppliers.view', 'clients.view']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

alter table public.suppliers enable row level security;
alter table public.clients enable row level security;

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
for select using (
  public.has_company_permission(company_id, 'suppliers.view')
  or public.has_company_permission(company_id, 'suppliers.manage')
);

drop policy if exists suppliers_insert on public.suppliers;
create policy suppliers_insert on public.suppliers
for insert with check (
  public.has_company_permission(company_id, 'suppliers.manage')
);

drop policy if exists suppliers_update on public.suppliers;
create policy suppliers_update on public.suppliers
for update using (
  public.has_company_permission(company_id, 'suppliers.manage')
) with check (
  public.has_company_permission(company_id, 'suppliers.manage')
);

-- Não existe policy de DELETE: fornecedor utilizado deve ser inativado, nunca apagado.

drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
for select using (
  public.has_company_permission(company_id, 'clients.view')
  or public.has_company_permission(company_id, 'clients.manage')
);

drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients
for insert with check (
  public.has_company_permission(company_id, 'clients.manage')
);

drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients
for update using (
  public.has_company_permission(company_id, 'clients.manage')
) with check (
  public.has_company_permission(company_id, 'clients.manage')
);

-- Não existe policy de DELETE: cliente vinculado a venda/contrato deve ser inativado.

grant select, insert, update on public.suppliers to authenticated;
grant select, insert, update on public.clients to authenticated;
