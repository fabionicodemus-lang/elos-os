-- Elos OS — Empreendimentos · Cadastro geral
-- Amplia a tabela projects criada na fundação multiempresa.

alter table public.projects
  add column if not exists project_type text not null default 'residential',
  add column if not exists description text,
  add column if not exists postal_code text,
  add column if not exists street text,
  add column if not exists address_number text,
  add column if not exists complement text,
  add column if not exists district text,
  add column if not exists land_area_m2 numeric(14,2) not null default 0,
  add column if not exists built_area_m2 numeric(14,2) not null default 0,
  add column if not exists private_area_m2 numeric(14,2) not null default 0,
  add column if not exists common_area_m2 numeric(14,2) not null default 0,
  add column if not exists total_units integer not null default 0,
  add column if not exists total_towers integer not null default 1,
  add column if not exists total_floors integer not null default 0,
  add column if not exists parking_spaces integer not null default 0,
  add column if not exists launch_date date,
  add column if not exists construction_start_date date,
  add column if not exists delivery_date date,
  add column if not exists registration_number text,
  add column if not exists notes text;

alter table public.projects
  drop constraint if exists projects_project_type_check;

alter table public.projects
  add constraint projects_project_type_check
  check (project_type in ('residential', 'commercial', 'mixed', 'land', 'industrial', 'other'));

alter table public.projects
  drop constraint if exists projects_nonnegative_metrics_check;

alter table public.projects
  add constraint projects_nonnegative_metrics_check
  check (
    land_area_m2 >= 0 and
    built_area_m2 >= 0 and
    private_area_m2 >= 0 and
    common_area_m2 >= 0 and
    total_units >= 0 and
    total_towers >= 0 and
    total_floors >= 0 and
    parking_spaces >= 0
  );

create unique index if not exists projects_company_code_unique_idx
  on public.projects(company_id, upper(code))
  where code is not null and trim(code) <> '';

create index if not exists projects_company_status_idx
  on public.projects(company_id, status);

create index if not exists projects_delivery_date_idx
  on public.projects(company_id, delivery_date);

insert into public.permissions (key, module, action, description) values
  ('projects.view', 'projects', 'view', 'Visualizar empreendimentos'),
  ('projects.manage', 'projects', 'manage', 'Criar e editar empreendimentos')
on conflict (key) do update set
  module = excluded.module,
  action = excluded.action,
  description = excluded.description;

insert into public.role_permissions (role_id, permission_key, allowed)
select role.id, permission_key, true
from public.roles role
cross join (values ('projects.view'), ('projects.manage')) as permission(permission_key)
where role.key in ('owner', 'admin', 'director')
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

insert into public.role_permissions (role_id, permission_key, allowed)
select role.id, 'projects.view', true
from public.roles role
where role.key in ('engineering', 'finance', 'commercial', 'field', 'viewer')
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;
