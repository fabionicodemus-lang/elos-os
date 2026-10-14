#!/usr/bin/env bash
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
MIGRATION="supabase/migrations/20261014_0093_security_audit_trail.sql"
echo "Aplicando Supabase 0093: trilha de auditoria."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION"
echo "Validando migration 0093..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare n int;
begin
  if not (select relrowsecurity from pg_class where oid='public.security_audit_log'::regclass) then
    raise exception '0093: RLS desligado na trilha.'; end if;
  if has_table_privilege('authenticated','public.security_audit_log','insert,update,delete') then
    raise exception '0093: usuários conseguem alterar a trilha.'; end if;
  select count(*) into n from pg_trigger where tgname='zz_security_audit';
  if n < 5 then raise exception '0093: poucos gatilhos de auditoria (%).', n; end if;
  raise notice '0093: % tabelas auditadas.', n;
end $$;
SQL
echo "Supabase 0093 aplicado e validado com sucesso."
