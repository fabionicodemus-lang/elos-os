#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
MIGRATION="supabase/migrations/20260730_0059_finance_menu_permissions.sql"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if not exists (select 1 from public.permissions where key='cashflow.view') then
    raise exception 'Permissão cashflow.view ausente';
  end if;
  if not exists (select 1 from public.permissions where key='reports.view') then
    raise exception 'Permissão reports.view ausente';
  end if;
  if exists (
    select 1
    from public.roles r
    where r.key in ('owner','admin','director','finance')
      and not exists (
        select 1 from public.role_permissions rp
        where rp.role_id=r.id
          and rp.permission_key in ('cashflow.view','reports.view')
          and rp.allowed=true
        group by rp.role_id
        having count(distinct rp.permission_key)=2
      )
  ) then
    raise exception 'Papéis financeiros sem as duas permissões esperadas';
  end if;
end $$;
SQL

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" -f body='✅ Migration 0059 aplicada e validada. Fluxo de Caixa e Relatórios Financeiros foram cadastrados na matriz e liberados para Proprietário, Administrador, Diretor e Financeiro.' >/dev/null
fi
