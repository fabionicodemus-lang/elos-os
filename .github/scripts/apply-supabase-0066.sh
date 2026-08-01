#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260801_0066_procurement_intelligence.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260801_0066a_procurement_intelligence_fix.sql

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regclass('public.procurement_inventory_reservations') is null then raise exception 'Reservas de estoque não criadas'; end if;
  if to_regclass('public.procurement_cross_project_transfers') is null then raise exception 'Transferências entre obras não criadas'; end if;
  if to_regclass('public.procurement_integrated_supply_control') is null then raise exception 'Controle integrado não criado'; end if;
  if to_regclass('public.procurement_supplier_performance') is null then raise exception 'Avaliação de fornecedores não criada'; end if;
  if to_regclass('public.procurement_supplier_performance_raw_0066') is null then raise exception 'Base auditável da avaliação não preservada'; end if;
  if to_regprocedure('public.save_procurement_inventory_reservation(uuid,uuid,uuid,uuid,uuid,uuid,numeric,date,text)') is null then raise exception 'Função de reserva não criada'; end if;
  if to_regprocedure('public.change_procurement_inventory_reservation(uuid,uuid,uuid,text,text)') is null then raise exception 'Função de consumo/liberação não criada'; end if;
  if to_regprocedure('public.transfer_procurement_inventory_between_projects(uuid,uuid,uuid,uuid,uuid,numeric,text)') is null then raise exception 'Função de transferência entre obras não criada'; end if;
  if not exists(select 1 from pg_trigger where tgname='procurement_balance_sync_supply_plan' and not tgisinternal) then raise exception 'Sincronização estoque × planejamento não criada'; end if;
  if exists(select 1 from public.procurement_inventory_balances where reserved_quantity>quantity_on_hand+0.000001) then raise exception 'Reserva superior ao saldo físico'; end if;
  if exists(select 1 from public.procurement_supplier_performance where overall_score is not null and (overall_score<0 or overall_score>100)) then raise exception 'Nota de fornecedor fora da escala'; end if;
  if exists(
    select 1
    from public.procurement_supplier_performance p
    join (
      select i.company_id,i.project_id,o.supplier_id,coalesce(sum(i.total_amount),0) expected_value
      from public.procurement_purchase_order_items i
      join public.procurement_purchase_orders o on o.id=i.order_id
      where o.status not in('draft','cancelled')
      group by i.company_id,i.project_id,o.supplier_id
    ) x using(company_id,project_id,supplier_id)
    where abs(p.ordered_value-x.expected_value)>.01
  ) then raise exception 'Valor comprado do fornecedor está duplicado'; end if;
end $$;

begin;
do $$
declare v_project uuid; v_input uuid;
begin
  select project_id,input_id into v_project,v_input from public.engineering_supply_plan_items where record_status='active' limit 1;
  if v_project is not null then perform public.sync_supply_plan_inventory_for_input(v_project,v_input); end if;
end $$;
rollback;
SQL

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -f body='✅ Migrations 0066 e 0066a aplicadas e validadas. Controle integrado, reservas, transferências entre obras, avaliação automática de fornecedores e bases dos indicadores estão ativos.' >/dev/null
fi
