#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

MIGRATION="supabase/migrations/20261013_0092_measurement_approval_waits_invoice.sql"

echo "Aplicando Supabase 0092: aprovação de medição aguarda a nota fiscal."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION"

echo "Validando migration 0092..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare body text;
begin
  select pg_get_functiondef('public.approve_execution_contract_measurement(uuid,uuid,uuid,text)'::regprocedure) into body;
  if body is null then raise exception '0092: função approve_execution_contract_measurement ausente.'; end if;
  if position('insert into public.payables' in lower(body)) > 0 then
    raise exception '0092: a aprovação ainda cria conta a pagar.';
  end if;
  if position('return ''approved''' in body) = 0 then
    raise exception '0092: a aprovação não devolve o status approved.';
  end if;
end $$;
SQL

echo "Supabase 0092 aplicado e validado com sucesso."
