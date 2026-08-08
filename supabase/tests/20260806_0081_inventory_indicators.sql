-- requires: shadow
-- Prova que procurement_inventory_indicators devolve os mesmos números que o
-- bloco inventory-kpis calculava em memória (app/suprimentos/estoque/page.tsx).
--
-- Roda como usuário `authenticated` com auth.uid() simulado, para exercitar a
-- RLS e a verificação de permissão do mesmo jeito que a aplicação faz.

begin;

do $$
declare
  v_company uuid := '11111111-1111-1111-1111-111111111111';
  v_project uuid := '22222222-2222-2222-2222-222222222222';
  v_user    uuid := '33333333-3333-3333-3333-333333333333';
  v_location uuid := '44444444-0000-0000-0000-000000000001';
  v_location_off uuid := '44444444-0000-0000-0000-000000000002';
  v_input_a uuid := '55555555-0000-0000-0000-000000000001';
  v_input_b uuid := '55555555-0000-0000-0000-000000000002';
  v_input_c uuid := '55555555-0000-0000-0000-000000000003';
  v_input_d uuid := '55555555-0000-0000-0000-000000000004';
  v_role uuid;
  v_result jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at)
    values (v_user, 'teste-estoque@elos.local', now());

  insert into public.companies(id, name, slug, status, created_by)
    values (v_company, 'Empresa de Teste', 'empresa-teste', 'active', v_user);

  insert into public.roles(company_id, key, name, is_system, created_by)
    values (v_company, 'owner', 'Proprietário', true, v_user)
    returning id into v_role;

  insert into public.role_permissions(role_id, permission_key, allowed)
    values (v_role, 'procurement.inventory.view', true);

  insert into public.company_memberships(company_id, user_id, role_id, status)
    values (v_company, v_user, v_role, 'active');

  insert into public.projects(id, company_id, name, code, status, created_by)
    values (v_project, v_company, 'Obra de Teste', 'TST-001', 'active', v_user);

  -- Um local ativo e um inativo: só o ativo deve ser contado.
  insert into public.procurement_inventory_locations(id, company_id, project_id, code, name, status, created_by) values
    (v_location,     v_company, v_project, 'ALM-01', 'Almoxarifado', 'active',   v_user),
    (v_location_off, v_company, v_project, 'ALM-02', 'Desativado',   'inactive', v_user);

  insert into public.engineering_inputs(id, company_id, code, description, unit, created_by) values
    (v_input_a, v_company, 'INS-A', 'Cimento', 'sc', v_user),
    (v_input_b, v_company, 'INS-B', 'Areia', 'm3', v_user),
    (v_input_c, v_company, 'INS-C', 'Aditivo', 'l', v_user),
    (v_input_d, v_company, 'INS-D', 'Zerado', 'un', v_user);

  -- Quatro saldos:
  --   A: com saldo, acima do mínimo, sem validade      -> ativo
  --   B: com saldo, no mínimo                          -> ativo + abaixo do mínimo
  --   C: com saldo, validade dentro de 60 dias         -> ativo + a vencer
  --   D: sem saldo, com valor                          -> entra só no valor total
  insert into public.procurement_inventory_balances(
    company_id, project_id, input_id, location_id, input_code, input_name, unit_snapshot,
    quantity_on_hand, minimum_quantity, total_value, expiration_date
  ) values
    (v_company, v_project, v_input_a, v_location, 'INS-A', 'Cimento', 'sc', 100, 10, 1000, date '9999-12-31'),
    (v_company, v_project, v_input_b, v_location, 'INS-B', 'Areia',   'm3',  5,  5,  500, date '9999-12-31'),
    (v_company, v_project, v_input_c, v_location, 'INS-C', 'Aditivo', 'l',  20,  0,  200, current_date + 30),
    (v_company, v_project, v_input_d, v_location, 'INS-D', 'Zerado',  'un',  0,  0,   50, date '9999-12-31');

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  set local role authenticated;

  v_result := public.procurement_inventory_indicators(v_company, v_project, 60);

  reset role;

  -- Conferidos contra inventory-kpis.
  if (v_result->>'stock_value')::numeric <> 1750 then
    raise exception 'stock_value esperado 1750 (inclui o saldo zerado), obtido %', v_result->>'stock_value';
  end if;
  if (v_result->>'active_count')::int <> 3 then
    raise exception 'active_count esperado 3, obtido %', v_result->>'active_count';
  end if;
  if (v_result->>'active_quantity')::numeric <> 125 then
    raise exception 'active_quantity esperado 125, obtido %', v_result->>'active_quantity';
  end if;
  if (v_result->>'low_count')::int <> 1 then
    raise exception 'low_count esperado 1 (só o que está no mínimo), obtido %', v_result->>'low_count';
  end if;
  if (v_result->>'expiring_count')::int <> 1 then
    raise exception 'expiring_count esperado 1, obtido %', v_result->>'expiring_count';
  end if;
  if (v_result->>'active_location_count')::int <> 1 then
    raise exception 'active_location_count esperado 1, obtido %', v_result->>'active_location_count';
  end if;

  raise notice 'OK: procurement_inventory_indicators confere com o painel em memória.';
end
$$;

rollback;
