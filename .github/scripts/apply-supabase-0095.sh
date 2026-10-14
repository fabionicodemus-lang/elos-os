#!/usr/bin/env bash
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
MIGRATION="supabase/migrations/20261014110000_elos_ia_financeiro.sql"
echo "Aplicando Elos IA Financeiro..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION"
echo "Validando Elos IA Financeiro..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if public.ai_action_required_permission('finance_payable_payment') <> 'payables.manage' then raise exception '0095: permissão de pagamento incorreta.'; end if;
  if public.ai_action_required_permission('finance_receivable_receipt') <> 'receivables.manage' then raise exception '0095: permissão de recebimento incorreta.'; end if;
  if public.ai_action_required_permission('finance_manual_invoice') <> 'finance.manual_invoices.manage' then raise exception '0095: permissão de nota manual incorreta.'; end if;
  if public.ai_action_required_permission('finance_tax_obligation') <> 'finance.taxes.manage' then raise exception '0095: permissão de impostos incorreta.'; end if;
  if public.ai_action_required_permission('finance_bank_transfer') <> 'finance.bank_accounts.transfer' then raise exception '0095: permissão de transferência incorreta.'; end if;
  if public.ai_action_required_permission('finance_correction_index') <> 'indices.manage' then raise exception '0095: permissão de índice incorreta.'; end if;
  if to_regprocedure('public.ai_execute_action_proposal(uuid)') is null then raise exception '0095: executor ausente.'; end if;
end $$;
SQL
echo "Elos IA Financeiro aplicado e validado com sucesso."
