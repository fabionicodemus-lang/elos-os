#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"

report_file="${RUNNER_TEMP:-/tmp}/manual-koper-imports-audit.txt"

PGOPTIONS='-c statement_timeout=30000 -c lock_timeout=5000' \
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q -A -t > "$report_file" <<'SQL'
select 'MANUAL_BUDGET_BASELINE';
select jsonb_build_object(
  'budget_id', budget.id,
  'budget_code', budget.code,
  'budget_version', budget.version,
  'baseline_id', baseline.id,
  'baseline_code', baseline.code,
  'baseline_name', baseline.name,
  'baseline_version', baseline.version,
  'baseline_status', baseline.status,
  'baseline_created_at', baseline.created_at,
  'baseline_notes', left(coalesce(baseline.notes, ''), 300),
  'activity_count', (select count(*) from public.engineering_schedule_activities activity where activity.baseline_id = baseline.id),
  'dependency_count', (select count(*) from public.engineering_schedule_dependencies dependency where dependency.baseline_id = baseline.id)
)::text
from public.engineering_budgets budget
join public.engineering_schedule_baselines baseline on baseline.budget_id = budget.id
where budget.source_system = 'elos_os'
  and budget.source_id = 'flow_orcamento_r03'
  and budget.code = 'FLOW-ORC'
  and budget.version = 'R03';

create temp table manual_schedule_reference_counts (
  referenced_table text not null,
  referencing_schema text not null,
  referencing_table text not null,
  referencing_column text not null,
  delete_rule text not null,
  row_count bigint not null
) on commit preserve rows;

do $$
declare
  v_baseline_id uuid;
  reference_row record;
  matched_rows bigint;
begin
  select baseline.id into strict v_baseline_id
  from public.engineering_budgets budget
  join public.engineering_schedule_baselines baseline on baseline.budget_id = budget.id
  where budget.source_system = 'elos_os'
    and budget.source_id = 'flow_orcamento_r03'
    and budget.code = 'FLOW-ORC'
    and budget.version = 'R03';

  for reference_row in
    select
      ccu.table_name as referenced_table,
      tc.table_schema as referencing_schema,
      tc.table_name as referencing_table,
      kcu.column_name as referencing_column,
      rc.delete_rule
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.constraint_schema = kcu.constraint_schema
    join information_schema.referential_constraints rc
      on tc.constraint_name = rc.constraint_name
     and tc.constraint_schema = rc.constraint_schema
    join information_schema.constraint_column_usage ccu
      on rc.unique_constraint_name = ccu.constraint_name
     and rc.unique_constraint_schema = ccu.constraint_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and ccu.table_schema = 'public'
      and ccu.table_name in ('engineering_schedule_baselines', 'engineering_schedule_activities')
    order by ccu.table_name, tc.table_schema, tc.table_name, kcu.column_name
  loop
    if reference_row.referenced_table = 'engineering_schedule_baselines' then
      execute format(
        'select count(*) from %I.%I where %I = $1',
        reference_row.referencing_schema,
        reference_row.referencing_table,
        reference_row.referencing_column
      ) into matched_rows using v_baseline_id;
    else
      execute format(
        'select count(*) from %I.%I where %I in (select id from public.engineering_schedule_activities where baseline_id = $1)',
        reference_row.referencing_schema,
        reference_row.referencing_table,
        reference_row.referencing_column
      ) into matched_rows using v_baseline_id;
    end if;

    insert into manual_schedule_reference_counts values (
      reference_row.referenced_table,
      reference_row.referencing_schema,
      reference_row.referencing_table,
      reference_row.referencing_column,
      reference_row.delete_rule,
      matched_rows
    );
  end loop;
end $$;

select 'MANUAL_SCHEDULE_REFERENCES';
select jsonb_build_object(
  'referenced_table', referenced_table,
  'referencing_schema', referencing_schema,
  'referencing_table', referencing_table,
  'referencing_column', referencing_column,
  'delete_rule', delete_rule,
  'row_count', row_count
)::text
from manual_schedule_reference_counts
order by referenced_table, referencing_schema, referencing_table, referencing_column;

select 'KOPER_BUDGET_PRESERVATION';
select jsonb_build_object(
  'budget_id', budget.id,
  'code', budget.code,
  'source_system', budget.source_system,
  'source_id', budget.source_id,
  'item_count', count(item.id),
  'koper_item_markers', count(item.id) filter (where coalesce(item.notes, '') like '%Koper itemBudgetId=%'),
  'linked_baselines', (select count(*) from public.engineering_schedule_baselines baseline where baseline.budget_id = budget.id)
)::text
from public.engineering_budgets budget
left join public.engineering_budget_items item on item.budget_id = budget.id
where budget.source_system = 'koper'
group by budget.id
order by budget.created_at;
SQL

cat "$report_file"

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  {
    echo '### Auditoria da linha-base manual'
    echo
    echo '```json'
    head -c 60000 "$report_file"
    echo
    echo '```'
  } > "${RUNNER_TEMP:-/tmp}/audit-comment.md"

  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -F body=@"${RUNNER_TEMP:-/tmp}/audit-comment.md" >/dev/null
fi
