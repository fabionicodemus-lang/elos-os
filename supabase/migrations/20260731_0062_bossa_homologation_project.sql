-- Elos OS — Provisionamento controlado da obra de homologação dentro da Bossa
-- Cria apenas o empreendimento HOM-001 e vincula o usuário técnico informado.

begin;

do $$
declare
  v_company_id uuid;
  v_user_id uuid;
  v_role_id uuid;
  v_project_id uuid;
  v_existing_name text;
begin
  select id into v_company_id
  from public.companies
  where slug='bossa'
    and status='active'
  order by created_at asc
  limit 1;

  if v_company_id is null then
    raise exception 'Empresa Bossa ativa não localizada.';
  end if;

  select id into v_user_id
  from auth.users
  where lower(email)=lower('fabio@bossaempreendimentos.com.br')
    and email_confirmed_at is not null
  limit 1;

  if v_user_id is null then
    raise exception 'Usuário fabio@bossaempreendimentos.com.br não localizado ou não confirmado.';
  end if;

  select membership.role_id into v_role_id
  from public.company_memberships membership
  where membership.company_id=v_company_id
    and membership.user_id=v_user_id
    and membership.status='active'
  limit 1;

  if v_role_id is null then
    raise exception 'O usuário de homologação ainda não possui vínculo ativo com a Bossa.';
  end if;

  select project.id,project.name
    into v_project_id,v_existing_name
  from public.projects project
  where project.company_id=v_company_id
    and upper(coalesce(project.code,''))='HOM-001'
  order by project.created_at asc
  limit 1;

  if v_project_id is not null and upper(coalesce(v_existing_name,'')) not like '%[HOMOLOGAÇÃO]%' then
    raise exception 'O código HOM-001 já está sendo usado por uma obra que não está marcada como homologação.';
  end if;

  if v_project_id is null then
    insert into public.projects(
      company_id,name,code,city,state,status,created_by
    ) values(
      v_company_id,
      '[HOMOLOGAÇÃO] Residencial Aurora',
      'HOM-001',
      'Itapema',
      'SC',
      'planning',
      v_user_id
    )
    returning id into v_project_id;
  else
    update public.projects
    set name='[HOMOLOGAÇÃO] Residencial Aurora',
        status=case when status='archived' then 'planning' else status end,
        updated_at=now()
    where id=v_project_id;
  end if;

  insert into public.project_memberships(project_id,user_id,role_id)
  values(v_project_id,v_user_id,v_role_id)
  on conflict(project_id,user_id) do update set role_id=excluded.role_id;
end $$;

commit;
