\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create table auth.users (id uuid primary key);
create or replace function auth.uid()
returns uuid language sql stable as $$
  select '00000000-0000-0000-0000-000000000001'::uuid
$$;

create table public.companies (id uuid primary key, name text not null);
create table public.permissions (key text primary key, module text not null, action text not null, description text not null);
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
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003');
insert into public.companies values
  ('10000000-0000-0000-0000-000000000001', 'Empresa A'),
  ('10000000-0000-0000-0000-000000000002', 'Empresa B');
insert into public.permissions values
  ('projects.view', 'projects', 'view', 'Visualizar obras'),
  ('admin.roles.manage', 'admin', 'manage', 'Gerenciar permissões');
insert into public.roles values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner', 'Proprietário', 'active'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'admin', 'Administrador', 'active'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'engineering', 'Engenharia', 'active'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'owner', 'Proprietário', 'active');
insert into public.company_memberships values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'active'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'active'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'active');

\i supabase/migrations/20260810_0081_owner_admin_full_access.sql

-- Testa owner usando auth.uid() padrão.
do $$
begin
  if not public.has_company_permission('10000000-0000-0000-0000-000000000001', 'admin.roles.manage') then
    raise exception 'owner não recebeu acesso total';
  end if;
end $$;

-- Troca auth.uid() para o usuário admin e testa bypass central.
create or replace function auth.uid()
returns uuid language sql stable as $$
  select '00000000-0000-0000-0000-000000000002'::uuid
$$;
do $$
begin
  if not public.has_company_permission('10000000-0000-0000-0000-000000000001', 'admin.roles.manage') then
    raise exception 'admin não recebeu acesso total';
  end if;
end $$;

-- Backfill deve deixar ambos com todas as permissões.
do $$
declare
  total_permissions integer;
  owner_permissions integer;
  admin_permissions integer;
begin
  select count(*) into total_permissions from public.permissions;
  select count(*) into owner_permissions from public.role_permissions where role_id = '20000000-0000-0000-0000-000000000001' and allowed;
  select count(*) into admin_permissions from public.role_permissions where role_id = '20000000-0000-0000-0000-000000000002' and allowed;
  if owner_permissions <> total_permissions or admin_permissions <> total_permissions then
    raise exception 'backfill incompleto: owner %, admin %, total %', owner_permissions, admin_permissions, total_permissions;
  end if;
end $$;

-- Não pode desativar nem excluir permissão de owner/admin.
update public.role_permissions set allowed = false
where role_id = '20000000-0000-0000-0000-000000000002' and permission_key = 'projects.view';
delete from public.role_permissions
where role_id = '20000000-0000-0000-0000-000000000001' and permission_key = 'projects.view';
do $$
begin
  if not exists (select 1 from public.role_permissions where role_id = '20000000-0000-0000-0000-000000000002' and permission_key = 'projects.view' and allowed) then
    raise exception 'admin teve permissão desativada';
  end if;
  if not exists (select 1 from public.role_permissions where role_id = '20000000-0000-0000-0000-000000000001' and permission_key = 'projects.view' and allowed) then
    raise exception 'owner teve permissão excluída';
  end if;
end $$;

-- Permissão futura deve chegar aos dois papéis.
insert into public.permissions values ('future.module.manage', 'future_module', 'manage', 'Permissão futura');
do $$
begin
  if not exists (select 1 from public.role_permissions where role_id = '20000000-0000-0000-0000-000000000001' and permission_key = 'future.module.manage' and allowed)
     or not exists (select 1 from public.role_permissions where role_id = '20000000-0000-0000-0000-000000000002' and permission_key = 'future.module.manage' and allowed) then
    raise exception 'permissão futura não foi concedida a owner/admin';
  end if;
end $$;

-- Papel comum continua sem bypass.
create or replace function auth.uid()
returns uuid language sql stable as $$
  select '00000000-0000-0000-0000-000000000003'::uuid
$$;
do $$
begin
  if public.has_company_permission('10000000-0000-0000-0000-000000000001', 'admin.roles.manage') then
    raise exception 'papel comum recebeu acesso total';
  end if;
end $$;

-- Suspensão continua bloqueando admin.
create or replace function auth.uid()
returns uuid language sql stable as $$
  select '00000000-0000-0000-0000-000000000002'::uuid
$$;
update public.company_memberships set status = 'suspended'
where id = '30000000-0000-0000-0000-000000000002';
do $$
begin
  if public.has_company_permission('10000000-0000-0000-0000-000000000001', 'projects.view') then
    raise exception 'admin suspenso manteve acesso';
  end if;
end $$;

select 'owner-admin-full-access-0081-ok' as result;
