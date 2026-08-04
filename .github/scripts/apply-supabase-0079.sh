#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

MIGRATION="supabase/migrations/20260804_0079_budget_item_compositions.sql"

echo "Aplicando Supabase 0079: composição independente por item do orçamento."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION"

echo "Validando estrutura, funções e snapshots..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  budget_item_count bigint;
  composition_count bigint;
begin
  if to_regclass('public.engineering_budget_item_compositions') is null then
    raise exception '0079: cabeçalho das composições ausente';
  end if;
  if to_regclass('public.engineering_budget_item_composition_items') is null then
    raise exception '0079: itens das composições ausentes';
  end if;
  if to_regprocedure('public.ensure_engineering_budget_item_composition(uuid,uuid,uuid)') is null then
    raise exception '0079: função ensure ausente';
  end if;
  if to_regprocedure('public.save_engineering_budget_composition_item(uuid,uuid,uuid,uuid,uuid,numeric,numeric,numeric,integer,text)') is null then
    raise exception '0079: função de gravação ausente';
  end if;
  if to_regprocedure('public.remove_engineering_budget_composition_item(uuid,uuid,uuid,uuid)') is null then
    raise exception '0079: função de exclusão ausente';
  end if;

  select count(*) into budget_item_count from public.engineering_budget_items;
  select count(*) into composition_count from public.engineering_budget_item_compositions;
  if composition_count <> budget_item_count then
    raise exception '0079: snapshots incompletos: % composições para % itens', composition_count, budget_item_count;
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.engineering_budget_item_compositions'::regclass
      and relrowsecurity
  ) then raise exception '0079: RLS do cabeçalho desativada'; end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.engineering_budget_item_composition_items'::regclass
      and relrowsecurity
  ) then raise exception '0079: RLS dos itens desativada'; end if;
end $$;
SQL

message="✅ Supabase 0079 aplicado e validado. Cada item do orçamento possui composição própria, sem alterar o catálogo geral de serviços."
echo "$message"

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" -f body="$message" >/dev/null
fi
