-- Elos OS — Administração da plataforma e criação controlada de ambientes
-- Remove o auto-onboarding de empresas e reserva a criação de ambientes ao administrador fundador.

begin;

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','inactive')),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_environment_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  company_name text not null,
  company_slug text not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  owner_email text not null,
  project_id uuid references public.projects(id) on delete set null,
  project_name text,
  action text not null check (action in ('environment_created','environment_status_changed')),
  details jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create index if not exists platform_environment_audit_changed_at_idx
  on public.platform_environment_audit(changed_at desc);

-- O primeiro proprietário ativo da Bossa torna-se o administrador fundador da plataforma.
-- A seleção é determinística e evita conceder o acesso a todos os proprietários futuros.
insert into public.platform_admins(user_id,status,note,created_by)
select membership.user_id,
       'active',
       'Administrador fundador identificado pelo primeiro vínculo de Proprietário da Bossa.',
       membership.user_id
from public.companies company
join public.company_memberships membership
  on membership.company_id=company.id and membership.status='active'
join public.roles role
  on role.id=membership.role_id and role.key='owner'
where company.slug='bossa'
order by membership.created_at asc
limit 1
on conflict(user_id) do update set
  status='active',
  updated_at=now();

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.platform_admins admin
    where admin.user_id=auth.uid()
      and admin.status='active'
  );
$$;

create or replace function public.platform_create_environment(
  p_company_name text,
  p_company_slug text,
  p_owner_email text,
  p_project_name text default null,
  p_project_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_actor_id uuid:=auth.uid();
  v_owner_id uuid;
  v_company_id uuid;
  v_project_id uuid;
  v_owner_role_id uuid;
  v_template_company_id uuid;
  v_slug text;
begin
  if v_actor_id is null or not public.is_platform_admin() then
    raise exception 'Área restrita à administração da plataforma.';
  end if;

  if nullif(trim(coalesce(p_company_name,'')),'') is null then
    raise exception 'Informe o nome da empresa.';
  end if;
  if nullif(trim(coalesce(p_owner_email,'')),'') is null then
    raise exception 'Informe o e-mail do primeiro proprietário.';
  end if;

  select users.id into v_owner_id
  from auth.users users
  where lower(users.email)=lower(trim(p_owner_email))
    and users.email_confirmed_at is not null
  limit 1;

  if v_owner_id is null then
    raise exception 'O proprietário precisa criar e confirmar a conta antes da liberação do ambiente.';
  end if;

  v_slug:=regexp_replace(
    lower(coalesce(nullif(trim(coalesce(p_company_slug,'')),''),trim(p_company_name))),
    '[^a-z0-9]+','-','g'
  );
  v_slug:=trim(both '-' from v_slug);
  if v_slug='' then
    v_slug:='empresa-' || substr(replace(gen_random_uuid()::text,'-',''),1,8);
  end if;

  if exists(select 1 from public.companies where slug=v_slug) then
    raise exception 'Este identificador já pertence a outro ambiente.';
  end if;

  insert into public.profiles(id,email,full_name)
  select users.id,
         coalesce(users.email,''),
         coalesce(users.raw_user_meta_data->>'full_name',split_part(coalesce(users.email,''),'@',1))
  from auth.users users
  where users.id=v_owner_id
  on conflict(id) do update set
    email=excluded.email,
    updated_at=now();

  insert into public.companies(name,slug,status,created_by)
  values(trim(p_company_name),v_slug,'active',v_actor_id)
  returning id into v_company_id;

  select company.id into v_template_company_id
  from public.companies company
  where company.slug='bossa'
    and company.id<>v_company_id
  order by company.created_at asc
  limit 1;

  if v_template_company_id is not null then
    insert into public.roles(
      company_id,key,name,description,is_system,status,created_by,updated_by
    )
    select v_company_id,
           template.key,
           template.name,
           template.description,
           true,
           'active',
           v_actor_id,
           v_actor_id
    from public.roles template
    where template.company_id=v_template_company_id
      and template.is_system=true
      and template.status='active'
    on conflict(company_id,key) do nothing;
  end if;

  insert into public.roles(
    company_id,key,name,description,is_system,status,created_by,updated_by
  ) values
    (v_company_id,'owner','Proprietário','Acesso total e responsabilidade pela empresa.',true,'active',v_actor_id,v_actor_id),
    (v_company_id,'admin','Administrador','Gerencia empresa, usuários, papéis e módulos.',true,'active',v_actor_id,v_actor_id),
    (v_company_id,'director','Diretoria','Visão ampla de gestão, obras, financeiro e comercial.',true,'active',v_actor_id,v_actor_id),
    (v_company_id,'engineering','Engenharia','Execução, qualidade, planejamento e documentos.',true,'active',v_actor_id,v_actor_id),
    (v_company_id,'finance','Financeiro','Contas, fluxo financeiro e documentos financeiros.',true,'active',v_actor_id,v_actor_id),
    (v_company_id,'commercial','Comercial','Clientes, unidades, vendas e contratos comerciais.',true,'active',v_actor_id,v_actor_id),
    (v_company_id,'field','Obra','Rotinas de campo, diário, serviços e vistorias.',true,'active',v_actor_id,v_actor_id),
    (v_company_id,'viewer','Consulta','Acesso somente para visualização.',true,'active',v_actor_id,v_actor_id)
  on conflict(company_id,key) do nothing;

  if v_template_company_id is not null then
    insert into public.role_permissions(role_id,permission_key,allowed)
    select target.id,
           source_permission.permission_key,
           source_permission.allowed
    from public.roles target
    join public.roles source
      on source.company_id=v_template_company_id
     and source.key=target.key
    join public.role_permissions source_permission
      on source_permission.role_id=source.id
    where target.company_id=v_company_id
      and source_permission.allowed=true
    on conflict(role_id,permission_key) do update set allowed=excluded.allowed;
  end if;

  -- Proprietário e Administrador recebem também todas as permissões atuais e futuras já cadastradas.
  insert into public.role_permissions(role_id,permission_key,allowed)
  select role.id,permission.key,true
  from public.roles role
  cross join public.permissions permission
  where role.company_id=v_company_id
    and role.key in ('owner','admin')
  on conflict(role_id,permission_key) do update set allowed=true;

  select role.id into v_owner_role_id
  from public.roles role
  where role.company_id=v_company_id and role.key='owner';

  if v_owner_role_id is null then
    raise exception 'Não foi possível criar o papel Proprietário.';
  end if;

  insert into public.company_memberships(company_id,user_id,role_id,status)
  values(v_company_id,v_owner_id,v_owner_role_id,'active');

  if nullif(trim(coalesce(p_project_name,'')),'') is not null then
    insert into public.projects(company_id,name,code,status,created_by)
    values(
      v_company_id,
      trim(p_project_name),
      nullif(trim(coalesce(p_project_code,'')),''),
      'active',
      v_actor_id
    )
    returning id into v_project_id;

    insert into public.project_memberships(project_id,user_id,role_id)
    values(v_project_id,v_owner_id,v_owner_role_id)
    on conflict(project_id,user_id) do update set role_id=excluded.role_id;
  end if;

  insert into public.platform_environment_audit(
    company_id,company_name,company_slug,owner_user_id,owner_email,
    project_id,project_name,action,details,changed_by
  ) values(
    v_company_id,trim(p_company_name),v_slug,v_owner_id,lower(trim(p_owner_email)),
    v_project_id,nullif(trim(coalesce(p_project_name,'')),''),'environment_created',
    jsonb_build_object('project_code',nullif(trim(coalesce(p_project_code,'')),'')),
    v_actor_id
  );

  return jsonb_build_object(
    'company_id',v_company_id,
    'project_id',v_project_id,
    'owner_user_id',v_owner_id,
    'slug',v_slug
  );
end;
$$;

create or replace function public.platform_list_environments()
returns table(
  company_id uuid,
  company_name text,
  company_slug text,
  company_status text,
  owner_email text,
  project_count bigint,
  member_count bigint,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public,auth
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Área restrita à administração da plataforma.';
  end if;

  return query
  select company.id,
         company.name,
         company.slug,
         company.status,
         coalesce((
           select users.email
           from public.company_memberships membership
           join public.roles role on role.id=membership.role_id
           join auth.users users on users.id=membership.user_id
           where membership.company_id=company.id
             and membership.status='active'
             and role.key='owner'
           order by membership.created_at asc
           limit 1
         ),''),
         (select count(*) from public.projects project where project.company_id=company.id and project.status<>'archived'),
         (select count(*) from public.company_memberships membership where membership.company_id=company.id and membership.status='active'),
         company.created_at
  from public.companies company
  order by company.created_at desc;
end;
$$;

alter table public.platform_admins enable row level security;
alter table public.platform_environment_audit enable row level security;

drop policy if exists platform_admins_select_self on public.platform_admins;
create policy platform_admins_select_self on public.platform_admins
for select to authenticated
using(user_id=auth.uid() and status='active');

drop policy if exists platform_environment_audit_select on public.platform_environment_audit;
create policy platform_environment_audit_select on public.platform_environment_audit
for select to authenticated
using(public.is_platform_admin());

revoke all on public.platform_admins from anon,authenticated;
revoke all on public.platform_environment_audit from anon,authenticated;
grant select on public.platform_admins to authenticated;
grant select on public.platform_environment_audit to authenticated;

-- A função antiga não pode mais ser chamada por usuários comuns, mesmo por REST/RPC direto.
revoke all on function public.bootstrap_company(text,text,text,text) from public,anon,authenticated;
grant execute on function public.bootstrap_company(text,text,text,text) to service_role;

revoke all on function public.is_platform_admin() from public;
revoke all on function public.platform_create_environment(text,text,text,text,text) from public;
revoke all on function public.platform_list_environments() from public;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.platform_create_environment(text,text,text,text,text) to authenticated;
grant execute on function public.platform_list_environments() to authenticated;

commit;
