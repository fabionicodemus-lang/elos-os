#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

MIGRATION="supabase/migrations/20260812_0090_purchase_order_request_allocations.sql"

echo "Aplicando Supabase 0090: rateio de itens de OC entre solicitações."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION"

echo "Validando estrutura da migration 0090..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regclass('public.procurement_purchase_order_item_request_allocations') is null then
    raise exception '0090: tabela de rateio não foi criada.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='procurement_purchase_order_item_request_allocations'
      and column_name='allocated_quantity'
      and data_type='numeric'
  ) then
    raise exception '0090: coluna allocated_quantity ausente ou inválida.';
  end if;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.procurement_purchase_order_item_request_allocations'::regclass
      and c.contype='f'
      and c.confrelid='public.procurement_purchase_order_items'::regclass
  ) then
    raise exception '0090: FK para procurement_purchase_order_items ausente.';
  end if;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.procurement_purchase_order_item_request_allocations'::regclass
      and c.contype='f'
      and c.confrelid='public.execution_material_request_items'::regclass
  ) then
    raise exception '0090: FK para execution_material_request_items ausente.';
  end if;

  if not exists (
    select 1 from pg_class
    where oid='public.procurement_purchase_order_item_request_allocations'::regclass
      and relrowsecurity=true
  ) then
    raise exception '0090: RLS não está habilitado.';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='procurement_purchase_order_item_request_allocations'
      and policyname='procurement_purchase_order_item_request_allocations_select'
  ) then
    raise exception '0090: policy de leitura ausente.';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='procurement_purchase_order_item_request_allocations'
      and policyname='procurement_purchase_order_item_request_allocations_write'
  ) then
    raise exception '0090: policy de escrita ausente.';
  end if;
end $$;

select
  count(*) as allocation_rows
from public.procurement_purchase_order_item_request_allocations;
SQL

echo "Supabase 0090 aplicado e validado com sucesso."
