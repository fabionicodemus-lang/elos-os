\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create table auth.users (id uuid primary key);
create or replace function auth.uid()
returns uuid language sql stable as $$
  select '00000000-0000-0000-0000-000000000001'::uuid
$$;

create table public.companies (
  id uuid primary key,
  name text not null
);

create table public.permissions (
  key text primary key,
  module text not null,
  action text not null,
  description text not null
);

create table public.roles (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  key text not null,
  name text not null,
  status text not null default 'active',
  unique (company_id, key)
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  allowed boolean not null default true,
  primary key (role_id, permission_key)
);

create table public.company_memberships (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id),
  status text not null default 'active',
  unique (company_id, user_id)
);

insert into auth.users values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');

insert into public.companies values
  ('10000000-0000-0000-0000-000000000001', 'Empresa A'),
  ('10000000-0000-0000-0000-000000000002', 'Empresa B');

insert into public.permissions values
  ('projects.view', 'projects', 'view', 'Visualizar obras'),
  ('admin.roles.manage', 'admin', 'manage', 'Gerenciar permissões');

insert into public.roles values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner', 'Proprietário', 'active'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'engineering', 'Engenharia', 'active'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'owner', 'Proprietário', 'active');

insert into public.role_permissions values
  ('20000000-0000-0000-0000-000000000001', 'projects.view', true),
  ('20000000-0000-0000-0000-000000000002', 'projects.view', true);

insert into public.company_memberships values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'active'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 'active');

\i supabase/migrations/20260806_0080_owner_full_access.sql

do $$
declare
  owner_permission_count integer;
  total_permission_count integer;
begin
  if not public.has_company_permission(
    '10000000-0000-0000-0000-000000000001',
    'admin.roles.manage'
  ) then
    raise exception 'O proprietário não recebeu acesso total';
  end if;

  select count(*) into owner_permission_count
  from public.role_permissions
  where role_id = '20000000-0000-0000-0000-000000000001'
    and allowed = true;

  select count(*) into total_permission_count from public.permissions;

  if owner_permission_count <> total_permission_count then
    raise exception 'Backfill incompleto: % de % permissões', owner_permission_count, total_permission_count;
  end if;

  update public.role_permissions
  set allowed = false
  where role_id = '20000000-0000-0000-0000-000000000001'
    and permission_key = 'admin.roles.manage';

  if not exists (
    select 1 from public.role_permissions
    where role_id = '20000000-0000-0000-0000-000000000001'
      and permission_key = 'admin.roles.manage'
      and allowed = true
  ) then
    raise exception 'Foi possível desativar uma permissão do proprietário';
  end if;

  delete from public.role_permissions
  where role_id = '20000000-0000-0000-0000-000000000001'
    and permission_key = 'admin.roles.manage';

  if not exists (
    select 1 from public.role_permissions
    where role_id = '20000000-0000-0000-0000-000000000001'
      and permission_key = 'admin.roles.manage'
      and allowed = true
  ) then
    raise exception 'Foi possível excluir uma permissão do proprietário';
  end if;

  insert into public.permissions values
    ('future.module.manage', 'future_module', 'manage', 'Permissão criada no futuro');

  if not exists (
    select 1 from public.role_permissions
    where role_id = '20000000-0000-0000-0000-000000000001'
      and permission_key = 'future.module.manage'
      and allowed = true
  ) then
    raise exception 'Permissão nova não foi concedida ao proprietário existente';
  end if;

  if not exists (
    select 1 from public.role_permissions
    where role_id = '20000000-0000-0000-0000-000000000003'
      and permission_key = 'future.module.manage'
      and allowed = true
  ) then
    raise exception 'Permissão nova não foi concedida aos proprietários de todas as empresas';
  end if;

  update public.company_memberships
  set role_id = '20000000-0000-0000-0000-000000000002'
  where id = '30000000-0000-0000-0000-000000000001';

  if public.has_company_permission(
    '10000000-0000-0000-0000-000000000001',
    'admin.roles.manage'
  ) then
    raise exception 'Um papel comum recebeu acesso total indevidamente';
  end if;

  update public.company_memberships
  set role_id = '20000000-0000-0000-0000-000000000001', status = 'suspended'
  where id = '30000000-0000-0000-0000-000000000001';

  if public.has_company_permission(
    '10000000-0000-0000-0000-000000000001',
    'admin.roles.manage'
  ) then
    raise exception 'Proprietário suspenso manteve acesso';
  end if;

  update public.company_memberships
  set status = 'active'
  where id = '30000000-0000-0000-0000-000000000001';

  if public.has_company_permission(
    '10000000-0000-0000-0000-000000000002',
    'admin.roles.manage'
  ) then
    raise exception 'O proprietário acessou outra empresa sem vínculo';
  end if;
end;
$$;

select 'owner-full-access-0080-ok' as result;
