#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"

result_file="${RUNNER_TEMP:-/tmp}/manual-koper-imports-cleanup.txt"

PGOPTIONS='-c statement_timeout=120000 -c lock_timeout=10000' \
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q -A -t > "$result_file" <<'SQL'
begin;

create temp table cleanup_result (
  deleted_payables integer not null,
  deleted_baselines integer not null,
  deleted_budgets integer not null,
  preserved_other_payables_before integer not null,
  preserved_other_payables_after integer not null,
  preserved_other_budgets_before integer not null,
  preserved_other_budgets_after integer not null
) on commit preserve rows;

do $$
declare
  v_payables integer;
  v_payable_refs integer;
  v_budget_id uuid;
  v_budget_count integer;
  v_baseline_id uuid;
  v_baselines integer;
  v_activities integer;
  v_dependencies integer;
  v_tracking integer;
  v_progress integer;
  v_external_schedule_refs integer;
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

  select
    (select count(*) from public.finance_bank_transactions row join public.payables payable on payable.id = row.payable_id where payable.source_system = 'koper_flow')
    + (select count(*) from public.commercial_sale_commissions row join public.payables payable on payable.id = row.payable_id where payable.source_system = 'koper_flow')
    + (select count(*) from public.execution_contract_measurements row join public.payables payable on payable.id = row.payable_id where payable.source_system = 'koper_flow')
    + (select count(*) from public.execution_work_order_installments row join public.payables payable on payable.id = row.payable_id where payable.source_system = 'koper_flow')
    + (select count(*) from public.finance_electronic_invoice_installments row join public.payables payable on payable.id = row.payable_id where payable.source_system = 'koper_flow')
    + (select count(*) from public.finance_manual_invoice_installments row join public.payables payable on payable.id = row.payable_id where payable.source_system = 'koper_flow')
    + (select count(*) from public.finance_tax_obligations row join public.payables payable on payable.id = row.payable_id where payable.source_system = 'koper_flow')
  into v_payable_refs;

  if v_payable_refs <> 0 then
    raise exception 'Proteção acionada: existem % vínculos com as contas koper_flow', v_payable_refs;
  end if;

  select count(*), min(id) into v_budget_count, v_budget_id
  from public.engineering_budgets
  where source_system = 'elos_os'
    and source_id = 'flow_orcamento_r03'
    and code = 'FLOW-ORC'
    and version = 'R03';

  if v_budget_count <> 1 or v_budget_id is null then
    raise exception 'Proteção acionada: orçamento manual FLOW-ORC/R03 não foi localizado de forma única';
  end if;

  if exists (select 1 from public.engineering_budgets where id = v_budget_id and coalesce(is_base, false)) then
    raise exception 'Proteção acionada: o orçamento manual está marcado como orçamento base';
  end if;

  select count(*), min(id) into v_baselines, v_baseline_id
  from public.engineering_schedule_baselines
  where budget_id = v_budget_id;

  if v_baselines <> 1 or v_baseline_id is null then
    raise exception 'Proteção acionada: esperada 1 linha-base manual, encontradas %', v_baselines;
  end if;

  select count(*) into v_activities from public.engineering_schedule_activities where baseline_id = v_baseline_id;
  select count(*) into v_dependencies from public.engineering_schedule_dependencies where baseline_id = v_baseline_id;
  select count(*) into v_tracking from public.engineering_schedule_activity_tracking where baseline_id = v_baseline_id;
  select count(*) into v_progress from public.engineering_schedule_progress_measurements where baseline_id = v_baseline_id;

  if v_activities <> 354 or v_dependencies <> 585 or v_tracking <> 8 or v_progress <> 8 then
    raise exception 'Proteção acionada: estrutura da linha-base mudou: atividades %, dependências %, acompanhamentos %, medições %',
      v_activities, v_dependencies, v_tracking, v_progress;
  end if;

  select
    (select count(*) from public.engineering_contract_packages where baseline_id = v_baseline_id)
    + (select count(*) from public.engineering_supply_plan_items where baseline_id = v_baseline_id)
    + (select count(*) from public.execution_daily_log_services where schedule_activity_id in (select id from public.engineering_schedule_activities where baseline_id = v_baseline_id))
    + (select count(*) from public.execution_service_contract_items where schedule_activity_id in (select id from public.engineering_schedule_activities where baseline_id = v_baseline_id))
    + (select count(*) from public.execution_service_request_items where schedule_activity_id in (select id from public.engineering_schedule_activities where baseline_id = v_baseline_id))
    + (select count(*) from public.execution_work_order_items where schedule_activity_id in (select id from public.engineering_schedule_activities where baseline_id = v_baseline_id))
    + (select count(*) from public.quality_inspections where schedule_activity_id in (select id from public.engineering_schedule_activities where baseline_id = v_baseline_id))
    + (select count(*) from public.quality_service_releases where schedule_activity_id in (select id from public.engineering_schedule_activities where baseline_id = v_baseline_id))
  into v_external_schedule_refs;

  if v_external_schedule_refs <> 0 then
    raise exception 'Proteção acionada: existem % vínculos operacionais externos com a linha-base antiga', v_external_schedule_refs;
  end if;

  select count(*) into v_request_refs from public.execution_material_requests where budget_id = v_budget_id;
  if v_request_refs <> 0 then
    raise exception 'Proteção acionada: existem % solicitações ligadas ao orçamento manual', v_request_refs;
  end if;

  select count(*) into v_koper_budget_count from public.engineering_budgets where source_system = 'koper';
  select count(*) into v_koper_item_markers
  from public.engineering_budget_items item
  join public.engineering_budgets budget on budget.id = item.budget_id
  where budget.source_system = 'koper'
    and coalesce(item.notes, '') like '%Koper itemBudgetId=%';

  if v_koper_budget_count < 1 or v_koper_item_markers < 1 then
    raise exception 'Proteção acionada: dados do koper-worker não foram encontrados antes da limpeza';
  end if;
end $$;

do $$
declare
  v_budget_id uuid;
  v_deleted_payables integer;
  v_deleted_baselines integer;
  v_deleted_budgets integer;
  v_other_payables_before integer;
  v_other_payables_after integer;
  v_other_budgets_before integer;
  v_other_budgets_after integer;
begin
  select id into strict v_budget_id
  from public.engineering_budgets
  where source_system = 'elos_os'
    and source_id = 'flow_orcamento_r03'
    and code = 'FLOW-ORC'
    and version = 'R03';

  select count(*) into v_other_payables_before
  from public.payables where source_system is distinct from 'koper_flow';

  select count(*) into v_other_budgets_before
  from public.engineering_budgets
  where row(source_system, source_id, code, version)
    is distinct from row('elos_os', 'flow_orcamento_r03', 'FLOW-ORC', 'R03');

  delete from public.payables where source_system = 'koper_flow';
  get diagnostics v_deleted_payables = row_count;

  delete from public.engineering_schedule_baselines where budget_id = v_budget_id;
  get diagnostics v_deleted_baselines = row_count;

  delete from public.engineering_budgets where id = v_budget_id;
  get diagnostics v_deleted_budgets = row_count;

  select count(*) into v_other_payables_after
  from public.payables where source_system is distinct from 'koper_flow';

  select count(*) into v_other_budgets_after
  from public.engineering_budgets
  where row(source_system, source_id, code, version)
    is distinct from row('elos_os', 'flow_orcamento_r03', 'FLOW-ORC', 'R03');

  insert into cleanup_result values (
    v_deleted_payables,
    v_deleted_baselines,
    v_deleted_budgets,
    v_other_payables_before,
    v_other_payables_after,
    v_other_budgets_before,
    v_other_budgets_after
  );
end $$;

do $$
declare
  v_result record;
  v_koper_budget_count integer;
  v_koper_item_markers integer;
begin
  select * into strict v_result from cleanup_result;

  if v_result.deleted_payables <> 3261 or v_result.deleted_baselines <> 1 or v_result.deleted_budgets <> 1 then
    raise exception 'Limpeza incompleta: contas %, linhas-base %, orçamentos %',
      v_result.deleted_payables, v_result.deleted_baselines, v_result.deleted_budgets;
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

  if exists (select 1 from public.engineering_budgets where source_system = 'elos_os' and source_id = 'flow_orcamento_r03') then
    raise exception 'O orçamento manual ainda existe após a limpeza';
  end if;

  select count(*) into v_koper_budget_count from public.engineering_budgets where source_system = 'koper';
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
  'deleted_manual_baselines', result.deleted_baselines,
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
