-- Elos OS — Fundação multiempresa
-- Execute este arquivo no SQL Editor do Supabase antes de testar a seleção de empresa/obra.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  document text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permissions (
  key text primary key,
  module text not null,
  action text not null,
  description text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, key)
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key)
);

create table if not exists public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id),
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  code text,
  city text,
  state text,
  status text not null default 'active' check (status in ('planning', 'active', 'paused', 'completed', 'archived')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists public.project_memberships (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid references public.roles(id),
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists company_memberships_user_idx on public.company_memberships(user_id);
create index if not exists company_memberships_company_idx on public.company_memberships(company_id);
create index if not exists projects_company_idx on public.projects(company_id);
create index if not exists project_memberships_user_idx on public.project_memberships(user_id);
create index if not exists roles_company_idx on public.roles(company_id);

insert into public.permissions (key, module, action, description) values
  ('admin.company.manage', 'admin', 'manage_company', 'Gerenciar dados e configurações da empresa'),
  ('admin.users.view', 'admin', 'view_users', 'Visualizar usuários e acessos'),
  ('admin.users.manage', 'admin', 'manage_users', 'Adicionar usuários e alterar papéis'),
  ('admin.roles.manage', 'admin', 'manage_roles', 'Configurar papéis e permissões'),
  ('projects.view', 'projects', 'view', 'Visualizar obras'),
  ('projects.manage', 'projects', 'manage', 'Criar e editar obras'),
  ('execution.view', 'execution', 'view', 'Visualizar execução da obra'),
  ('execution.manage', 'execution', 'manage', 'Gerenciar execução da obra'),
  ('quality.view', 'quality', 'view', 'Visualizar qualidade e vistorias'),
  ('quality.manage', 'quality', 'manage', 'Gerenciar qualidade e vistorias'),
  ('financial.view', 'financial', 'view', 'Visualizar informações financeiras'),
  ('financial.manage', 'financial', 'manage', 'Gerenciar informações financeiras'),
  ('commercial.view', 'commercial', 'view', 'Visualizar informações comerciais'),
  ('commercial.manage', 'commercial', 'manage', 'Gerenciar informações comerciais'),
  ('documents.view', 'documents', 'view', 'Visualizar documentos'),
  ('documents.manage', 'documents', 'manage', 'Gerenciar documentos')
on conflict (key) do update set
  module = excluded.module,
  action = excluded.action,
  description = excluded.description;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do update set
    email = excluded.email,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_memberships membership
    where membership.company_id = target_company_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  );
$$;

create or replace function public.has_company_permission(target_company_id uuid, target_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_memberships membership
    join public.role_permissions role_permission on role_permission.role_id = membership.role_id
    where membership.company_id = target_company_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and role_permission.permission_key = target_permission
      and role_permission.allowed = true
  );
$$;

create or replace function public.can_view_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = target_user_id
    or exists (
      select 1
      from public.company_memberships mine
      join public.company_memberships theirs on theirs.company_id = mine.company_id
      where mine.user_id = auth.uid()
        and mine.status = 'active'
        and theirs.user_id = target_user_id
        and theirs.status in ('active', 'invited')
    );
$$;

create or replace function public.bootstrap_company(
  p_company_name text,
  p_company_slug text,
  p_project_name text default null,
  p_project_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_slug text;
  created_company_id uuid;
  created_project_id uuid;
  owner_role_id uuid;
begin
  if current_user_id is null then
    raise exception 'Usuário não autenticado.';
  end if;

  if nullif(trim(p_company_name), '') is null then
    raise exception 'Informe o nome da empresa.';
  end if;

  normalized_slug := regexp_replace(lower(coalesce(nullif(trim(p_company_slug), ''), p_company_name)), '[^a-z0-9]+', '-', 'g');
  normalized_slug := trim(both '-' from normalized_slug);

  if normalized_slug = '' then
    normalized_slug := 'empresa-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  end if;

  insert into public.profiles (id, email, full_name)
  select current_user_id, coalesce(users.email, ''), coalesce(users.raw_user_meta_data ->> 'full_name', split_part(coalesce(users.email, ''), '@', 1))
  from auth.users users
  where users.id = current_user_id
  on conflict (id) do update set email = excluded.email, updated_at = now();

  insert into public.companies (name, slug, created_by)
  values (trim(p_company_name), normalized_slug, current_user_id)
  returning id into created_company_id;

  insert into public.roles (company_id, key, name, description, is_system) values
    (created_company_id, 'owner', 'Proprietário', 'Acesso total e responsabilidade pela empresa.', true),
    (created_company_id, 'admin', 'Administrador', 'Gerencia empresa, usuários, papéis e módulos.', true),
    (created_company_id, 'director', 'Diretoria', 'Visão ampla de gestão, obras, financeiro e comercial.', true),
    (created_company_id, 'engineering', 'Engenharia', 'Execução, qualidade, planejamento e documentos.', true),
    (created_company_id, 'finance', 'Financeiro', 'Contas, fluxo financeiro e documentos financeiros.', true),
    (created_company_id, 'commercial', 'Comercial', 'Clientes, unidades, vendas e contratos comerciais.', true),
    (created_company_id, 'field', 'Obra', 'Rotinas de campo, diário, serviços e vistorias.', true),
    (created_company_id, 'viewer', 'Consulta', 'Acesso somente para visualização.', true);

  select id into owner_role_id
  from public.roles
  where company_id = created_company_id and key = 'owner';

  insert into public.role_permissions (role_id, permission_key)
  select role.id, permission.key
  from public.roles role
  cross join public.permissions permission
  where role.company_id = created_company_id
    and (
      role.key in ('owner', 'admin')
      or (role.key = 'director' and permission.key not in ('admin.roles.manage'))
      or (role.key = 'engineering' and permission.key in (
        'projects.view', 'execution.view', 'execution.manage', 'quality.view', 'quality.manage', 'documents.view', 'documents.manage'
      ))
      or (role.key = 'finance' and permission.key in (
        'projects.view', 'financial.view', 'financial.manage', 'documents.view', 'documents.manage'
      ))
      or (role.key = 'commercial' and permission.key in (
        'projects.view', 'commercial.view', 'commercial.manage', 'documents.view', 'documents.manage'
      ))
      or (role.key = 'field' and permission.key in (
        'projects.view', 'execution.view', 'execution.manage', 'quality.view', 'quality.manage', 'documents.view'
      ))
      or (role.key = 'viewer' and permission.action = 'view')
    )
  on conflict do nothing;

  insert into public.company_memberships (company_id, user_id, role_id, status)
  values (created_company_id, current_user_id, owner_role_id, 'active');

  if nullif(trim(coalesce(p_project_name, '')), '') is not null then
    insert into public.projects (company_id, name, code, status, created_by)
    values (
      created_company_id,
      trim(p_project_name),
      nullif(trim(coalesce(p_project_code, '')), ''),
      'active',
      current_user_id
    )
    returning id into created_project_id;

    insert into public.project_memberships (project_id, user_id, role_id)
    values (created_project_id, current_user_id, owner_role_id)
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'company_id', created_company_id,
    'project_id', created_project_id,
    'role_id', owner_role_id
  );
end;
$$;

create or replace function public.add_company_member_by_email(
  p_company_id uuid,
  p_email text,
  p_role_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_user_id uuid;
  target_role_id uuid;
  membership_id uuid;
begin
  if not public.has_company_permission(p_company_id, 'admin.users.manage') then
    raise exception 'Você não possui permissão para gerenciar usuários.';
  end if;

  select users.id into target_user_id
  from auth.users users
  where lower(users.email) = lower(trim(p_email))
  limit 1;

  if target_user_id is null then
    raise exception 'Este e-mail ainda não possui uma conta confirmada no Elos OS.';
  end if;

  select role.id into target_role_id
  from public.roles role
  where role.company_id = p_company_id
    and role.key = p_role_key;

  if target_role_id is null then
    raise exception 'Papel de acesso inválido.';
  end if;

  insert into public.profiles (id, email, full_name)
  select users.id, coalesce(users.email, ''), coalesce(users.raw_user_meta_data ->> 'full_name', split_part(coalesce(users.email, ''), '@', 1))
  from auth.users users
  where users.id = target_user_id
  on conflict (id) do update set email = excluded.email, updated_at = now();

  insert into public.company_memberships (company_id, user_id, role_id, status)
  values (p_company_id, target_user_id, target_role_id, 'active')
  on conflict (company_id, user_id) do update set
    role_id = excluded.role_id,
    status = 'active',
    updated_at = now()
  returning id into membership_id;

  return membership_id;
end;
$$;

create or replace function public.set_company_member_role(
  p_membership_id uuid,
  p_role_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company_id uuid;
  target_role_id uuid;
begin
  select membership.company_id into target_company_id
  from public.company_memberships membership
  where membership.id = p_membership_id;

  if target_company_id is null or not public.has_company_permission(target_company_id, 'admin.users.manage') then
    raise exception 'Você não possui permissão para alterar este acesso.';
  end if;

  select role.id into target_role_id
  from public.roles role
  where role.company_id = target_company_id and role.key = p_role_key;

  if target_role_id is null then
    raise exception 'Papel de acesso inválido.';
  end if;

  update public.company_memberships
  set role_id = target_role_id, updated_at = now()
  where id = p_membership_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.company_memberships enable row level security;
alter table public.projects enable row level security;
alter table public.project_memberships enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (public.can_view_profile(id));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
for select to authenticated
using (public.is_company_member(id));

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
for update to authenticated
using (public.has_company_permission(id, 'admin.company.manage'))
with check (public.has_company_permission(id, 'admin.company.manage'));

drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions
for select to authenticated
using (true);

drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists roles_manage on public.roles;
create policy roles_manage on public.roles
for all to authenticated
using (public.has_company_permission(company_id, 'admin.roles.manage'))
with check (public.has_company_permission(company_id, 'admin.roles.manage'));

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions
for select to authenticated
using (
  exists (
    select 1 from public.roles role
    where role.id = role_id and public.is_company_member(role.company_id)
  )
);

drop policy if exists role_permissions_manage on public.role_permissions;
create policy role_permissions_manage on public.role_permissions
for all to authenticated
using (
  exists (
    select 1 from public.roles role
    where role.id = role_id and public.has_company_permission(role.company_id, 'admin.roles.manage')
  )
)
with check (
  exists (
    select 1 from public.roles role
    where role.id = role_id and public.has_company_permission(role.company_id, 'admin.roles.manage')
  )
);

drop policy if exists company_memberships_select on public.company_memberships;
create policy company_memberships_select on public.company_memberships
for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists projects_manage on public.projects;
create policy projects_manage on public.projects
for all to authenticated
using (public.has_company_permission(company_id, 'projects.manage'))
with check (public.has_company_permission(company_id, 'projects.manage'));

drop policy if exists project_memberships_select on public.project_memberships;
create policy project_memberships_select on public.project_memberships
for select to authenticated
using (
  exists (
    select 1 from public.projects project
    where project.id = project_id and public.is_company_member(project.company_id)
  )
);

drop policy if exists project_memberships_manage on public.project_memberships;
create policy project_memberships_manage on public.project_memberships
for all to authenticated
using (
  exists (
    select 1 from public.projects project
    where project.id = project_id and public.has_company_permission(project.company_id, 'admin.users.manage')
  )
)
with check (
  exists (
    select 1 from public.projects project
    where project.id = project_id and public.has_company_permission(project.company_id, 'admin.users.manage')
  )
);

grant select, update on public.profiles to authenticated;
grant select, update on public.companies to authenticated;
grant select on public.permissions to authenticated;
grant select, insert, update, delete on public.roles to authenticated;
grant select, insert, update, delete on public.role_permissions to authenticated;
grant select on public.company_memberships to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_memberships to authenticated;

grant execute on function public.bootstrap_company(text, text, text, text) to authenticated;
grant execute on function public.add_company_member_by_email(uuid, text, text) to authenticated;
grant execute on function public.set_company_member_role(uuid, text) to authenticated;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.has_company_permission(uuid, text) to authenticated;
