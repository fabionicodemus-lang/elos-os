#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260801_0065_electronic_invoice_three_way_match.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260801_0065a_three_way_match_runtime_fix.sql

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='finance_electronic_invoices' and column_name='three_way_status') then
    raise exception 'Status do 3-way match não criado';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='finance_electronic_invoice_items' and column_name='invoiceable_quantity') then
    raise exception 'Saldo faturável do item não criado';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='finance_electronic_invoice_items' and column_name='previously_invoiced_quantity') then
    raise exception 'Quantidade previamente faturada não criada';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='finance_electronic_invoice_divergences' and column_name='rule_key') then
    raise exception 'Chave das regras automáticas não criada';
  end if;
  if to_regclass('public.finance_three_way_match_settings') is null then
    raise exception 'Configuração do 3-way match não criada';
  end if;
  if to_regprocedure('public.recompute_finance_electronic_invoice_three_way_match(uuid)') is null then
    raise exception 'Função de recálculo do 3-way match não criada';
  end if;
  if not exists(select 1 from pg_trigger where tgname='finance_invoice_three_way_approval_guard' and not tgisinternal) then
    raise exception 'Proteção da aprovação da NF-e não criada';
  end if;
  if not exists(select 1 from pg_trigger where tgname='finance_invoice_items_three_way_insert' and not tgisinternal) then
    raise exception 'Recálculo automático após importação não criado';
  end if;
  if not exists(select 1 from pg_trigger where tgname='finance_invoice_three_way_header_update' and not tgisinternal) then
    raise exception 'Recálculo após alteração de vínculos não criado';
  end if;
  if exists(
    select invoice_id,rule_key from public.finance_electronic_invoice_divergences
    where status='open' and rule_key like '3way:%'
    group by invoice_id,rule_key having count(*)>1
  ) then
    raise exception 'Existem divergências automáticas abertas duplicadas';
  end if;
end $$;

-- Exercita o recálculo dentro de uma transação descartável quando já houver NF-e.
begin;
do $$
declare v_id uuid;
begin
  select id into v_id from public.finance_electronic_invoices where status<>'cancelled' order by imported_at desc limit 1;
  if v_id is not null then
    perform public.recompute_finance_electronic_invoice_three_way_match(v_id);
  end if;
end $$;
rollback;
SQL

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -f body='✅ Migrations 0065 e 0065a aplicadas e validadas. A NF-e agora confere Pedido × recebimento aceito × saldo já faturado, recalcula na aprovação e bloqueia excesso de quantidade, preço ou vínculos incorretos.' >/dev/null
fi
