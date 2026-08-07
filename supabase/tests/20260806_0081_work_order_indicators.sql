-- requires: shadow
-- Prova que execution_work_order_indicators devolve os mesmos números que o
-- bloco work-order-kpis calculava em memória (app/execucao/ordens-servico).
--
-- Roda como usuário `authenticated` com auth.uid() simulado, para exercitar a
-- RLS e a verificação de permissão do mesmo jeito que a aplicação faz.

begin;

do $$
declare
  v_company uuid := '11111111-1111-1111-1111-111111111111';
  v_project uuid := '22222222-2222-2222-2222-222222222222';
  v_user    uuid := '33333333-3333-3333-3333-333333333333';
  v_supplier uuid := '55555555-5555-5555-5555-555555555555';
  v_contract uuid := '66666666-6666-6666-6666-666666666666';
  v_request uuid := '77777777-7777-7777-7777-777777777777';
  v_competition uuid := '88888888-8888-8888-8888-888888888888';
  v_role    uuid;
  v_result  jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at)
    values (v_user, 'teste-os@elos.local', now());

  insert into public.companies(id, name, slug, status, created_by)
    values (v_company, 'Empresa de Teste', 'empresa-teste', 'active', v_user);

  insert into public.roles(company_id, key, name, is_system, created_by)
    values (v_company, 'owner', 'Proprietário', true, v_user)
    returning id into v_role;

  insert into public.role_permissions(role_id, permission_key, allowed)
    values (v_role, 'execution.work_orders.view', true);

  insert into public.company_memberships(company_id, user_id, role_id, status)
    values (v_company, v_user, v_role, 'active');

  insert into public.projects(id, company_id, name, code, status, created_by)
    values (v_project, v_company, 'Obra de Teste', 'TST-001', 'active', v_user);

  insert into public.suppliers(id, company_id, legal_name, status, created_by)
    values (v_supplier, v_company, 'Prestador de Teste', 'active', v_user);

  -- Um trigger exige que todo contrato nasça de uma concorrência, que por sua
  -- vez nasce de uma solicitação. A cadeia mínima é criada aqui só para que a
  -- ordem de serviço tenha um contrato válido para apontar.
  insert into public.execution_service_requests(
    id, company_id, project_id, sequence_no, request_number, title, scope_summary, created_by
  ) values (
    v_request, v_company, v_project, 1, 'SS-001', 'Solicitação', 'Escopo', v_user
  );

  insert into public.execution_service_competitions(
    id, company_id, project_id, request_id, sequence_no, competition_number, title, created_by
  ) values (
    v_competition, v_company, v_project, v_request, 1, 'MC-001', 'Concorrência', v_user
  );

  insert into public.execution_service_contracts(
    id, company_id, project_id, supplier_id, sequence_no, contract_number,
    title, scope_summary, start_date, end_date, created_by, source_competition_id
  ) values (
    v_contract, v_company, v_project, v_supplier, 1, 'CT-001',
    'Contrato', 'Escopo', date '2026-01-01', date '2026-12-31', v_user, v_competition
  );

  -- Quatro ordens: duas ativas, uma finalizada e uma cancelada. A cancelada
  -- carrega valores altos de propósito: se entrar nas somas, o teste falha.
  insert into public.execution_work_orders(
    company_id, project_id, contract_id, supplier_id, sequence_no,
    work_order_number, title, scope_summary, planned_start, planned_finish,
    created_by, status, authorized_value, executed_value, cancellation_reason
  ) values
    (v_company, v_project, v_contract, v_supplier, 1, 'OS-001', 'A', 'Escopo', date '2026-02-01', date '2026-02-28', v_user, 'in_progress',        1000, 400, null),
    (v_company, v_project, v_contract, v_supplier, 2, 'OS-002', 'B', 'Escopo', date '2026-03-01', date '2026-03-31', v_user, 'pending_acceptance', 2000, 1500, null),
    (v_company, v_project, v_contract, v_supplier, 3, 'OS-003', 'C', 'Escopo', date '2026-04-01', date '2026-04-30', v_user, 'finished',            500, 500, null),
    (v_company, v_project, v_contract, v_supplier, 4, 'OS-004', 'D', 'Escopo', date '2026-05-01', date '2026-05-31', v_user, 'cancelled',          9999, 9999, 'Cancelada no teste');

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  set local role authenticated;

  v_result := public.execution_work_order_indicators(v_company, v_project);

  reset role;

  -- Conferidos contra work-order-kpis: quatro ordens no total, duas ativas
  -- (in_progress e pending_acceptance), uma aguardando aceite, e os valores
  -- somando apenas as três não canceladas.
  if (v_result->>'order_count')::int <> 4 then
    raise exception 'order_count esperado 4, obtido %', v_result->>'order_count';
  end if;
  if (v_result->>'active_count')::int <> 2 then
    raise exception 'active_count esperado 2, obtido %', v_result->>'active_count';
  end if;
  if (v_result->>'pending_acceptance_count')::int <> 1 then
    raise exception 'pending_acceptance_count esperado 1, obtido %', v_result->>'pending_acceptance_count';
  end if;
  if (v_result->>'authorized_total')::numeric <> 3500 then
    raise exception 'authorized_total esperado 3500, obtido %', v_result->>'authorized_total';
  end if;
  if (v_result->>'executed_total')::numeric <> 2400 then
    raise exception 'executed_total esperado 2400, obtido %', v_result->>'executed_total';
  end if;

  raise notice 'OK: execution_work_order_indicators confere com o painel em memória.';
end
$$;

rollback;
