-- requires: shadow
-- Prova que gravar saldo de estoque funciona e que o plano de suprimentos é
-- sincronizado corretamente pelo trigger.
--
-- Antes da migration 0082 este teste falhava já no insert do saldo, com
-- "column planned_total_cost can only be updated to DEFAULT" — o que bloqueava
-- todo o módulo de estoque em produção.

begin;

do $$
declare
  v_company uuid := '11111111-1111-1111-1111-111111111111';
  v_project uuid := '22222222-2222-2222-2222-222222222222';
  v_user    uuid := '33333333-3333-3333-3333-333333333333';
  v_location uuid := '44444444-0000-0000-0000-000000000001';
  v_input uuid := '55555555-0000-0000-0000-000000000001';
  v_budget uuid := '66666666-0000-0000-0000-000000000001';
  v_baseline uuid := '77777777-0000-0000-0000-000000000001';
  v_role uuid;
  v_available numeric;
  v_purchase numeric;
  v_total numeric;
begin
  insert into auth.users(id, email, email_confirmed_at)
    values (v_user, 'teste-estoque-write@elos.local', now());

  insert into public.companies(id, name, slug, status, created_by)
    values (v_company, 'Empresa de Teste', 'empresa-teste', 'active', v_user);

  insert into public.roles(company_id, key, name, is_system, created_by)
    values (v_company, 'owner', 'Proprietário', true, v_user)
    returning id into v_role;

  insert into public.role_permissions(role_id, permission_key, allowed)
    values (v_role, 'procurement.inventory.manage', true);

  insert into public.company_memberships(company_id, user_id, role_id, status)
    values (v_company, v_user, v_role, 'active');

  insert into public.projects(id, company_id, name, code, status, created_by)
    values (v_project, v_company, 'Obra de Teste', 'TST-001', 'active', v_user);

  insert into public.procurement_inventory_locations(id, company_id, project_id, code, name, created_by)
    values (v_location, v_company, v_project, 'ALM-01', 'Almoxarifado', v_user);

  insert into public.engineering_inputs(id, company_id, code, description, unit, created_by)
    values (v_input, v_company, 'INS-A', 'Cimento', 'sc', v_user);

  insert into public.engineering_budgets(id, company_id, project_id, code, name, created_by)
    values (v_budget, v_company, v_project, 'ORC-1', 'Orçamento', v_user);

  insert into public.engineering_schedule_baselines(id, company_id, project_id, budget_id, code, name, start_date, created_by)
    values (v_baseline, v_company, v_project, v_budget, 'LB-1', 'Linha de base', date '2026-01-01', v_user);

  -- Precisa de 100 unidades e o custo unitário é 10.
  insert into public.engineering_supply_plan_items(
    company_id, project_id, baseline_id, input_id, code, name, unit_snapshot,
    category_snapshot, required_quantity, planned_unit_cost, first_use_date,
    quotation_start, order_deadline, delivery_deadline, created_by
  ) values (
    v_company, v_project, v_baseline, v_input, 'SUP-INS-A', 'Cimento', 'sc',
    'Material', 100, 10, date '2026-09-01',
    date '2026-07-01', date '2026-08-01', date '2026-08-15', v_user
  );

  -- Esta gravação é a que falhava antes da 0082.
  insert into public.procurement_inventory_balances(
    company_id, project_id, input_id, location_id, input_code, input_name,
    unit_snapshot, quantity_on_hand
  ) values (
    v_company, v_project, v_input, v_location, 'INS-A', 'Cimento', 'sc', 30
  );

  select available_stock, purchase_quantity, planned_total_cost
    into v_available, v_purchase, v_total
    from public.engineering_supply_plan_items
   where project_id = v_project and input_id = v_input;

  -- 30 em estoque, faltam 70, a 10 por unidade.
  if v_available <> 30 then
    raise exception 'available_stock esperado 30, obtido %', v_available;
  end if;
  if v_purchase <> 70 then
    raise exception 'purchase_quantity esperado 70, obtido %', v_purchase;
  end if;
  if v_total <> 700 then
    raise exception 'planned_total_cost esperado 700, obtido %', v_total;
  end if;

  -- Atualizar o saldo também dispara o trigger.
  update public.procurement_inventory_balances
     set quantity_on_hand = 120
   where project_id = v_project and input_id = v_input;

  select available_stock, purchase_quantity, planned_total_cost
    into v_available, v_purchase, v_total
    from public.engineering_supply_plan_items
   where project_id = v_project and input_id = v_input;

  -- Estoque acima da necessidade: nada a comprar.
  if v_available <> 120 or v_purchase <> 0 or v_total <> 0 then
    raise exception 'após reposição esperado 120/0/0, obtido %/%/%', v_available, v_purchase, v_total;
  end if;

  raise notice 'OK: gravação de estoque sincroniza o plano de suprimentos.';
end
$$;

rollback;
