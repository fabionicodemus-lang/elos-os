-- requires: shadow
-- Prova que procurement_purchase_order_indicators devolve os mesmos números que
-- o bloco purchase-order-kpis calculava em memória.

begin;

do $$
declare
  v_company uuid := '11111111-1111-1111-1111-111111111111';
  v_project uuid := '22222222-2222-2222-2222-222222222222';
  v_user uuid := '33333333-3333-3333-3333-333333333333';
  v_supplier uuid := '55555555-5555-5555-5555-555555555555';
  v_role uuid;
  v_result jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at) values (v_user, 'teste-pedidos@elos.local', now());
  insert into public.companies(id, name, slug, status, created_by)
    values (v_company, 'Empresa de Teste', 'empresa-teste', 'active', v_user);
  insert into public.roles(company_id, key, name, is_system, created_by)
    values (v_company, 'owner', 'Proprietário', true, v_user) returning id into v_role;
  insert into public.role_permissions(role_id, permission_key, allowed)
    values (v_role, 'procurement.orders.view', true);
  insert into public.company_memberships(company_id, user_id, role_id, status)
    values (v_company, v_user, v_role, 'active');
  insert into public.projects(id, company_id, name, code, status, created_by)
    values (v_project, v_company, 'Obra de Teste', 'TST-001', 'active', v_user);
  insert into public.suppliers(id, company_id, legal_name, status, created_by)
    values (v_supplier, v_company, 'Fornecedor', 'active', v_user);

  -- Cinco pedidos cobrindo cada regra:
  --   rascunho atrasado -> aberto e atrasado, mas não comprometido
  --   emitido atrasado  -> aberto, comprometido, atrasado
  --   confirmado no prazo -> aberto, comprometido
  --   recebido atrasado -> aberto, comprometido, NÃO atrasado (já recebeu)
  --   cancelado         -> fora de tudo, menos do recebido
  insert into public.procurement_purchase_orders(
    company_id, project_id, supplier_id, sequence_no, order_number, created_by,
    status, total_amount, received_amount, expected_delivery_date, cancellation_reason
  ) values
    (v_company, v_project, v_supplier, 1, 'PC-001', v_user, 'draft',      1000,   0, current_date - 5, null),
    (v_company, v_project, v_supplier, 2, 'PC-002', v_user, 'issued',     2000,   0, current_date - 5, null),
    (v_company, v_project, v_supplier, 3, 'PC-003', v_user, 'confirmed',  3000, 100, current_date + 5, null),
    (v_company, v_project, v_supplier, 4, 'PC-004', v_user, 'received',   4000, 400, current_date - 5, null),
    (v_company, v_project, v_supplier, 5, 'PC-005', v_user, 'cancelled',  9999,  50, current_date - 5, 'Cancelado no teste');

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  set local role authenticated;
  v_result := public.procurement_purchase_order_indicators(v_company, v_project);
  reset role;

  -- Abertos: todos menos closed/cancelled -> 4.
  if (v_result->>'open_count')::int <> 4 then
    raise exception 'open_count esperado 4, obtido %', v_result->>'open_count';
  end if;
  -- Comprometido: exclui rascunho e cancelado -> 2000+3000+4000.
  if (v_result->>'committed_total')::numeric <> 9000 then
    raise exception 'committed_total esperado 9000, obtido %', v_result->>'committed_total';
  end if;
  -- Recebido soma todos, inclusive o cancelado -> 100+400+50.
  if (v_result->>'received_total')::numeric <> 550 then
    raise exception 'received_total esperado 550, obtido %', v_result->>'received_total';
  end if;
  -- Atrasado: rascunho e emitido, ambos com prazo vencido. O recebido e o
  -- cancelado ficam de fora pelo status, mesmo com prazo vencido.
  if (v_result->>'delayed_count')::int <> 2 then
    raise exception 'delayed_count esperado 2, obtido %', v_result->>'delayed_count';
  end if;

  raise notice 'OK: procurement_purchase_order_indicators confere com o painel.';
end
$$;

rollback;
