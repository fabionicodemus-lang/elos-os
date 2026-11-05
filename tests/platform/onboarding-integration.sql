-- Elos OS: teste transacional do onboarding global em um banco isolado.
-- Execute APENAS em homologacao com as migrations 0001, 0056, 0061 e as duas de 20261105 aplicadas.
-- Todos os usuarios e vinculos ficticios sao descartados ao final.
begin;

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001', 'qa-platform-admin@elos-invalid.example', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000002', 'qa-owner-a@elos-invalid.example', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000003', 'qa-owner-b@elos-invalid.example', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000004', 'qa-engineer@elos-invalid.example', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000005', 'qa-outsider@elos-invalid.example', now(), now(), now());

insert into public.platform_admins (user_id, status, note)
values ('10000000-0000-4000-8000-000000000001', 'active', 'Teste isolado de homologacao');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

do $$
declare
  v_company_a uuid;
  v_company_b uuid;
  v_project_a uuid;
  v_count integer;
  v_rejected boolean;
  v_membership_id uuid;
  v_lookup jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'FALHA: administrador global nao reconhecido';
  end if;

  v_lookup := public.platform_lookup_user('qa-owner-a@elos-invalid.example');
  if v_lookup ->> 'exists' <> 'true' or v_lookup ->> 'confirmed' <> 'true' then
    raise exception 'FALHA: consulta de conta confirmada';
  end if;

  select (result ->> 'company_id')::uuid, (result ->> 'project_id')::uuid
  into v_company_a, v_project_a
  from (select public.platform_create_environment(
    'Construtora QA A', 'bossa', 'qa-owner-a@elos-invalid.example', 'Obra QA A', 'QA-A'
  ) as result) x;
  if v_company_a is null or v_project_a is null then
    raise exception 'FALHA: criacao de empresa e primeira obra';
  end if;

  select (public.platform_create_environment(
    'Construtora QA B', 'qa-b', 'qa-owner-b@elos-invalid.example', null, null
  ) ->> 'company_id')::uuid into v_company_b;
  if v_company_b is null or v_company_b = v_company_a then
    raise exception 'FALHA: empresas nao isoladas';
  end if;

  select count(*) into v_count
  from public.platform_list_environments() env
  where env.company_id in (v_company_a, v_company_b);
  if v_count <> 2 then
    raise exception 'FALHA: listagem global de empresas esperava 2 e recebeu %', v_count;
  end if;

  select count(*) into v_count
  from public.platform_list_company_members(v_company_a, 25, 0) member
  where member.email = 'qa-owner-a@elos-invalid.example'
    and member.role_key = 'owner';
  if v_count <> 1 then
    raise exception 'FALHA: primeiro proprietario nao vinculado';
  end if;

  v_membership_id := public.platform_add_company_member(
    v_company_a, 'qa-engineer@elos-invalid.example', 'engineering'
  );
  if v_membership_id is null then
    raise exception 'FALHA: inclusao de colaborador';
  end if;

  select count(*) into v_count from public.platform_membership_audit
  where company_id = v_company_a and target_email = 'qa-engineer@elos-invalid.example';
  if v_count <> 1 then
    raise exception 'FALHA: auditoria de concessao ausente';
  end if;

  v_rejected := false;
  begin
    perform public.platform_add_company_member(
      v_company_a, 'qa-outsider@elos-invalid.example', 'owner'
    );
  exception when others then
    if position('Proprietario' in translate(sqlerrm, 'á', 'a')) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then
    raise exception 'FALHA: concessao adicional de proprietario nao bloqueada';
  end if;

  select count(*) into v_count from public.platform_list_company_members(v_company_a, 25, 0);
  if v_count <> 2 then
    raise exception 'FALHA: listagem de membros esperava 2 e recebeu %', v_count;
  end if;

  -- Um colaborador comum jamais pode usar RPCs globais ou ler outra empresa.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
  if public.is_platform_admin() then
    raise exception 'FALHA: colaborador recebeu poder global';
  end if;

  v_rejected := false;
  begin
    perform public.platform_lookup_user('qa-owner-b@elos-invalid.example');
  exception when others then
    if position('restrita' in sqlerrm) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then
    raise exception 'FALHA: consulta global liberada ao colaborador';
  end if;

  v_rejected := false;
  begin
    perform public.platform_list_environments();
  exception when others then
    if position('restrita' in sqlerrm) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then
    raise exception 'FALHA: listagem global liberada ao colaborador';
  end if;

  v_rejected := false;
  begin
    perform public.platform_list_company_members(v_company_b, 25, 0);
  exception when others then
    if position('restrita' in sqlerrm) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then
    raise exception 'FALHA: lista de membros da outra empresa exposta';
  end if;

  select count(*) into v_count from public.companies where id = v_company_b;
  if v_count <> 0 then
    raise exception 'FALHA: RLS permitiu ler outra construtora';
  end if;

  select count(*) into v_count from public.platform_membership_audit;
  if v_count <> 0 then
    raise exception 'FALHA: auditoria global visivel ao colaborador';
  end if;

  -- Um proprietario de uma construtora nao vira administrador da plataforma.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
  if public.is_platform_admin() then
    raise exception 'FALHA: proprietario promovido indevidamente';
  end if;
  v_rejected := false;
  begin
    perform public.platform_create_environment(
      'Invasao QA', 'qa-invasao', 'qa-outsider@elos-invalid.example', null, null
    );
  exception when others then
    if position('restrita' in sqlerrm) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then
    raise exception 'FALHA: proprietario criou construtora sem autorizacao';
  end if;
end;
$$;

rollback;

select 'APROVADO: empresa, obra, membros, auditoria e isolamento; nenhuma fixture persistida' as resultado;
