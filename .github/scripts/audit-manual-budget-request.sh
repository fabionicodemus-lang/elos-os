#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"

report_file="${RUNNER_TEMP:-/tmp}/manual-budget-request-audit.txt"

PGOPTIONS='-c statement_timeout=30000 -c lock_timeout=5000' \
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q -A -t > "$report_file" <<'SQL'
select 'MANUAL_BUDGET_REQUEST';
select jsonb_build_object(
  'request_id', request.id,
  'request_number', request.request_number,
  'status', request.status,
  'needed_date', request.needed_date,
  'requester_name', request.requester_name,
  'notes', request.notes,
  'created_at', request.created_at,
  'updated_at', request.updated_at,
  'item_count', count(item.id),
  'ordered_items', count(item.id) filter (where coalesce(item.ordered_quantity, 0) > 0),
  'koper_header_marker', request.request_number like 'KOPER-%' or coalesce(request.notes, '') like '%Koper requestId=%',
  'koper_item_markers', count(item.id) filter (where coalesce(item.notes, '') like '%Koper%')
)::text
from public.engineering_budgets budget
join public.execution_material_requests request on request.budget_id = budget.id
left join public.execution_material_request_items item on item.request_id = request.id
where budget.source_system = 'elos_os'
  and budget.source_id = 'flow_orcamento_r03'
  and budget.code = 'FLOW-ORC'
  and budget.version = 'R03'
group by request.id
order by request.created_at;

create temp table manual_request_reference_counts (
  referenced_table text not null,
  referencing_schema text not null,
  referencing_table text not null,
  referencing_column text not null,
  delete_rule text not null,
  row_count bigint not null
) on commit preserve rows;

do $$
declare
  v_request_id uuid;
  reference_row record;
  matched_rows bigint;
begin
  select request.id into strict v_request_id
  from public.engineering_budgets budget
  join public.execution_material_requests request on request.budget_id = budget.id
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
      and ccu.table_name in ('execution_material_requests', 'execution_material_request_items')
    order by ccu.table_name, tc.table_schema, tc.table_name, kcu.column_name
  loop
    if reference_row.referenced_table = 'execution_material_requests' then
      execute format(
        'select count(*) from %I.%I where %I = $1',
        reference_row.referencing_schema,
        reference_row.referencing_table,
        reference_row.referencing_column
      ) into matched_rows using v_request_id;
    else
      execute format(
        'select count(*) from %I.%I where %I in (select id from public.execution_material_request_items where request_id = $1)',
        reference_row.referencing_schema,
        reference_row.referencing_table,
        reference_row.referencing_column
      ) into matched_rows using v_request_id;
    end if;

    insert into manual_request_reference_counts values (
      reference_row.referenced_table,
      reference_row.referencing_schema,
      reference_row.referencing_table,
      reference_row.referencing_column,
      reference_row.delete_rule,
      matched_rows
    );
  end loop;
end $$;

select 'MANUAL_REQUEST_REFERENCES';
select jsonb_build_object(
  'referenced_table', referenced_table,
  'referencing_schema', referencing_schema,
  'referencing_table', referencing_table,
  'referencing_column', referencing_column,
  'delete_rule', delete_rule,
  'row_count', row_count
)::text
from manual_request_reference_counts
order by referenced_table, referencing_schema, referencing_table, referencing_column;
SQL

cat "$report_file"

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  {
    echo '### Auditoria da solicitação ligada ao orçamento manual'
    echo
    echo '```json'
    head -c 60000 "$report_file"
    echo
    echo '```'
  } > "${RUNNER_TEMP:-/tmp}/request-audit-comment.md"

  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -F body=@"${RUNNER_TEMP:-/tmp}/request-audit-comment.md" >/dev/null
fi
