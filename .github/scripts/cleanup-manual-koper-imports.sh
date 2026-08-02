#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"

result_file="${RUNNER_TEMP:-/tmp}/manual-koper-imports-cleanup.txt"

PGOPTIONS='-c statement_timeout=120000 -c lock_timeout=10000' \
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q -A -t > "$result_file" <<'SQL'
begin;

create temp table cleanup_result (
  deleted_payables integer not null,
  deleted_budgets integer not null,
  preserved_other_payables_before integer not null,
  preserved_other_payables_after integer not null,
  preserved_other_budgets_before integer not null,
  preserved_other_budgets_after integer not null
) on commit preserve rows;

do $$
declare
  v_payables integer;
  v_bank_refs integer;
  v_budget_count integer;
  v_budget_id uuid;
  v_schedule_refs integer;
  v_request_refs integer;
  v_koper_budget_count integer;
  v_koper_item_markers integer;
begin
  select count(*) into v_payables
  from public.payables
  where source_system = 'koper_flow';

  if v_payables <> 3261 then
    raise exception 'Proteção acionada: esperadas 3261 contas koper_flow, encontradas %', v_payables;
  end if;

  select count(*) into v_bank_refs
  from public.finance_bank_transactions txn
  join public.payables payable on payable.id = txn.payable_id
  where payable.source_system = 'koper_flow';

  if v_bank_refs <> 0 then
    raise exception 'Proteção acionada: existem % movimentações bancárias ligadas às contas koper_flow', v_bank_refs;
  end if;

  select count(*) into v_budget_count
  from public.engineering_budgets
  where source_system = 'elos_os'
    and source_id = 'flow_orcamento_r03'
    and code = 'FLOW-ORC'
    and version = 'R03';

  select id into v_budget_id
  from public.engineering_budgets
  where source_system = 'elos_os'
    and source_id = 'flow_orcamento_r03'
    and code = 'FLOW-ORC'
    and version = 'R03'
  limit 1;

  if v_budget_count <> 1 or v_budget_id is null then
    raise exception 'Proteção acionada: orçamento manual FLOW-ORC/R03 não foi localizado de forma única';
  end if;

  if exists (
    select 1 from public.engineering_budgets
    where id = v_budget_id and coalesce(is_base, false)
  ) then
    raise exception 'Proteção acionada: o orçamento manual está marcado como orçamento base';
  end if;

  select count(*) into v_schedule_refs
  from public.engineering_schedule_baselines
  where budget_id = v_budget_id;

  if v_schedule_refs <> 0 then
    raise exception 'Proteção acionada: existem % linhas-base ligadas ao orçamento manual', v_schedule_refs;
  end if;

  select count(*) into v_request_refs
  from public.execution_material_requests
  where budget_id = v_budget_id;

  if v_request_refs <> 0 then
    raise exception 'Proteção acionada: existem % solicitações ligadas ao orçamento manual', v_request_refs;
  end if;

  select count(*) into v_koper_budget_count
  from public.engineering_budgets
  where source_system = 'koper';

  if v_koper_budget_count < 1 then
    raise exception 'Proteção acionada: nenhum orçamento do koper-worker foi encontrado antes da limpeza';
  end if;

  select count(*) into v_koper_item_markers
  from public.engineering_budget_items item
  join public.engineering_budgets budget on budget.id = item.budget_id
  where budget.source_system = 'koper'
    and coalesce(item.notes, '') like '%Koper itemBudgetId=%';

  if v_koper_item_markers < 1 then
    raise exception 'Proteção acionada: nenhum item promovido pelo koper-worker foi encontrado';
  end if;
end $$;

with before_counts as (
  select
    (select count(*) from public.payables where source_system is distinct from 'koper_flow')::integer as other_payables,
    (select count(*) from public.engineering_budgets
      where row(source_system, source_id, code, version)
        is distinct from row('elos_os', 'flow_orcamento_r03', 'FLOW-ORC', 'R03'))::integer as other_budgets
),
deleted_payables as (
  delete from public.payables
  where source_system = 'koper_flow'
  returning id
),
deleted_budgets as (
  delete from public.engineering_budgets
  where source_system = 'elos_os'
    and source_id = 'flow_orcamento_r03'
    and code = 'FLOW-ORC'
    and version = 'R03'
  returning id
)
insert into cleanup_result (
  deleted_payables,
  deleted_budgets,
  preserved_other_payables_before,
  preserved_other_payables_after,
  preserved_other_budgets_before,
  preserved_other_budgets_after
)
select
  (select count(*) from deleted_payables)::integer,
  (select count(*) from deleted_budgets)::integer,
  before_counts.other_payables,
  (select count(*) from public.payables where source_system is distinct from 'koper_flow')::integer,
  before_counts.other_budgets,
  (select count(*) from public.engineering_budgets
    where row(source_system, source_id, code, version)
      is distinct from row('elos_os', 'flow_orcamento_r03', 'FLOW-ORC', 'R03'))::integer
from before_counts;

do $$
declare
  v_result record;
  v_koper_budget_count integer;
  v_koper_item_markers integer;
begin
  select * into strict v_result from cleanup_result;

  if v_result.deleted_payables <> 3261 then
    raise exception 'Limpeza incompleta: % contas excluídas', v_result.deleted_payables;
  end if;

  if v_result.deleted_budgets <> 1 then
    raise exception 'Limpeza incompleta: % orçamentos excluídos', v_result.deleted_budgets;
  end if;

  if v_result.preserved_other_payables_before <> v_result.preserved_other_payables_after then
    raise exception 'Proteção acionada: outras contas a pagar foram alteradas';
  end if;

  if v_result.preserved_other_budgets_before <> v_result.preserved_other_budgets_after then
    raise exception 'Proteção acionada: outros orçamentos foram alterados';
  end if;

  if exists (select 1 from public.payables where source_system = 'koper_flow') then
    raise exception 'Ainda existem contas koper_flow após a limpeza';
  end if;

  if exists (
    select 1 from public.engineering_budgets
    where source_system = 'elos_os'
      and source_id = 'flow_orcamento_r03'
      and code = 'FLOW-ORC'
      and version = 'R03'
  ) then
    raise exception 'O orçamento manual ainda existe após a limpeza';
  end if;

  select count(*) into v_koper_budget_count
  from public.engineering_budgets
  where source_system = 'koper';

  select count(*) into v_koper_item_markers
  from public.engineering_budget_items item
  join public.engineering_budgets budget on budget.id = item.budget_id
  where budget.source_system = 'koper'
    and coalesce(item.notes, '') like '%Koper itemBudgetId=%';

  if v_koper_budget_count < 1 or v_koper_item_markers < 1 then
    raise exception 'Proteção acionada: dados do koper-worker não foram preservados';
  end if;
end $$;

commit;

select jsonb_build_object(
  'ok', true,
  'deleted_payables', result.deleted_payables,
  'deleted_manual_budgets', result.deleted_budgets,
  'preserved_other_payables', result.preserved_other_payables_after,
  'preserved_other_budgets', result.preserved_other_budgets_after,
  'remaining_koper_budgets', (select count(*) from public.engineering_budgets where source_system = 'koper'),
  'remaining_koper_budget_items', (
    select count(*)
    from public.engineering_budget_items item
    join public.engineering_budgets budget on budget.id = item.budget_id
    where budget.source_system = 'koper'
      and coalesce(item.notes, '') like '%Koper itemBudgetId=%'
  )
)::text
from cleanup_result result;
SQL

cat "$result_file"

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  {
    echo '### Limpeza concluída'
    echo
    echo '```json'
    cat "$result_file"
    echo '```'
  } > "${RUNNER_TEMP:-/tmp}/cleanup-comment.md"

  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -F body=@"${RUNNER_TEMP:-/tmp}/cleanup-comment.md" >/dev/null
fi
