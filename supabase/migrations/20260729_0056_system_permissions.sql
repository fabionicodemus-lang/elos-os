-- Elos OS — Sistema · Permissões
-- Gestão segura dos papéis, matriz de acessos e histórico de alterações.

begin;

alter table public.roles add column if not exists status text not null default 'active';
alter table public.roles add column if not exists created_by uuid references auth.users(id);
alter table public.roles add column if not exists updated_by uuid references auth.users(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.roles'::regclass and conname = 'roles_status_check'
  ) then
    alter table public.roles add constraint roles_status_check check (status in ('active','inactive'));
  end if;
end $$;

create table if not exists public.system_role_permission_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  role_id uuid references public.roles(id) on delete set null,
  role_key text not null,
  role_name text not null,
  action text not null check (action in ('created','updated','permissions_changed','activated','inactivated','cloned')),
  previous_permissions text[] not null default '{}',
  new_permissions text[] not null default '{}',
  details jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create index if not exists system_role_permission_audit_company_idx
  on public.system_role_permission_audit(company_id,changed_at desc);
create index if not exists system_role_permission_audit_role_idx
  on public.system_role_permission_audit(role_id,changed_at desc);

insert into public.permissions(key,module,action,description) values
  ('admin.roles.view','admin','view_roles','Visualizar papéis, matriz de permissões e histórico'),
  ('admin.roles.manage','admin','manage_roles','Criar papéis e configurar permissões')
on conflict(key) do update set
  module=excluded.module,
  action=excluded.action,
  description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.key,true
from public.roles r
cross join public.permissions p
where r.key in ('owner','admin')
on conflict(role_id,permission_key) do update set allowed=true;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'admin.roles.view',true
from public.roles r
where r.key='director'
on conflict(role_id,permission_key) do update set allowed=true;

create or replace function public.has_company_permission(target_company_id uuid,target_permission text)
returns boolean
language sql stable security definer set search_path=public as $$
  select exists (
    select 1
    from public.company_memberships membership
    join public.roles role on role.id=membership.role_id
    where membership.company_id=target_company_id
      and membership.user_id=auth.uid()
      and membership.status='active'
      and role.status='active'
      and (
        role.key in ('owner','admin')
        or exists (
          select 1 from public.role_permissions rp
          where rp.role_id=membership.role_id
            and rp.permission_key=target_permission
            and rp.allowed=true
        )
      )
  );
$$;

create or replace function public.save_company_role(
  p_company_id uuid,
  p_role_id uuid,
  p_name text,
  p_description text,
  p_status text default 'active'
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_role public.roles%rowtype;
  v_role_id uuid;
  v_key text;
  v_action text;
begin
  if not public.has_company_permission(p_company_id,'admin.roles.manage') then
    raise exception 'Você não possui permissão para gerenciar papéis.';
  end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then
    raise exception 'Informe o nome do papel.';
  end if;
  if p_status not in ('active','inactive') then
    raise exception 'Situação do papel inválida.';
  end if;

  if p_role_id is null then
    v_key := 'custom_' || trim(both '_' from regexp_replace(lower(trim(p_name)),'[^a-z0-9]+','_','g'));
    if v_key='custom_' then v_key:='custom_papel'; end if;
    v_key := left(v_key,42) || '_' || substr(replace(gen_random_uuid()::text,'-',''),1,8);
    insert into public.roles(company_id,key,name,description,is_system,status,created_by,updated_by)
    values(p_company_id,v_key,trim(p_name),nullif(trim(coalesce(p_description,'')),''),false,p_status,auth.uid(),auth.uid())
    returning id into v_role_id;
    insert into public.system_role_permission_audit(company_id,role_id,role_key,role_name,action,details,changed_by)
    values(p_company_id,v_role_id,v_key,trim(p_name),'created',jsonb_build_object('status',p_status),auth.uid());
    return v_role_id;
  end if;

  select * into v_role from public.roles where id=p_role_id and company_id=p_company_id for update;
  if v_role.id is null then raise exception 'Papel não localizado.'; end if;
  if v_role.is_system then raise exception 'Os dados dos papéis padrão são protegidos.'; end if;
  if p_status='inactive' and exists(
    select 1 from public.company_memberships
    where company_id=p_company_id and role_id=p_role_id and status in ('active','invited')
  ) then
    raise exception 'Transfira os usuários deste papel antes de inativá-lo.';
  end if;

  v_action := case when v_role.status<>p_status and p_status='inactive' then 'inactivated'
                   when v_role.status<>p_status and p_status='active' then 'activated'
                   else 'updated' end;
  update public.roles
  set name=trim(p_name),description=nullif(trim(coalesce(p_description,'')),''),status=p_status,updated_by=auth.uid(),updated_at=now()
  where id=p_role_id;
  insert into public.system_role_permission_audit(company_id,role_id,role_key,role_name,action,details,changed_by)
  values(p_company_id,p_role_id,v_role.key,trim(p_name),v_action,
    jsonb_build_object('previous_name',v_role.name,'previous_status',v_role.status,'status',p_status),auth.uid());
  return p_role_id;
end;
$$;

create or replace function public.clone_company_role(
  p_company_id uuid,
  p_source_role_id uuid,
  p_name text,
  p_description text default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_source public.roles%rowtype;
  v_new_id uuid;
  v_key text;
  v_permissions text[];
begin
  if not public.has_company_permission(p_company_id,'admin.roles.manage') then
    raise exception 'Você não possui permissão para duplicar papéis.';
  end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Informe o nome do novo papel.'; end if;
  select * into v_source from public.roles where id=p_source_role_id and company_id=p_company_id;
  if v_source.id is null then raise exception 'Papel de origem não localizado.'; end if;
  v_key := 'custom_' || trim(both '_' from regexp_replace(lower(trim(p_name)),'[^a-z0-9]+','_','g'));
  if v_key='custom_' then v_key:='custom_papel'; end if;
  v_key := left(v_key,42) || '_' || substr(replace(gen_random_uuid()::text,'-',''),1,8);
  insert into public.roles(company_id,key,name,description,is_system,status,created_by,updated_by)
  values(p_company_id,v_key,trim(p_name),coalesce(nullif(trim(coalesce(p_description,'')),''),v_source.description),false,'active',auth.uid(),auth.uid())
  returning id into v_new_id;
  insert into public.role_permissions(role_id,permission_key,allowed)
  select v_new_id,permission_key,allowed from public.role_permissions where role_id=p_source_role_id and allowed=true;
  select coalesce(array_agg(permission_key order by permission_key),'{}'::text[]) into v_permissions
  from public.role_permissions where role_id=v_new_id and allowed=true;
  insert into public.system_role_permission_audit(company_id,role_id,role_key,role_name,action,new_permissions,details,changed_by)
  values(p_company_id,v_new_id,v_key,trim(p_name),'cloned',v_permissions,
    jsonb_build_object('source_role_id',p_source_role_id,'source_role_name',v_source.name),auth.uid());
  return v_new_id;
end;
$$;

create or replace function public.set_company_role_permissions(
  p_company_id uuid,
  p_role_id uuid,
  p_permission_keys text[]
) returns integer
language plpgsql security definer set search_path=public as $$
declare
  v_role public.roles%rowtype;
  v_actor_role_id uuid;
  v_actor_role_key text;
  v_previous text[];
  v_next text[];
  v_invalid text[];
begin
  if not public.has_company_permission(p_company_id,'admin.roles.manage') then
    raise exception 'Você não possui permissão para configurar papéis.';
  end if;
  select * into v_role from public.roles where id=p_role_id and company_id=p_company_id for update;
  if v_role.id is null then raise exception 'Papel não localizado.'; end if;
  if v_role.key in ('owner','admin') then raise exception 'Proprietário e Administrador possuem acesso total protegido.'; end if;
  if v_role.status<>'active' then raise exception 'Ative o papel antes de alterar suas permissões.'; end if;

  select m.role_id,r.key into v_actor_role_id,v_actor_role_key
  from public.company_memberships m join public.roles r on r.id=m.role_id
  where m.company_id=p_company_id and m.user_id=auth.uid() and m.status='active';

  select coalesce(array_agg(distinct u.key order by u.key),'{}'::text[]) into v_next
  from unnest(coalesce(p_permission_keys,'{}'::text[])) as u(key)
  where nullif(trim(u.key),'') is not null;
  select coalesce(array_agg(u.key order by u.key),'{}'::text[]) into v_invalid
  from unnest(v_next) as u(key)
  where not exists(select 1 from public.permissions p where p.key=u.key);
  if cardinality(v_invalid)>0 then raise exception 'A lista contém permissões inválidas.'; end if;
  if v_actor_role_id=p_role_id and v_actor_role_key not in ('owner','admin') and not ('admin.roles.manage'=any(v_next)) then
    raise exception 'Você não pode remover a própria permissão de gerenciar papéis.';
  end if;

  select coalesce(array_agg(permission_key order by permission_key),'{}'::text[]) into v_previous
  from public.role_permissions where role_id=p_role_id and allowed=true;
  delete from public.role_permissions where role_id=p_role_id;
  insert into public.role_permissions(role_id,permission_key,allowed)
  select p_role_id,u.key,true from unnest(v_next) as u(key)
  on conflict(role_id,permission_key) do update set allowed=true;
  update public.roles set updated_by=auth.uid(),updated_at=now() where id=p_role_id;
  insert into public.system_role_permission_audit(company_id,role_id,role_key,role_name,action,previous_permissions,new_permissions,details,changed_by)
  values(p_company_id,p_role_id,v_role.key,v_role.name,'permissions_changed',v_previous,v_next,
    jsonb_build_object(
      'added',(select coalesce(jsonb_agg(q.x),'[]'::jsonb) from (select unnest(v_next) x except select unnest(v_previous)) q),
      'removed',(select coalesce(jsonb_agg(q.x),'[]'::jsonb) from (select unnest(v_previous) x except select unnest(v_next)) q)
    ),auth.uid());
  return cardinality(v_next);
end;
$$;

create or replace function public.add_company_member_by_email(p_company_id uuid,p_email text,p_role_key text)
returns uuid
language plpgsql security definer set search_path=public,auth as $$
declare target_user_id uuid; target_role_id uuid; membership_id uuid;
begin
  if not public.has_company_permission(p_company_id,'admin.users.manage') then raise exception 'Você não possui permissão para gerenciar usuários.'; end if;
  select id into target_user_id from auth.users where lower(email)=lower(trim(p_email)) limit 1;
  if target_user_id is null then raise exception 'Este e-mail ainda não possui uma conta confirmada no Elos OS.'; end if;
  select id into target_role_id from public.roles where company_id=p_company_id and key=p_role_key and key<>'owner' and status='active';
  if target_role_id is null then raise exception 'Papel de acesso inválido ou inativo.'; end if;
  insert into public.profiles(id,email,full_name)
  select id,coalesce(email,''),coalesce(raw_user_meta_data->>'full_name',split_part(coalesce(email,''),'@',1)) from auth.users where id=target_user_id
  on conflict(id) do update set email=excluded.email,updated_at=now();
  insert into public.company_memberships(company_id,user_id,role_id,status)
  values(p_company_id,target_user_id,target_role_id,'active')
  on conflict(company_id,user_id) do update set role_id=excluded.role_id,status='active',updated_at=now()
  returning id into membership_id;
  return membership_id;
end;
$$;

create or replace function public.set_company_member_role(p_membership_id uuid,p_role_key text)
returns void
language plpgsql security definer set search_path=public as $$
declare v_membership public.company_memberships%rowtype; v_current_role public.roles%rowtype; v_actor_key text; v_target_role_id uuid;
begin
  select * into v_membership from public.company_memberships where id=p_membership_id for update;
  if v_membership.id is null or not public.has_company_permission(v_membership.company_id,'admin.users.manage') then raise exception 'Você não possui permissão para alterar este acesso.'; end if;
  select * into v_current_role from public.roles where id=v_membership.role_id;
  if v_current_role.key='owner' then raise exception 'O papel do proprietário não pode ser alterado.'; end if;
  select r.key into v_actor_key from public.company_memberships m join public.roles r on r.id=m.role_id where m.company_id=v_membership.company_id and m.user_id=auth.uid() and m.status='active';
  if v_membership.user_id=auth.uid() and v_actor_key<>'owner' then raise exception 'Um administrador não pode alterar o próprio papel.'; end if;
  select id into v_target_role_id from public.roles where company_id=v_membership.company_id and key=p_role_key and key<>'owner' and status='active';
  if v_target_role_id is null then raise exception 'Papel de acesso inválido ou inativo.'; end if;
  update public.company_memberships set role_id=v_target_role_id,updated_at=now() where id=p_membership_id;
end;
$$;

alter table public.system_role_permission_audit enable row level security;
drop policy if exists system_role_permission_audit_select on public.system_role_permission_audit;
create policy system_role_permission_audit_select on public.system_role_permission_audit
for select to authenticated using(
  public.has_company_permission(company_id,'admin.roles.view') or public.has_company_permission(company_id,'admin.roles.manage')
);

revoke insert,update,delete on public.system_role_permission_audit from authenticated;
grant select on public.system_role_permission_audit to authenticated;
grant execute on function public.save_company_role(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.clone_company_role(uuid,uuid,text,text) to authenticated;
grant execute on function public.set_company_role_permissions(uuid,uuid,text[]) to authenticated;
grant execute on function public.add_company_member_by_email(uuid,text,text) to authenticated;
grant execute on function public.set_company_member_role(uuid,text) to authenticated;
grant execute on function public.has_company_permission(uuid,text) to authenticated;

commit;
