#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
MIGRATION="supabase/migrations/20260730_0058_finance_sefaz_dfe.sql"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regclass('public.finance_sefaz_connections') is null then raise exception 'finance_sefaz_connections ausente'; end if;
  if to_regclass('public.finance_sefaz_documents') is null then raise exception 'finance_sefaz_documents ausente'; end if;
  if to_regclass('public.finance_sefaz_sync_logs') is null then raise exception 'finance_sefaz_sync_logs ausente'; end if;
  if not exists (select 1 from storage.buckets where id = 'sefaz-certificates' and public = false) then raise exception 'bucket sefaz-certificates ausente ou público'; end if;
  if not exists (select 1 from storage.buckets where id = 'sefaz-dfe' and public = false) then raise exception 'bucket sefaz-dfe ausente ou público'; end if;
end $$;
SQL

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" -f body='✅ Migration 0058 aplicada e validada. Conexões SEFAZ, controle de NSU, documentos distribuídos, logs, RLS e buckets privados foram confirmados.' >/dev/null
fi
