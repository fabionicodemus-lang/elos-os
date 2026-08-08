#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

MIGRATION="supabase/migrations/20260806_0082_fix_supply_plan_inventory_sync.sql"

echo "Aplicando Supabase 0082: corrigir escrita de saldos de estoque."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION"

echo "Validando que a função não escreve mais em coluna gerada..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  v_definition text;
begin
  if to_regprocedure('public.sync_supply_plan_inventory_for_input(uuid,uuid)') is null then
    raise exception '0082: função sync_supply_plan_inventory_for_input ausente';
  end if;

  v_definition := pg_get_functiondef('public.sync_supply_plan_inventory_for_input(uuid,uuid)'::regprocedure);

  -- A atribuição a planned_total_cost é justamente o que quebrava toda gravação
  -- de saldo: a coluna é GENERATED ALWAYS desde a migration 0025.
  if v_definition ~* 'planned_total_cost[[:space:]]*=' then
    raise exception '0082: a função ainda atribui planned_total_cost';
  end if;

  if v_definition !~* 'purchase_quantity[[:space:]]*=' then
    raise exception '0082: a função deixou de gravar purchase_quantity';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'procurement_balance_sync_supply_plan' and not tgisinternal
  ) then
    raise exception '0082: trigger de sincronismo de saldo ausente';
  end if;
end $$;
SQL

echo "Provando, em transação descartada, que gravar saldo voltou a funcionar..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
begin;
do $$
declare
  v_company uuid;
  v_project uuid;
  v_location uuid;
  v_input uuid;
begin
  -- Usa uma empresa e obra reais já existentes; nada é mantido, o rollback
  -- abaixo descarta tudo. O objetivo é exercitar o trigger de verdade.
  select p.company_id, p.id into v_company, v_project
  from public.projects p
  order by p.created_at
  limit 1;

  if v_company is null then
    raise notice '0082: nenhum projeto cadastrado, prova de gravação ignorada.';
    return;
  end if;

  insert into public.procurement_inventory_locations(company_id, project_id, code, name)
    values (v_company, v_project, 'ZZ-TESTE-0082', 'Local temporário 0082')
    returning id into v_location;

  insert into public.engineering_inputs(company_id, code, description, unit)
    values (v_company, 'ZZ-TESTE-0082', 'Insumo temporário 0082', 'un')
    returning id into v_input;

  insert into public.procurement_inventory_balances(
    company_id, project_id, input_id, location_id,
    input_code, input_name, unit_snapshot, quantity_on_hand
  ) values (
    v_company, v_project, v_input, v_location,
    'ZZ-TESTE-0082', 'Insumo temporário 0082', 'un', 1
  );

  update public.procurement_inventory_balances
     set quantity_on_hand = 2
   where input_id = v_input;

  raise notice '0082: gravação e atualização de saldo funcionaram.';
end $$;
rollback;
SQL

message="✅ Supabase 0082 aplicado e validado. Gravação de saldos de estoque restabelecida: recebimento de materiais, ajustes, transferências, baixas e inventário voltam a funcionar. A função de sincronismo não escreve mais na coluna gerada planned_total_cost."
echo "$message"

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" -f body="$message" >/dev/null
fi
