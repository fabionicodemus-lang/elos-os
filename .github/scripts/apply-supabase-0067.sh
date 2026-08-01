#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260801_0067_koper_staging_records.sql

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regclass('public.koper_staging_records') is null then
    raise exception 'Staging canônica do Koper não criada';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='koper_staging_records' and c.relrowsecurity
  ) then raise exception 'RLS da staging do Koper não está ativa'; end if;
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='koper_staging_records'
      and policyname='koper_staging_records_select' and cmd='SELECT'
      and roles::text like '%authenticated%'
  ) then raise exception 'Policy de leitura por empresa não criada'; end if;
  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='koper_staging_records'
      and cmd in ('ALL','INSERT','UPDATE','DELETE') and roles::text like '%authenticated%'
  ) then raise exception 'Usuários autenticados receberam policy de escrita indevida'; end if;
  if has_table_privilege('authenticated','public.koper_staging_records','INSERT')
     or has_table_privilege('authenticated','public.koper_staging_records','UPDATE')
     or has_table_privilege('authenticated','public.koper_staging_records','DELETE') then
    raise exception 'Usuários autenticados receberam grant de escrita indevido';
  end if;
  if not has_table_privilege('authenticated','public.koper_staging_records','SELECT') then
    raise exception 'Grant de leitura autenticada não aplicado';
  end if;
  if to_regclass('public.koper_staging_records_company_id_source_entity_koper_id_key') is null then
    raise exception 'Unicidade canônica da staging não criada';
  end if;
end $$;
SQL

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -f body='✅ Migration 0067 aplicada e validada. A staging do Koper está com RLS ativa, chave idempotente por empresa/entidade/ID e sem escrita para usuários autenticados.' >/dev/null
fi
