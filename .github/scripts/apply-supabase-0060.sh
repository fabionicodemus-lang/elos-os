#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
MIGRATION="supabase/migrations/20260730_0060_homologation_purchase_to_pay_hardening.sql"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regprocedure('public.approve_procurement_material_receipt(uuid,uuid,uuid,text)') is null then
    raise exception 'approve_procurement_material_receipt ausente';
  end if;
  if to_regprocedure('public.protect_nfe_generated_payable()') is null then
    raise exception 'protect_nfe_generated_payable ausente';
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgname='payables_protect_nfe_generated_title'
      and tgrelid='public.payables'::regclass
      and not tgisinternal
  ) then
    raise exception 'trigger de proteção dos títulos da NF-e ausente';
  end if;
  if position('material-receipt-approval' in pg_get_functiondef('public.approve_procurement_material_receipt(uuid,uuid,uuid,text)'::regprocedure))=0 then
    raise exception 'serialização dos recebimentos não foi instalada';
  end if;
  if position('saldo atual do pedido' in pg_get_functiondef('public.approve_procurement_material_receipt(uuid,uuid,uuid,text)'::regprocedure))=0 then
    raise exception 'revalidação do saldo do pedido não foi instalada';
  end if;
end $$;
SQL

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -f body='✅ Migration 0060 aplicada e validada. A aprovação concorrente de recebimentos foi serializada, o saldo do pedido é revalidado no aceite e títulos gerados por NF-e não podem mais ser cancelados isoladamente.' >/dev/null
fi
