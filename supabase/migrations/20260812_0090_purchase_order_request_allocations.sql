-- Elos OS — Suprimentos · Rateio de itens de pedido entre solicitações
-- Um item de OC pode atender mais de um item/centro de custo da solicitação.
-- Mantém procurement_purchase_order_items.request_item_id como atalho opcional
-- para o caso simples de vínculo 1:1 e preserva a identidade da linha da OC.

begin;

create table if not exists public.procurement_purchase_order_item_request_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  purchase_order_item_id uuid not null references public.procurement_purchase_order_items(id) on delete cascade,
  request_id uuid not null references public.execution_material_requests(id) on delete restrict,
  request_item_id uuid not null references public.execution_material_request_items(id) on delete restrict,
  allocated_quantity numeric(18,6) not null,
  source_system text,
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_purchase_order_item_request_allocations_quantity_check
    check (allocated_quantity > 0),
  constraint procurement_purchase_order_item_request_allocations_source_pair_check check (
    (source_system is null and source_id is null)
    or (nullif(trim(source_system),'') is not null and nullif(trim(source_id),'') is not null)
  ),
  unique (purchase_order_item_id, request_item_id),
  unique (company_id, source_system, source_id)
);

create index if not exists procurement_purchase_order_item_request_allocations_order_item_idx
  on public.procurement_purchase_order_item_request_allocations(purchase_order_item_id);
create index if not exists procurement_purchase_order_item_request_allocations_request_item_idx
  on public.procurement_purchase_order_item_request_allocations(request_item_id);

comment on table public.procurement_purchase_order_item_request_allocations is
  'Rateio de uma linha de pedido de compra entre um ou mais itens de solicitação, preservando a linha original do pedido para recebimentos e notas.';
comment on column public.procurement_purchase_order_item_request_allocations.allocated_quantity is
  'Quantidade da linha do pedido atribuída ao item da solicitação.';
comment on column public.procurement_purchase_order_item_request_allocations.source_id is
  'Identidade estável do rateio no sistema externo; para Koper usa orderProductId:productRequestId:requestItemId.';

alter table public.procurement_purchase_order_item_request_allocations enable row level security;

drop policy if exists procurement_purchase_order_item_request_allocations_select
  on public.procurement_purchase_order_item_request_allocations;
create policy procurement_purchase_order_item_request_allocations_select
on public.procurement_purchase_order_item_request_allocations
for select to authenticated using (
  public.has_company_permission(company_id,'procurement.orders.view')
  or public.has_company_permission(company_id,'procurement.orders.manage')
  or public.has_company_permission(company_id,'procurement.orders.issue')
);

drop policy if exists procurement_purchase_order_item_request_allocations_write
  on public.procurement_purchase_order_item_request_allocations;
create policy procurement_purchase_order_item_request_allocations_write
on public.procurement_purchase_order_item_request_allocations
for all to authenticated using (
  public.has_company_permission(company_id,'procurement.orders.manage')
  or public.has_company_permission(company_id,'procurement.orders.issue')
  or public.has_company_permission(company_id,'procurement.orders.confirm')
) with check (
  public.has_company_permission(company_id,'procurement.orders.manage')
  or public.has_company_permission(company_id,'procurement.orders.issue')
  or public.has_company_permission(company_id,'procurement.orders.confirm')
);

commit;
