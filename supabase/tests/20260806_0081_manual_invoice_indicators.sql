-- requires: shadow
-- Prova que finance_manual_invoice_indicators devolve os mesmos números que os
-- indicadores de Notas Manuais calculavam em memória.

begin;

do $$
declare
  v_company uuid := '11111111-1111-1111-1111-111111111111';
  v_project uuid := '22222222-2222-2222-2222-222222222222';
  v_user uuid := '33333333-3333-3333-3333-333333333333';
  v_supplier uuid := '55555555-5555-5555-5555-555555555555';
  v_location uuid := '66666666-0000-0000-0000-000000000001';
  v_input uuid := '66666666-0000-0000-0000-000000000002';
  v_order uuid := '66666666-0000-0000-0000-000000000003';
  v_receipt uuid := '66666666-0000-0000-0000-000000000004';
  v_role uuid;
  v_result jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at) values (v_user, 'teste-notas@elos.local', now());
  insert into public.companies(id, name, slug, status, created_by)
    values (v_company, 'Empresa de Teste', 'empresa-teste', 'active', v_user);
  insert into public.roles(company_id, key, name, is_system, created_by)
    values (v_company, 'owner', 'Proprietário', true, v_user) returning id into v_role;
  insert into public.role_permissions(role_id, permission_key, allowed)
    values (v_role, 'finance.manual_invoices.view', true);
  insert into public.company_memberships(company_id, user_id, role_id, status)
    values (v_company, v_user, v_role, 'active');
  insert into public.projects(id, company_id, name, code, status, created_by)
    values (v_project, v_company, 'Obra de Teste', 'TST-001', 'active', v_user);
  insert into public.suppliers(id, company_id, legal_name, status, created_by)
    values (v_supplier, v_company, 'Fornecedor', 'active', v_user);

  -- Um recebimento real para a nota vinculada apontar.
  insert into public.procurement_purchase_orders(company_id, project_id, supplier_id, sequence_no, order_number, created_by, id)
    values (v_company, v_project, v_supplier, 1, 'PC-001', v_user, v_order);
  insert into public.procurement_material_receipts(id, company_id, project_id, order_id, supplier_id, sequence_no, receipt_number, receipt_date, created_by)
    values (v_receipt, v_company, v_project, v_order, v_supplier, 1, 'RC-001', current_date, v_user);

  -- Quatro notas: duas lançadas (uma delas vinculada a recebimento), uma em
  -- rascunho e uma cancelada com valores altos de propósito.
  insert into public.finance_manual_invoices(
    company_id, project_id, supplier_id, sequence_no, registry_number,
    document_type, document_number, issue_date, status,
    net_amount, total_retention_amount, material_receipt_id, cancellation_reason
  ) values
    (v_company, v_project, v_supplier, 1, 'NM-001', 'service_invoice', 'D-001', current_date, 'approved', 1000, 100, null, null),
    (v_company, v_project, v_supplier, 2, 'NM-002', 'service_invoice', 'D-002', current_date, 'approved', 2000, 200, v_receipt, null),
    (v_company, v_project, v_supplier, 3, 'NM-003', 'service_invoice', 'D-003', current_date, 'draft',     500,  50, null, null),
    (v_company, v_project, v_supplier, 4, 'NM-004', 'service_invoice', 'D-004', current_date, 'cancelled', 9999, 999, null, 'Cancelada no teste');

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  set local role authenticated;
  v_result := public.finance_manual_invoice_indicators(v_company, v_project);
  reset role;

  if (v_result->>'invoice_count')::int <> 4 then
    raise exception 'invoice_count esperado 4, obtido %', v_result->>'invoice_count';
  end if;
  if (v_result->>'active_count')::int <> 3 then
    raise exception 'active_count esperado 3, obtido %', v_result->>'active_count';
  end if;
  if (v_result->>'posted_count')::int <> 2 then
    raise exception 'posted_count esperado 2, obtido %', v_result->>'posted_count';
  end if;
  -- Valores somam só as lançadas: o rascunho e a cancelada ficam de fora.
  if (v_result->>'net_total')::numeric <> 3000 then
    raise exception 'net_total esperado 3000, obtido %', v_result->>'net_total';
  end if;
  if (v_result->>'retention_total')::numeric <> 300 then
    raise exception 'retention_total esperado 300, obtido %', v_result->>'retention_total';
  end if;
  if (v_result->>'with_receipt_count')::int <> 1 then
    raise exception 'with_receipt_count esperado 1, obtido %', v_result->>'with_receipt_count';
  end if;

  raise notice 'OK: finance_manual_invoice_indicators confere com o painel.';
end
$$;

rollback;
