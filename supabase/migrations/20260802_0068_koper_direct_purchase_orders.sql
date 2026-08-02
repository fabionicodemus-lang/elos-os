-- Elos OS — pedidos diretos importados do Koper
-- Mantém o fluxo nativo por cotação e permite preservar compras legadas sem cotação fictícia.

begin;

alter table public.procurement_purchase_orders
  alter column quotation_id drop not null,
  add column if not exists source_system text,
  add column if not exists source_id text;

alter table public.procurement_purchase_order_items
  alter column quotation_id drop not null,
  alter column quotation_item_id drop not null,
  alter column award_id drop not null,
  alter column offer_item_id drop not null,
  alter column request_id drop not null,
  alter column request_item_id drop not null,
  add column if not exists source_system text,
  add column if not exists source_id text;

alter table public.procurement_purchase_orders
  drop constraint if exists procurement_purchase_orders_source_pair_check,
  add constraint procurement_purchase_orders_source_pair_check check (
    (source_system is null and source_id is null)
    or (nullif(trim(source_system),'') is not null and nullif(trim(source_id),'') is not null)
  ),
  drop constraint if exists procurement_purchase_orders_company_source_key,
  add constraint procurement_purchase_orders_company_source_key
    unique (company_id, source_system, source_id);

alter table public.procurement_purchase_order_items
  drop constraint if exists procurement_purchase_order_items_source_pair_check,
  add constraint procurement_purchase_order_items_source_pair_check check (
    (source_system is null and source_id is null)
    or (nullif(trim(source_system),'') is not null and nullif(trim(source_id),'') is not null)
  ),
  drop constraint if exists procurement_purchase_order_items_company_source_key,
  add constraint procurement_purchase_order_items_company_source_key
    unique (company_id, source_system, source_id);

create index if not exists procurement_purchase_orders_source_idx
  on public.procurement_purchase_orders(company_id, source_system, source_id);
create index if not exists procurement_purchase_order_items_source_idx
  on public.procurement_purchase_order_items(company_id, source_system, source_id);

comment on column public.procurement_purchase_orders.source_system is
  'Sistema externo de origem; nulo para pedidos criados nativamente no Elos.';
comment on column public.procurement_purchase_order_items.source_id is
  'Identidade estável da linha no sistema externo, incluindo o rateio por solicitação quando aplicável.';

commit;
