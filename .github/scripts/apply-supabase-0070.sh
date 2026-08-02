#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260802_0070_budget_base_safe_delete.sql

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='engineering_budgets' and column_name='is_base'
  ) then raise exception 'Indicador de orçamento base não instalado'; end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='engineering_budgets'
      and indexname='engineering_budgets_one_base_per_project_uidx'
  ) then raise exception 'Unicidade do orçamento base não instalada'; end if;

  if to_regprocedure('public.set_engineering_budget_base(uuid,uuid,uuid)') is null then
    raise exception 'RPC para definir orçamento base ausente';
  end if;

  if to_regprocedure('public.delete_engineering_budget(uuid,uuid,uuid)') is null then
    raise exception 'RPC de exclusão segura ausente';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname='engineering_budget_base_guard' and not tgisinternal
  ) then raise exception 'Proteção do orçamento base ausente'; end if;

  if not exists (
    select 1 from pg_trigger
    where tgname='execution_material_request_require_base_budget' and not tgisinternal
  ) then raise exception 'Proteção dos centros de custo da solicitação ausente'; end if;

  if exists (
    select 1
    from public.engineering_budgets
    where is_base and status <> 'approved'
  ) then raise exception 'Existe orçamento base sem aprovação'; end if;

  if exists (
    select 1
    from public.engineering_budgets
    where is_base
    group by company_id, project_id
    having count(*) > 1
  ) then raise exception 'Existe mais de um orçamento base na mesma obra'; end if;

  if exists (
    select 1
    from public.engineering_budgets approved
    where approved.status='approved'
      and not exists (
        select 1 from public.engineering_budgets base
        where base.company_id=approved.company_id
          and base.project_id=approved.project_id
          and base.is_base
      )
  ) then raise exception 'Existe obra com orçamento aprovado e sem orçamento base inicial'; end if;
end $$;
SQL

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -f body='✅ Supabase 0070 aplicado e validado. Orçamento base único por obra, proteção dos centros de custo e exclusão segura estão ativos.' >/dev/null
fi
