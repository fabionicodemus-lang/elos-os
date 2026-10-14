#!/usr/bin/env bash
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

MIGRATIONS=(
  "supabase/migrations/20261014100000_elos_ia_safe_write.sql"
  "supabase/migrations/20261014100100_elos_ia_safe_write_attachment_link.sql"
  "supabase/migrations/20261014100200_elos_ia_safe_write_execute.sql"
)

for migration in "${MIGRATIONS[@]}"; do
  echo "Aplicando ${migration}..."
  psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
done

echo "Validando Elos IA safe-write..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  bucket_public boolean;
begin
  if to_regclass('public.ai_action_proposals') is null then
    raise exception '0094: tabela ai_action_proposals ausente.';
  end if;
  if to_regclass('public.ai_action_attachments') is null then
    raise exception '0094: tabela ai_action_attachments ausente.';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.ai_action_proposals'::regclass) then
    raise exception '0094: RLS desligado em ai_action_proposals.';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.ai_action_attachments'::regclass) then
    raise exception '0094: RLS desligado em ai_action_attachments.';
  end if;
  if to_regprocedure('public.ai_link_action_attachment(uuid,uuid,text)') is null then
    raise exception '0094: função ai_link_action_attachment ausente.';
  end if;
  if to_regprocedure('public.ai_execute_action_proposal(uuid)') is null then
    raise exception '0094: função ai_execute_action_proposal ausente.';
  end if;
  select public into bucket_public from storage.buckets where id='ai-action-attachments';
  if bucket_public is null then
    raise exception '0094: bucket ai-action-attachments ausente.';
  end if;
  if bucket_public then
    raise exception '0094: bucket ai-action-attachments não está privado.';
  end if;
end $$;
SQL

echo "Elos IA safe-write aplicado e validado com sucesso."
