-- requires: shadow
-- Prova que quality_indicators devolve os mesmos números que a aba Indicadores
-- calculava em memória (app/execucao/qualidade/page.tsx, componente Indicators).
--
-- Roda como usuário `authenticated` com auth.uid() simulado, para exercitar a
-- RLS e a verificação de permissão do mesmo jeito que a aplicação faz.

begin;

do $$
declare
  v_company uuid := '11111111-1111-1111-1111-111111111111';
  v_project uuid := '22222222-2222-2222-2222-222222222222';
  v_user    uuid := '33333333-3333-3333-3333-333333333333';
  v_service_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_service_b uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  v_template uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  v_version uuid := 'cccccccc-0000-0000-0000-000000000001';
  v_criterion uuid := 'dddddddd-0000-0000-0000-000000000001';
  v_criterion2 uuid := 'dddddddd-0000-0000-0000-000000000002';
  v_criterion3 uuid := 'dddddddd-0000-0000-0000-000000000003';
  v_insp_90 uuid := 'eeeeeeee-0000-0000-0000-000000000001';
  v_insp_70 uuid := 'eeeeeeee-0000-0000-0000-000000000002';
  v_insp_open uuid := 'eeeeeeee-0000-0000-0000-000000000003';
  v_item uuid := 'ffffffff-0000-0000-0000-000000000001';
  v_item2 uuid := 'ffffffff-0000-0000-0000-000000000002';
  v_item3 uuid := 'ffffffff-0000-0000-0000-000000000003';
  v_role uuid;
  v_result jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at)
    values (v_user, 'teste-qualidade@elos.local', now());

  insert into public.companies(id, name, slug, status, created_by)
    values (v_company, 'Empresa de Teste', 'empresa-teste', 'active', v_user);

  insert into public.roles(company_id, key, name, is_system, created_by)
    values (v_company, 'owner', 'Proprietário', true, v_user)
    returning id into v_role;

  insert into public.role_permissions(role_id, permission_key, allowed)
    values (v_role, 'execution.quality.indicators', true);

  insert into public.company_memberships(company_id, user_id, role_id, status)
    values (v_company, v_user, v_role, 'active');

  insert into public.projects(id, company_id, name, code, status, created_by)
    values (v_project, v_company, 'Obra de Teste', 'TST-001', 'active', v_user);

  insert into public.engineering_services(id, company_id, code, description, unit, created_by) values
    (v_service_a, v_company, 'SVC-A', 'Alvenaria', 'm2', v_user),
    (v_service_b, v_company, 'SVC-B', 'Pintura', 'm2', v_user);

  insert into public.quality_checklist_templates(id, company_id, code, name, service_id, created_by)
    values (v_template, v_company, 'TPL-1', 'Modelo', v_service_a, v_user);

  insert into public.quality_checklist_versions(id, company_id, template_id, version_no, created_by)
    values (v_version, v_company, v_template, 1, v_user);

  insert into public.quality_checklist_criteria(id, company_id, version_id, code, description) values
    (v_criterion,  v_company, v_version, 'C1', 'Critério 1'),
    (v_criterion2, v_company, v_version, 'C2', 'Critério 2'),
    (v_criterion3, v_company, v_version, 'C3', 'Critério 3');

  -- Três inspeções: duas com nota (90 e 70) e uma ainda sem nota e bloqueada.
  -- A sem nota entra apenas na cobertura, nunca na média.
  insert into public.quality_inspections(
    id, company_id, project_id, template_id, checklist_version_id, service_id,
    stage_name, responsible_engineer_user_id, inspection_number, due_date,
    first_inspection_score, release_status
  ) values
    (v_insp_90,   v_company, v_project, v_template, v_version, v_service_a, 'Etapa 1', v_user, 'INS-001', date '2026-08-01', 90, 'released'),
    (v_insp_70,   v_company, v_project, v_template, v_version, v_service_b, 'Etapa 2', v_user, 'INS-002', date '2026-08-02', 70, 'released'),
    (v_insp_open, v_company, v_project, v_template, v_version, v_service_a, 'Etapa 3', v_user, 'INS-003', date '2026-08-03', null, 'blocked');

  insert into public.quality_inspection_items(
    id, company_id, project_id, inspection_id, criterion_id, group_name_snapshot,
    code_snapshot, description_snapshot, weight_snapshot, failure_severity_snapshot,
    is_blocking_snapshot, requires_photo_snapshot, requires_measurement_snapshot,
    allow_reservation_snapshot, is_required_snapshot
  ) values
    (v_item,  v_company, v_project, v_insp_90, v_criterion,  'Grupo', 'C1', 'Critério 1', 1, 'light', false, false, false, false, true),
    (v_item2, v_company, v_project, v_insp_90, v_criterion2, 'Grupo', 'C2', 'Critério 2', 1, 'light', false, false, false, false, true),
    (v_item3, v_company, v_project, v_insp_90, v_criterion3, 'Grupo', 'C3', 'Critério 3', 1, 'light', false, false, false, false, true);

  -- Três NCs: uma fechada no prazo, uma fechada com atraso e uma aberta.
  insert into public.quality_nonconformities(
    company_id, project_id, inspection_id, inspection_item_id, service_id,
    nc_number, description, severity, due_at, status, closed_at
  ) values
    (v_company, v_project, v_insp_90, v_item, v_service_a, 'NC-001', 'No prazo', 'light',
     timestamptz '2026-08-10 12:00+00', 'closed', timestamptz '2026-08-09 12:00+00'),
    (v_company, v_project, v_insp_90, v_item2, v_service_a, 'NC-002', 'Atrasada', 'serious',
     timestamptz '2026-08-10 12:00+00', 'closed', timestamptz '2026-08-12 12:00+00'),
    (v_company, v_project, v_insp_90, v_item3, v_service_a, 'NC-003', 'Aberta', 'critical',
     timestamptz '2026-08-20 12:00+00', 'open', null);

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  set local role authenticated;

  v_result := public.quality_indicators(v_company, v_project);

  reset role;

  -- Conferidos contra o componente Indicators.
  if (v_result->>'inspection_count')::int <> 3 then
    raise exception 'inspection_count esperado 3, obtido %', v_result->>'inspection_count';
  end if;
  if (v_result->>'completed_count')::int <> 2 then
    raise exception 'completed_count esperado 2, obtido %', v_result->>'completed_count';
  end if;
  if (v_result->>'average_score')::numeric <> 80 then
    raise exception 'average_score esperado 80, obtido %', v_result->>'average_score';
  end if;
  if (v_result->>'first_pass_count')::int <> 1 then
    raise exception 'first_pass_count esperado 1 (só a nota 90), obtido %', v_result->>'first_pass_count';
  end if;
  if (v_result->>'open_nc_count')::int <> 1 then
    raise exception 'open_nc_count esperado 1, obtido %', v_result->>'open_nc_count';
  end if;
  if (v_result->>'closed_nc_count')::int <> 2 then
    raise exception 'closed_nc_count esperado 2, obtido %', v_result->>'closed_nc_count';
  end if;
  if (v_result->>'on_time_nc_count')::int <> 1 then
    raise exception 'on_time_nc_count esperado 1, obtido %', v_result->>'on_time_nc_count';
  end if;
  if (v_result->>'blocked_count')::int <> 1 then
    raise exception 'blocked_count esperado 1, obtido %', v_result->>'blocked_count';
  end if;
  if jsonb_array_length(v_result->'score_by_service') <> 2 then
    raise exception 'score_by_service esperado 2 serviços, obtido %', v_result->'score_by_service';
  end if;
  if (v_result->'score_by_service'->0->>'average')::numeric <> 90 then
    raise exception 'score_by_service deve vir ordenado pela maior nota, obtido %', v_result->'score_by_service';
  end if;
  -- Uma NC de cada gravidade; só a crítica continua aberta.
  if (v_result->'nc_by_severity'->'critical'->>'total')::int <> 1
     or (v_result->'nc_by_severity'->'serious'->>'total')::int <> 1
     or (v_result->'nc_by_severity'->'light'->>'total')::int <> 1 then
    raise exception 'nc_by_severity esperado 1 de cada, obtido %', v_result->'nc_by_severity';
  end if;
  if (v_result->'nc_by_severity'->'critical'->>'open')::int <> 1
     or (v_result->'nc_by_severity'->'serious'->>'open')::int <> 0
     or (v_result->'nc_by_severity'->'light'->>'open')::int <> 0 then
    raise exception 'abertas por gravidade esperado só a crítica, obtido %', v_result->'nc_by_severity';
  end if;

  raise notice 'OK: quality_indicators confere com a aba Indicadores.';
end
$$;

rollback;
