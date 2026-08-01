-- Elos OS — correções de consolidação da Inteligência de Suprimentos

begin;

-- Preserva a apuração completa da 0066 e substitui somente o valor comprado,
-- que deve somar os itens uma única vez em vez de repetir o total do pedido por item.
do $$
begin
  if to_regclass('public.procurement_supplier_performance_raw_0066') is null then
    alter view public.procurement_supplier_performance rename to procurement_supplier_performance_raw_0066;
  else
    drop view if exists public.procurement_supplier_performance;
  end if;
end $$;

create view public.procurement_supplier_performance with (security_invoker=true) as
with corrected_order_value as (
  select
    i.company_id,
    i.project_id,
    o.supplier_id,
    coalesce(sum(i.total_amount),0) ordered_value
  from public.procurement_purchase_order_items i
  join public.procurement_purchase_orders o on o.id=i.order_id
  where o.status not in('draft','cancelled')
  group by i.company_id,i.project_id,o.supplier_id
)
select
  r.company_id,
  r.project_id,
  r.supplier_id,
  r.legal_name,
  r.trade_name,
  r.category,
  r.status,
  r.order_count,
  r.ordered_quantity,
  r.accepted_quantity,
  r.rejected_quantity,
  coalesce(c.ordered_value,0) ordered_value,
  r.receipt_count,
  r.on_time_receipts,
  r.avg_delivery_days,
  r.invoice_count,
  r.matched_invoices,
  r.invoice_item_count,
  r.conforming_price_items,
  r.discrepancy_count,
  r.resolved_discrepancy_count,
  r.avg_resolution_days,
  r.punctuality_score,
  r.completeness_score,
  r.quality_score,
  r.price_score,
  r.resolution_score,
  r.documentation_score,
  r.overall_score,
  r.classification
from public.procurement_supplier_performance_raw_0066 r
left join corrected_order_value c
  on c.company_id=r.company_id
 and c.project_id=r.project_id
 and c.supplier_id=r.supplier_id;

grant select on public.procurement_supplier_performance to authenticated;
revoke all on public.procurement_supplier_performance_raw_0066 from public;
grant select on public.procurement_supplier_performance_raw_0066 to authenticated;

commit;
