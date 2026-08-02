#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"

report_file="${RUNNER_TEMP:-/tmp}/manual-koper-imports-audit.txt"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q -A -t > "$report_file" <<'SQL'
select 'PAYABLE_GROUPS';
select jsonb_build_object(
  'source_system', coalesce(source_system, '<null>'),
  'origin', coalesce(origin, '<null>'),
  'project_id', project_id,
  'count', count(*),
  'min_created_at', min(created_at),
  'max_created_at', max(created_at),
  'source_id_samples', coalesce((array_agg(source_id order by created_at) filter (where source_id is not null))[1:5], array[]::text[])
)::text
from public.payables
group by source_system, origin, project_id
order by count(*) desc, source_system nulls first, origin;

select 'BUDGETS';
select jsonb_build_object(
  'id', b.id,
  'project_id', b.project_id,
  'code', b.code,
  'name', b.name,
  'version', b.version,
  'status', b.status,
  'is_base', coalesce(b.is_base, false),
  'source_system', coalesce(b.source_system, '<null>'),
  'source_id', coalesce(b.source_id, '<null>'),
  'created_at', b.created_at,
  'updated_at', b.updated_at,
  'item_count', count(i.id),
  'koper_item_markers', count(i.id) filter (where coalesce(i.notes, '') like '%Koper itemBudgetId=%'),
  'notes', left(coalesce(b.notes, ''), 240)
)::text
from public.engineering_budgets b
left join public.engineering_budget_items i on i.budget_id = b.id
group by b.id
order by b.created_at, b.id;

select 'PAYABLE_REFERENCES';
select jsonb_build_object(
  'schema', tc.table_schema,
  'table', tc.table_name,
  'column', kcu.column_name,
  'delete_rule', rc.delete_rule
)::text
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
  and ccu.table_name = 'payables'
order by tc.table_schema, tc.table_name, kcu.column_name;

select 'BUDGET_REFERENCES';
select jsonb_build_object(
  'schema', tc.table_schema,
  'table', tc.table_name,
  'column', kcu.column_name,
  'delete_rule', rc.delete_rule
)::text
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
  and ccu.table_name = 'engineering_budgets'
order by tc.table_schema, tc.table_name, kcu.column_name;
SQL

cat "$report_file"

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  {
    echo '### Auditoria somente leitura'
    echo
    echo '```json'
    head -c 60000 "$report_file"
    echo
    echo '```'
  } > "${RUNNER_TEMP:-/tmp}/audit-comment.md"

  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -F body=@"${RUNNER_TEMP:-/tmp}/audit-comment.md" >/dev/null
fi
