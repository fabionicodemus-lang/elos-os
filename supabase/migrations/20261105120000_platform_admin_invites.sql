-- Administração global: convites de usuários e provisionamento multiempresa.
-- Executar somente após a migration 0061 (ambientes) e a 0083 (separação Elos/Bossa).
begin;

-- Uma conta convidada pelo Supabase Auth ainda não tem email_confirmed_at.
-- Ela pode receber o vínculo, mas somente entrará após aceitar o convite.
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
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
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

  if nullif(trim(coalesce(p_company_name, '')), '') is null then
    raise exception 'Informe o nome da empresa.';
  end if;
  if nullif(trim(coalesce(p_owner_email, '')), '') is null then
    raise exception 'Informe o e-mail do primeiro proprietário.';
  end if;

  select u.id into v_owner_id
  from auth.users u
  where lower(u.email) = lower(trim(p_owner_email))
    and (u.email_confirmed_at is not null or u.invited_at is not null)
  limit 1;

  if v_owner_id is null then
    raise exception 'O proprietário precisa possuir uma conta confirmada ou convite enviado pelo Elos OS.';
  end if;

  v_slug := regexp_replace(
    lower(coalesce(nullif(trim(coalesce(p_company_slug, '')), ''), trim(p_company_name))),
    '[^a-z0-9]+', '-', 'g'
  );
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then
    raise exception 'Identificador de empresa inválido.';
  end if;
  if exists (select 1 from public.companies c where c.slug = v_slug) then
    raise exception 'Este identificador já pertence a outro ambiente.';
  end if;

  insert into public.profiles(id, email, full_name)
  select u.id, coalesce(u.email, ''),
    coalesce(u.raw_user_meta_data ->> 'full_name', split_part(coalesce(u.email, ''), '@', 1))
  from auth.users u where u.id = v_owner_id
  on conflict (id) do update set email = excluded.email, updated_at = now();

  insert into public.companies(name, slug, status, created_by)
  values (trim(p_company_name), v_slug, 'active', v_actor_id)
  returning id into v_company_id;

  select c.id into v_template_company_id
  from public.companies c
  where c.slug = 'bossa' and c.id <> v_company_id
  order by c.created_at asc
  limit 1;

  if v_template_company_id is not null then
    insert into public.roles(company_id, key, name, description, is_system, status, created_by, updated_by)
    select v_company_id, r.key, r.name, r.description, true, 'active', v_actor_id, v_actor_id
    from public.roles r
    where r.company_id = v_template_company_id and r.is_system = true and r.status = 'active'
    on conflict (company_id, key) do nothing;
  end if;

  insert into public.roles(company_id, key, name, description, is_system, status, created_by, updated_by)
  values
    (v_company_id, 'owner', 'Proprietário', 'Acesso total e responsabilidade pela empresa.', true, 'active', v_actor_id, v_actor_id),
    (v_company_id, 'admin', 'Administrador', 'Gerencia empresa, usuários, papéis e módulos.', true, 'active', v_actor_id, v_actor_id),
    (v_company_id, 'director', 'Diretoria', 'Visão ampla de gestão, obras, financeiro e comercial.', true, 'active', v_actor_id, v_actor_id),
    (v_company_id, 'engineering', 'Engenharia', 'Execução, qualidade, planejamento e documentos.', true, 'active', v_actor_id, v_actor_id),
    (v_company_id, 'finance', 'Financeiro', 'Contas, fluxo financeiro e documentos financeiros.', true, 'active', v_actor_id, v_actor_id),
    (v_company_id, 'commercial', 'Comercial', 'Clientes, unidades, vendas e contratos comerciais.', true, 'active', v_actor_id, v_actor_id),
    (v_company_id, 'field', 'Obra', 'Rotinas de campo, diário, serviços e vistorias.', true, 'active', v_actor_id, v_actor_id),
    (v_company_id, 'viewer', 'Consulta', 'Acesso somente para visualização.', true, 'active', v_actor_id, v_actor_id)
  on conflict (company_id, key) do nothing;

  if v_template_company_id is not null then
    insert into public.role_permissions(role_id, permission_key, allowed)
    select target.id, source_permission.permission_key, source_permission.allowed
    from public.roles target
    join public.roles source
      on source.company_id = v_template_company_id and source.key = target.key
    join public.role_permissions source_permission on source_permission.role_id = source.id
    where target.company_id = v_company_id and source_permission.allowed = true
    on conflict (role_id, permission_key) do update set allowed = excluded.allowed;
  end if;

  insert into public.role_permissions(role_id, permission_key, allowed)
  select r.id, p.key, true
  from public.roles r cross join public.permissions p
  where r.company_id = v_company_id and r.key in ('owner', 'admin')
  on conflict (role_id, permission_key) do update set allowed = true;

  select r.id into v_owner_role_id
  from public.roles r
  where r.company_id = v_company_id and r.key = 'owner';
  if v_owner_role_id is null then
    raise exception 'Não foi possível criar o papel Proprietário.';
  end if;

  insert into public.company_memberships(company_id, user_id, role_id, status)
  values (v_company_id, v_owner_id, v_owner_role_id, 'active');

  if nullif(trim(coalesce(p_project_name, '')), '') is not null then
    insert into public.projects(company_id, name, code, status, created_by)
    values (v_company_id, trim(p_project_name), nullif(trim(coalesce(p_project_code, '')), ''), 'active', v_actor_id)
    returning id into v_project_id;

    insert into public.project_memberships(project_id, user_id, role_id)
    values (v_project_id, v_owner_id, v_owner_role_id)
    on conflict (project_id, user_id) do update set role_id = excluded.role_id;
  end if;

  insert into public.platform_environment_audit(
    company_id, company_name, company_slug, owner_user_id, owner_email,
    project_id, project_name, action, details, changed_by
  ) values (
    v_company_id, trim(p_company_name), v_slug, v_owner_id, lower(trim(p_owner_email)),
    v_project_id, nullif(trim(coalesce(p_project_name, '')), ''), 'environment_created',
    jsonb_build_object('project_code', nullif(trim(coalesce(p_project_code, '')), '')),
    v_actor_id
  );

  return jsonb_build_object('company_id', v_company_id, 'project_id', v_project_id,
    'owner_user_id', v_owner_id, 'slug', v_slug);
end;
$$;

-- Não expõe dados de auth.users a administradores de empresas clientes.
create or replace function public.platform_lookup_user(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_confirmed boolean := false;
  v_invited boolean := false;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Área restrita à administração da plataforma.';
  end if;
  select u.id, u.email_confirmed_at is not null, u.invited_at is not null
  into v_user_id, v_confirmed, v_invited
  from auth.users u
  where lower(u.email) = lower(trim(p_email)) limit 1;
  return jsonb_build_object('exists', v_user_id is not null,
    'confirmed', coalesce(v_confirmed, false), 'invited', coalesce(v_invited, false));
end;
$$;

create table if not exists public.platform_membership_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  target_email text not null,
  role_key text not null,
  action text not null check (action in ('access_granted', 'access_updated')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_membership_audit_company_created_idx
  on public.platform_membership_audit(company_id, created_at desc);

alter table public.platform_membership_audit enable row level security;
drop policy if exists platform_membership_audit_admin_select on public.platform_membership_audit;
create policy platform_membership_audit_admin_select on public.platform_membership_audit
  for select to authenticated using ((select public.is_platform_admin()));
revoke all on public.platform_membership_audit from public, anon, authenticated;
grant select on public.platform_membership_audit to authenticated;

create or replace function public.platform_add_company_member(
  p_company_id uuid, p_email text, p_role_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_user_id uuid;
  v_role_id uuid;
  v_membership_id uuid;
  v_old_role_key text;
  v_old_status text;
  v_action text := 'access_granted';
begin
  if v_actor_id is null or not public.is_platform_admin() then
    raise exception 'Área restrita à administração da plataforma.';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company_id and c.status = 'active') then
    raise exception 'Empresa inexistente ou inativa.';
  end if;
  if p_role_key = 'owner' then
    raise exception 'O papel Proprietário só pode ser atribuído na criação da empresa.';
  end if;
  select r.id into v_role_id
  from public.roles r
  where r.company_id = p_company_id and r.key = p_role_key and r.status = 'active';
  if v_role_id is null then
    raise exception 'Papel de acesso inválido ou inativo para esta empresa.';
  end if;
  select u.id into v_user_id from auth.users u
  where lower(u.email) = lower(trim(p_email))
    and (u.email_confirmed_at is not null or u.invited_at is not null)
  limit 1;
  if v_user_id is null then
    raise exception 'O usuário precisa estar confirmado ou possuir convite enviado.';
  end if;

  select r.key, m.status into v_old_role_key, v_old_status
  from public.company_memberships m
  join public.roles r on r.id = m.role_id
  where m.company_id = p_company_id and m.user_id = v_user_id
  for update of m;
  if v_old_role_key = 'owner' then
    raise exception 'O acesso do proprietário não pode ser alterado aqui.';
  end if;
  if v_old_status = 'suspended' then
    raise exception 'Acesso suspenso. A reativação precisa de um procedimento próprio.';
  end if;
  if v_old_role_key is not null then
    v_action := 'access_updated';
  end if;

  insert into public.profiles(id, email, full_name)
  select u.id, coalesce(u.email, ''),
    coalesce(u.raw_user_meta_data ->> 'full_name', split_part(coalesce(u.email, ''), '@', 1))
  from auth.users u where u.id = v_user_id
  on conflict (id) do update set email = excluded.email, updated_at = now();

  insert into public.company_memberships(company_id, user_id, role_id, status)
  values (p_company_id, v_user_id, v_role_id, 'active')
  on conflict (company_id, user_id) do update
    set role_id = excluded.role_id, status = 'active', updated_at = now()
    where public.company_memberships.status <> 'suspended'
  returning id into v_membership_id;
  if v_membership_id is null then
    raise exception 'Acesso suspenso. A reativação precisa de um procedimento próprio.';
  end if;

  insert into public.platform_membership_audit(
    company_id, user_id, target_email, role_key, action, created_by
  ) values (p_company_id, v_user_id, lower(trim(p_email)), p_role_key, v_action, v_actor_id);

  return v_membership_id;
end;
$$;

create or replace function public.platform_list_company_members(
  p_company_id uuid, p_limit integer default 25, p_offset integer default 0
)
returns table (
  membership_id uuid, email text, full_name text, role_key text,
  role_name text, membership_status text, email_confirmed boolean,
  created_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Área restrita à administração da plataforma.';
  end if;
  return query
  select m.id, coalesce(u.email, '')::text, coalesce(p.full_name, ''), r.key,
    r.name, m.status, u.email_confirmed_at is not null, m.created_at,
    count(*) over()
  from public.company_memberships m
  join auth.users u on u.id = m.user_id
  join public.roles r on r.id = m.role_id
  left join public.profiles p on p.id = u.id
  where m.company_id = p_company_id
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 50))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- As quatro RPCs têm verificação de administrador global no próprio banco.
revoke all on function public.platform_create_environment(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.platform_lookup_user(text) from public, anon, authenticated;
revoke all on function public.platform_add_company_member(uuid, text, text) from public, anon, authenticated;
revoke all on function public.platform_list_company_members(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.platform_create_environment(text, text, text, text, text) to authenticated;
grant execute on function public.platform_lookup_user(text) to authenticated;
grant execute on function public.platform_add_company_member(uuid, text, text) to authenticated;
grant execute on function public.platform_list_company_members(uuid, integer, integer) to authenticated;

commit;
