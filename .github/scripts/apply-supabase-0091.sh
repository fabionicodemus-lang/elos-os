#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

MIGRATION="supabase/migrations/20261009_0091_elos_ia_usage.sql"

echo "Aplicando Supabase 0091: Elos IA — permissões e registro de consumo."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION"

echo "Validando estrutura da migration 0091..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regclass('public.ai_usage_log') is null then
    raise exception '0091: tabela ai_usage_log não foi criada.';
  end if;

  if not exists (
    select 1 from pg_class
    where oid='public.ai_usage_log'::regclass and relrowsecurity=true
  ) then
    raise exception '0091: RLS não está habilitado em ai_usage_log.';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='ai_usage_log' and policyname='ai_usage_log_select'
  ) then
    raise exception '0091: policy de leitura ausente.';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='ai_usage_log' and policyname='ai_usage_log_insert'
  ) then
    raise exception '0091: policy de inclusão ausente.';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='ai_usage_log' and cmd in ('UPDATE','DELETE','ALL')
  ) then
    raise exception '0091: ai_usage_log deve ser somente inclusão (há policy de alteração/exclusão).';
  end if;

  if has_table_privilege('authenticated','public.ai_usage_log','UPDATE')
     or has_table_privilege('authenticated','public.ai_usage_log','DELETE')
     or has_table_privilege('anon','public.ai_usage_log','SELECT') then
    raise exception '0091: privilégios de ai_usage_log mais amplos que o esperado.';
  end if;

  if not has_table_privilege('authenticated','public.ai_usage_log','INSERT')
     or not has_table_privilege('authenticated','public.ai_usage_log','SELECT') then
    raise exception '0091: usuário logado sem leitura/inclusão em ai_usage_log.';
  end if;

  if to_regprocedure('public.ai_usage_totals(uuid)') is null then
    raise exception '0091: função ai_usage_totals ausente.';
  end if;

  if (select count(*) from public.permissions where key in ('ai.assistant.use','ai.usage.view')) <> 2 then
    raise exception '0091: permissões do Elos IA ausentes.';
  end if;
end $$;

select
  (select count(*) from public.ai_usage_log) as usage_rows,
  (select count(*) from public.role_permissions where permission_key='ai.assistant.use' and allowed) as roles_with_access;
SQL

echo "Supabase 0091 aplicado e validado com sucesso."
