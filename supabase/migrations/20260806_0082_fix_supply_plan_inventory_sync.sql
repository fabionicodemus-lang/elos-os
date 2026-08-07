-- Elos OS — Correção: sincronismo de estoque com o plano de suprimentos
--
-- Desde a migration 0066, QUALQUER gravação em procurement_inventory_balances
-- falhava com:
--
--   ERROR: column "planned_total_cost" can only be updated to DEFAULT
--
-- O trigger procurement_balance_sync_supply_plan chama esta função a cada
-- insert, delete ou update de quantidade/reserva/custo do saldo. A função
-- tentava atribuir planned_total_cost, que é coluna GENERATED ALWAYS desde a
-- migration 0025 (purchase_quantity * planned_unit_cost). O Postgres recusa a
-- atribuição no planejamento do UPDATE, então o erro acontecia mesmo quando
-- nenhuma linha do plano de suprimentos correspondia.
--
-- Na prática isso bloqueava recebimento de materiais, ajustes, transferências,
-- baixas e inventário — todo o módulo de estoque.
--
-- A correção é apenas remover a atribuição: a função já grava
-- purchase_quantity, e planned_total_cost é derivada dele automaticamente.
-- Nenhum valor muda de resultado.

begin;

create or replace function public.sync_supply_plan_inventory_for_input(
  p_project_id uuid,
  p_input_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available numeric;
begin
  select coalesce(sum(available_quantity), 0)
    into v_available
    from public.procurement_inventory_balances
   where project_id = p_project_id
     and input_id = p_input_id;

  update public.engineering_supply_plan_items
     set available_stock = v_available,
         purchase_quantity = greatest(0, required_quantity - v_available),
         -- planned_total_cost é GENERATED ALWAYS e deriva de purchase_quantity.
         updated_at = now()
   where project_id = p_project_id
     and input_id = p_input_id
     and record_status = 'active';
end;
$$;

commit;
