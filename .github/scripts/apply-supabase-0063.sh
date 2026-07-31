#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260731_0063_universal_financial_installments.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260731_0063a_universal_financial_installments_runtime_fix.sql

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if not exists(select 1 from public.permissions where key='execution.work_orders.finance') then
    raise exception 'Permissão execution.work_orders.finance não criada';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='execution_work_orders' and column_name='financial_mode') then
    raise exception 'Coluna financial_mode não criada';
  end if;
  if to_regclass('public.execution_work_order_installments') is null then
    raise exception 'Tabela execution_work_order_installments não criada';
  end if;
  if to_regprocedure('public.save_execution_work_order_with_financial_plan(uuid,uuid,uuid,uuid,text,text,date,date,text,text,text,text,text,text,jsonb,jsonb,text,jsonb)') is null then
    raise exception 'Função atômica de O.S. e parcelamento não criada';
  end if;
  if to_regprocedure('public.accept_execution_work_order_with_financial(uuid,uuid,uuid,text,text,text,text,jsonb)') is null then
    raise exception 'Função de aceite financeiro da O.S. não criada';
  end if;
  if not exists(select 1 from pg_trigger where tgname='finance_manual_invoice_installment_balance_trigger' and not tgisinternal) then
    raise exception 'Validação das parcelas das notas manuais não criada';
  end if;
  if not exists(select 1 from pg_trigger where tgname='finance_electronic_invoice_installment_balance_trigger' and not tgisinternal) then
    raise exception 'Validação das parcelas das NF-e não criada';
  end if;
  if not exists(select 1 from pg_trigger where tgname='prevent_direct_payable_work_order_measurement_trigger' and not tgisinternal) then
    raise exception 'Proteção contra duplicidade O.S./medição não criada';
  end if;
end $$;
SQL

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -f body='✅ Migrations 0063 e 0063a aplicadas e validadas. Parcelas de Notas Manuais, NF-e e Ordens de Serviço passam a exigir fechamento exato; a O.S. ganhou previsão e geração opcional de Contas a Pagar no aceite, com proteção contra duplicidade em medição.' >/dev/null
fi
