-- requires: shadow
-- Prova que execution_measurement_indicators devolve os mesmos números que o
-- bloco measurement-kpis calculava em memória (app/execucao/medicoes-contratos).

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
  v_role uuid;
  v_result jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at)
    values (v_user, 'teste-medicoes@elos.local', now());

  insert into public.companies(id, name, slug, status, created_by)
    values (v_company, 'Empresa de Teste', 'empresa-teste', 'active', v_user);

  insert into public.roles(company_id, key, name, is_system, created_by)
    values (v_company, 'owner', 'Proprietário', true, v_user)
    returning id into v_role;

  insert into public.role_permissions(role_id, permission_key, allowed)
    values (v_role, 'execution.measurements.view', true);

  insert into public.company_memberships(company_id, user_id, role_id, status)
    values (v_company, v_user, v_role, 'active');

  insert into public.projects(id, company_id, name, code, status, created_by)
    values (v_project, v_company, 'Obra de Teste', 'TST-001', 'active', v_user);

  insert into public.suppliers(id, company_id, legal_name, status, created_by)
    values (v_supplier, v_company, 'Prestador', 'active', v_user);

  insert into public.execution_service_requests(id, company_id, project_id, sequence_no, request_number, title, scope_summary, created_by)
    values (v_request, v_company, v_project, 1, 'SS-001', 'Solicitação', 'Escopo', v_user);
  insert into public.execution_service_competitions(id, company_id, project_id, request_id, sequence_no, competition_number, title, created_by)
    values (v_competition, v_company, v_project, v_request, 1, 'MC-001', 'Concorrência', v_user);
  insert into public.execution_service_contracts(
    id, company_id, project_id, supplier_id, sequence_no, contract_number,
    title, scope_summary, start_date, end_date, created_by, source_competition_id
  ) values (
    v_contract, v_company, v_project, v_supplier, 1, 'CT-001', 'Contrato', 'Escopo',
    date '2026-01-01', date '2026-12-31', v_user, v_competition
  );

  -- Quatro medições. A em elaboração não entra em nenhum valor; a paga entra
  -- em aprovado, em financeiro e em pago ao mesmo tempo.
  insert into public.execution_contract_measurements(
    company_id, project_id, contract_id, supplier_id, sequence_no, measurement_number,
    period_start, period_end, created_by, status, gross_amount, net_amount, paid_amount
  ) values
    (v_company, v_project, v_contract, v_supplier, 1, 'MED-001', date '2026-02-01', date '2026-02-28', v_user, 'draft',     1000,  900,   0),
    (v_company, v_project, v_contract, v_supplier, 2, 'MED-002', date '2026-03-01', date '2026-03-31', v_user, 'submitted', 2000, 1800,   0),
    (v_company, v_project, v_contract, v_supplier, 3, 'MED-003', date '2026-04-01', date '2026-04-30', v_user, 'approved',  3000, 2700,   0),
    (v_company, v_project, v_contract, v_supplier, 4, 'MED-004', date '2026-05-01', date '2026-05-31', v_user, 'paid',      4000, 3600, 3500);

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  set local role authenticated;

  v_result := public.execution_measurement_indicators(v_company, v_project);

  reset role;

  if (v_result->>'measurement_count')::int <> 4 then
    raise exception 'measurement_count esperado 4, obtido %', v_result->>'measurement_count';
  end if;
  if (v_result->>'submitted_count')::int <> 1 then
    raise exception 'submitted_count esperado 1, obtido %', v_result->>'submitted_count';
  end if;
  -- Aprovado soma a aprovada e a paga: 3000 + 4000.
  if (v_result->>'gross_approved')::numeric <> 7000 then
    raise exception 'gross_approved esperado 7000, obtido %', v_result->>'gross_approved';
  end if;
  if (v_result->>'net_approved')::numeric <> 6300 then
    raise exception 'net_approved esperado 6300, obtido %', v_result->>'net_approved';
  end if;
  -- No financeiro só a paga (não há faturada neste cenário).
  if (v_result->>'in_finance')::numeric <> 3600 then
    raise exception 'in_finance esperado 3600, obtido %', v_result->>'in_finance';
  end if;
  if (v_result->>'paid_total')::numeric <> 3500 then
    raise exception 'paid_total esperado 3500, obtido %', v_result->>'paid_total';
  end if;

  raise notice 'OK: execution_measurement_indicators confere com o painel em memória.';
end
$$;

rollback;
