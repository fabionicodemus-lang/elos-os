-- Prova que execution_daily_log_indicators devolve os mesmos números que o
-- painel calculava em memória (DailyLogIndicators, daily-log-views.tsx).
--
-- Roda como usuário `authenticated` com auth.uid() simulado, para exercitar a
-- RLS e a verificação de permissão do mesmo jeito que a aplicação faz.
--
-- Uso: psql -d <banco> -v ON_ERROR_STOP=1 -f este-arquivo.sql

begin;

do $$
declare
  v_company uuid := '11111111-1111-1111-1111-111111111111';
  v_project uuid := '22222222-2222-2222-2222-222222222222';
  v_user    uuid := '33333333-3333-3333-3333-333333333333';
  v_role    uuid;
  v_approved uuid := '44444444-0000-0000-0000-000000000001';
  v_submitted uuid := '44444444-0000-0000-0000-000000000002';
  v_cancelled uuid := '44444444-0000-0000-0000-000000000003';
  v_result jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at)
    values (v_user, 'teste-indicadores@elos.local', now());

  insert into public.companies(id, name, slug, status, created_by)
    values (v_company, 'Empresa de Teste', 'empresa-teste', 'active', v_user);

  -- Papéis são por empresa e criados pela aplicação, não por trigger. O teste
  -- concede apenas a permissão de leitura do diário, para provar que é ela que
  -- libera o indicador.
  insert into public.roles(company_id, key, name, is_system, created_by)
    values (v_company, 'owner', 'Proprietário', true, v_user)
    returning id into v_role;

  insert into public.role_permissions(role_id, permission_key, allowed)
    values (v_role, 'execution.daily_logs.view', true);

  insert into public.company_memberships(company_id, user_id, role_id, status)
    values (v_company, v_user, v_role, 'active');

  insert into public.projects(id, company_id, name, code, status, created_by)
    values (v_project, v_company, 'Obra de Teste', 'TST-001', 'active', v_user);

  -- Dois diários válidos e um cancelado. O cancelado recebe filhos de propósito:
  -- se ele vazar para as somas, o teste falha.
  insert into public.execution_daily_logs(
    id, company_id, project_id, log_date, log_number, responsible_user_id,
    responsible_name, created_by, is_current, status
  ) values
    (v_approved,  v_company, v_project, date '2026-08-01', 'DO-001', v_user, 'Responsável', v_user, true, 'approved'),
    (v_submitted, v_company, v_project, date '2026-08-02', 'DO-002', v_user, 'Responsável', v_user, true, 'awaiting_approval'),
    (v_cancelled, v_company, v_project, date '2026-08-03', 'DO-003', v_user, 'Responsável', v_user, true, 'cancelled');

  insert into public.execution_daily_log_weather(company_id, project_id, daily_log_id, period, condition, stopped_hours) values
    (v_company, v_project, v_approved,  'morning', 'rain',  0),
    (v_company, v_project, v_submitted, 'morning', 'sunny', 3),
    (v_company, v_project, v_cancelled, 'morning', 'storm', 5);

  insert into public.execution_daily_log_occurrences(company_id, project_id, daily_log_id, occurrence_type, title, description) values
    (v_company, v_project, v_approved,  'stoppage', 'Parada', 'Parada de teste'),
    (v_company, v_project, v_submitted, 'incident', 'Incidente', 'Evento de teste'),
    (v_company, v_project, v_cancelled, 'stoppage', 'Ignorar', 'Não deve contar');

  insert into public.execution_daily_log_photos(company_id, project_id, daily_log_id, storage_path, file_name) values
    (v_company, v_project, v_approved,  'a/1.jpg', '1.jpg'),
    (v_company, v_project, v_approved,  'a/2.jpg', '2.jpg'),
    (v_company, v_project, v_submitted, 'b/1.jpg', '1.jpg'),
    (v_company, v_project, v_cancelled, 'c/1.jpg', '1.jpg');

  insert into public.execution_daily_log_workforce(company_id, project_id, daily_log_id, company_name, role_name, worker_count) values
    (v_company, v_project, v_approved,  'Construtora', 'Pedreiro', 10),
    (v_company, v_project, v_submitted, 'Construtora', 'Pedreiro', 20),
    (v_company, v_project, v_cancelled, 'Construtora', 'Pedreiro', 99);

  insert into public.execution_daily_log_services(company_id, project_id, daily_log_id, service_code, service_name) values
    (v_company, v_project, v_approved,  'S1', 'Alvenaria'),
    (v_company, v_project, v_submitted, 'S1', 'Alvenaria'),
    (v_company, v_project, v_submitted, 'S2', 'Pintura'),
    (v_company, v_project, v_cancelled, 'S3', 'Ignorar');

  -- A partir daqui, o mesmo contexto que o PostgREST monta para a aplicação.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  set local role authenticated;

  v_result := public.execution_daily_log_indicators(v_company, v_project);

  reset role;

  -- Valores conferidos contra DailyLogIndicators: dois diários válidos, um
  -- aprovado, um dia de chuva, dois dias parados (chuva/parada e horas paradas),
  -- três fotos e média de 15 trabalhadores por dia.
  if (v_result->>'valid_count')::int <> 2 then
    raise exception 'valid_count esperado 2, obtido %', v_result->>'valid_count';
  end if;
  if (v_result->>'approved_count')::int <> 1 then
    raise exception 'approved_count esperado 1, obtido %', v_result->>'approved_count';
  end if;
  if (v_result->>'rain_count')::int <> 1 then
    raise exception 'rain_count esperado 1, obtido %', v_result->>'rain_count';
  end if;
  if (v_result->>'stopped_count')::int <> 2 then
    raise exception 'stopped_count esperado 2, obtido %', v_result->>'stopped_count';
  end if;
  if (v_result->>'photo_count')::int <> 3 then
    raise exception 'photo_count esperado 3, obtido %', v_result->>'photo_count';
  end if;
  if (v_result->>'average_workers')::numeric <> 15 then
    raise exception 'average_workers esperado 15, obtido %', v_result->>'average_workers';
  end if;
  if v_result->'top_services'->0->>'name' <> 'Alvenaria'
     or (v_result->'top_services'->0->>'count')::int <> 2 then
    raise exception 'top_services esperado Alvenaria=2, obtido %', v_result->'top_services';
  end if;
  if jsonb_array_length(v_result->'top_occurrences') <> 2 then
    raise exception 'top_occurrences esperado 2 tipos, obtido %', v_result->'top_occurrences';
  end if;

  raise notice 'OK: execution_daily_log_indicators confere com o painel em memória.';
end
$$;

-- O teste não deixa resíduo: nada é commitado.
rollback;
