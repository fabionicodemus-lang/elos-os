-- Elos OS — separação do administrador global, Elos Engenharia e Bossa.
-- Usuários identificados por hash do e-mail para não publicar endereços no repositório.

begin;

do $$
declare
  v_platform_user_id uuid;
  v_bossa_user_id uuid;
  v_bossa_company_id uuid;
  v_elos_company_id uuid;
  v_bossa_owner_role_id uuid;
  v_elos_owner_role_id uuid;
  v_elos_created boolean := false;
begin
  select u.id into v_platform_user_id
  from auth.users u
  where md5(lower(coalesce(u.email, ''))) = 'c055d77c475516b18ca9f396b630978b'
    and u.email_confirmed_at is not null
  limit 1;

  if v_platform_user_id is null then
    raise exception '0083: conta do administrador da Elos não encontrada ou não confirmada.';
  end if;

  select u.id into v_bossa_user_id
  from auth.users u
  where md5(lower(coalesce(u.email, ''))) = 'd5dd8a3bee2e6ccae6954d8b066d2c61'
    and u.email_confirmed_at is not null
  limit 1;

  if v_bossa_user_id is null then
    raise exception '0083: conta do proprietário da Bossa não encontrada ou não confirmada.';
  end if;

  select c.id into v_bossa_company_id
  from public.companies c
  where c.slug = 'bossa'
  order by c.created_at asc
  limit 1;

  if v_bossa_company_id is null then
    raise exception '0083: ambiente da Bossa não encontrado.';
  end if;

  insert into public.profiles(id,email,full_name)
  select u.id, coalesce(u.email,''),
         coalesce(u.raw_user_meta_data->>'full_name', split_part(coalesce(u.email,''),'@',1))
  from auth.users u
  where u.id in (v_platform_user_id, v_bossa_user_id)
  on conflict(id) do update set email=excluded.email, updated_at=now();

  -- O usuário pessoal é o administrador global da plataforma.
  insert into public.platform_admins(user_id,status,note,created_by)
  values(v_platform_user_id,'active',
         'Administrador global da plataforma e proprietário do ambiente Elos Engenharia.',
         v_platform_user_id)
  on conflict(user_id) do update set
    status='active', note=excluded.note, updated_at=now();

  -- O usuário corporativo permanece somente no contexto da Bossa.
  update public.platform_admins
  set status='inactive',
      note='Acesso global transferido; permanece proprietário da Bossa.',
      updated_at=now()
  where user_id=v_bossa_user_id
    and v_bossa_user_id<>v_platform_user_id;

  select r.id into v_bossa_owner_role_id
  from public.roles r
  where r.company_id=v_bossa_company_id and r.key='owner' and r.status='active'
  limit 1;

  if v_bossa_owner_role_id is null then
    raise exception '0083: papel Proprietário da Bossa não encontrado.';
  end if;

  insert into public.company_memberships(company_id,user_id,role_id,status)
  values(v_bossa_company_id,v_bossa_user_id,v_bossa_owner_role_id,'active')
  on conflict(company_id,user_id) do update set
    role_id=excluded.role_id, status='active', updated_at=now();

  update public.company_memberships
  set status='suspended', updated_at=now()
  where company_id=v_bossa_company_id
    and user_id=v_platform_user_id
    and v_platform_user_id<>v_bossa_user_id;

  delete from public.project_memberships pm
  using public.projects p
  where pm.project_id=p.id
    and p.company_id=v_bossa_company_id
    and pm.user_id=v_platform_user_id
    and v_platform_user_id<>v_bossa_user_id;

  -- Reutiliza a empresa Elos Engenharia se ela já existir.
  select c.id into v_elos_company_id
  from public.companies c
  where c.slug in ('elos-engenharia','elos')
     or lower(trim(c.name))='elos engenharia'
  order by case when c.slug='elos-engenharia' then 0 else 1 end, c.created_at asc
  limit 1;

  if v_elos_company_id is null then
    insert into public.companies(name,slug,status,created_by)
    values('Elos Engenharia','elos-engenharia','active',v_platform_user_id)
    returning id into v_elos_company_id;
    v_elos_created := true;
  else
    update public.companies
    set name='Elos Engenharia', status='active', updated_at=now()
    where id=v_elos_company_id;
  end if;

  -- Replica os papéis de sistema da Bossa para manter o modelo padrão do Elos OS.
  insert into public.roles(company_id,key,name,description,is_system,status,created_by,updated_by)
  select v_elos_company_id, source.key, source.name, source.description, true, 'active',
         v_platform_user_id, v_platform_user_id
  from public.roles source
  where source.company_id=v_bossa_company_id
    and source.is_system=true
    and source.status='active'
  on conflict(company_id,key) do update set
    name=excluded.name,
    description=excluded.description,
    is_system=true,
    status='active',
    updated_by=excluded.updated_by,
    updated_at=now();

  -- Garante os papéis mínimos mesmo se o template estiver incompleto.
  insert into public.roles(company_id,key,name,description,is_system,status,created_by,updated_by) values
    (v_elos_company_id,'owner','Proprietário','Acesso total e responsabilidade pela empresa.',true,'active',v_platform_user_id,v_platform_user_id),
    (v_elos_company_id,'admin','Administrador','Gerencia empresa, usuários, papéis e módulos.',true,'active',v_platform_user_id,v_platform_user_id),
    (v_elos_company_id,'director','Diretoria','Visão ampla de gestão, obras, financeiro e comercial.',true,'active',v_platform_user_id,v_platform_user_id),
    (v_elos_company_id,'engineering','Engenharia','Execução, qualidade, planejamento e documentos.',true,'active',v_platform_user_id,v_platform_user_id),
    (v_elos_company_id,'finance','Financeiro','Contas, fluxo financeiro e documentos financeiros.',true,'active',v_platform_user_id,v_platform_user_id),
    (v_elos_company_id,'commercial','Comercial','Clientes, unidades, vendas e contratos comerciais.',true,'active',v_platform_user_id,v_platform_user_id),
    (v_elos_company_id,'field','Obra','Rotinas de campo, diário, serviços e vistorias.',true,'active',v_platform_user_id,v_platform_user_id),
    (v_elos_company_id,'viewer','Consulta','Acesso somente para visualização.',true,'active',v_platform_user_id,v_platform_user_id)
  on conflict(company_id,key) do nothing;

  insert into public.role_permissions(role_id,permission_key,allowed)
  select target.id, rp.permission_key, rp.allowed
  from public.roles target
  join public.roles source
    on source.company_id=v_bossa_company_id and source.key=target.key
  join public.role_permissions rp on rp.role_id=source.id
  where target.company_id=v_elos_company_id and rp.allowed=true
  on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

  insert into public.role_permissions(role_id,permission_key,allowed)
  select r.id, p.key, true
  from public.roles r
  cross join public.permissions p
  where r.company_id=v_elos_company_id
    and r.key in ('owner','admin')
    and r.status='active'
  on conflict(role_id,permission_key) do update set allowed=true;

  select r.id into v_elos_owner_role_id
  from public.roles r
  where r.company_id=v_elos_company_id and r.key='owner' and r.status='active'
  limit 1;

  if v_elos_owner_role_id is null then
    raise exception '0083: papel Proprietário da Elos não encontrado.';
  end if;

  insert into public.company_memberships(company_id,user_id,role_id,status)
  values(v_elos_company_id,v_platform_user_id,v_elos_owner_role_id,'active')
  on conflict(company_id,user_id) do update set
    role_id=excluded.role_id, status='active', updated_at=now();

  update public.company_memberships
  set status='suspended', updated_at=now()
  where company_id=v_elos_company_id
    and user_id=v_bossa_user_id
    and v_platform_user_id<>v_bossa_user_id;

  delete from public.project_memberships pm
  using public.projects p
  where pm.project_id=p.id
    and p.company_id=v_elos_company_id
    and pm.user_id=v_bossa_user_id
    and v_platform_user_id<>v_bossa_user_id;

  if v_elos_created then
    insert into public.platform_environment_audit(
      company_id,company_name,company_slug,owner_user_id,owner_email,
      project_id,project_name,action,details,changed_by
    )
    select v_elos_company_id,'Elos Engenharia','elos-engenharia',v_platform_user_id,
           coalesce(u.email,''),null,null,'environment_created',
           jsonb_build_object('purpose','orcamentos_elos','source','migration_0083'),
           v_platform_user_id
    from auth.users u where u.id=v_platform_user_id;
  end if;
end $$;

commit;
