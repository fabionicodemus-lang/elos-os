#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260731_0064_00_tax_type_project_scope_prep.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260731_0064_manual_invoice_direct_posting_and_retained_taxes.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260731_0064_z_manual_invoice_retention_runtime_fix.sql

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='finance_tax_types' and column_name='project_id') then
    raise exception 'Coluna finance_tax_types.project_id não criada';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='finance_tax_types' and column_name='retention_key') then
    raise exception 'Coluna finance_tax_types.retention_key não criada';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='finance_tax_types' and column_name='due_trigger') then
    raise exception 'Regra de data-base da retenção não criada';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='finance_manual_invoices' and column_name='material_receipt_id') then
    raise exception 'Vínculo da Nota Manual com recebimento não criado';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='finance_manual_invoices' and column_name='posted_at') then
    raise exception 'Data de lançamento direto não criada';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='finance_tax_obligations' and column_name='manual_invoice_id') then
    raise exception 'Vínculo da obrigação tributária com Nota Manual não criado';
  end if;
  if to_regprocedure('public.save_and_post_finance_manual_invoice(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,date,date,text,jsonb,jsonb,jsonb)') is null then
    raise exception 'Função de lançamento direto da Nota Manual não criada';
  end if;
  if to_regprocedure('public.delete_finance_manual_invoice(uuid,uuid,uuid)') is null then
    raise exception 'Função de exclusão segura da Nota Manual não criada';
  end if;
  if to_regprocedure('public.manual_invoice_mutability(uuid,uuid,uuid)') is null then
    raise exception 'Função de bloqueio de edição/exclusão não criada';
  end if;
  if to_regprocedure('public.sync_manual_invoice_retained_taxes(uuid)') is null then
    raise exception 'Geração das retenções da Nota Manual não criada';
  end if;
  if to_regprocedure('public.finance_compute_tax_due_date(uuid,date,date,date)') is null then
    raise exception 'Cálculo do vencimento tributário não criado';
  end if;
  if to_regclass('public.finance_tax_types_project_code_unique_idx') is null then
    raise exception 'Índice das regras tributárias por obra não criado';
  end if;
  if to_regclass('public.finance_tax_obligations_source_unique_idx') is null then
    raise exception 'Índice idempotente das obrigações tributárias não criado';
  end if;
  if not exists(select 1 from pg_trigger where tgname='payables_protect_manual_invoice_source' and not tgisinternal) then
    raise exception 'Proteção dos títulos gerados pela Nota Manual não criada';
  end if;
  if exists(
    select 1 from public.finance_tax_types
    where project_id is null and retention_key in('irrf','pis','cofins','csll') and due_rule<>'manual'
  ) then
    raise exception 'Retenções federais globais receberam prazo presumido sem configuração explícita';
  end if;
end $$;
SQL

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -f body='✅ Migration 0064 aplicada e validada. Notas Manuais passam a ser lançadas sem aprovação, retenções geram obrigações tributárias por regra explícita da obra e edição/exclusão ficam bloqueadas após pagamento ou vínculo com recebimento.' >/dev/null
fi
