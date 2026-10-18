-- Qualify shared offer/item cost columns without changing privileges or business rules.
begin;
create or replace function public.refresh_procurement_material_quotation(p_quotation_id uuid)
returns void
language plpgsql security definer set search_path=public as $$
begin
  update public.procurement_material_quotation_items qi
  set best_delivered_unit_cost=x.best_unit,
      best_total_cost=x.best_total,
      updated_at=now()
  from (
    select oi.quotation_item_id,min(oi.delivered_unit_cost) best_unit,min(oi.total_delivered_cost) best_total
    from public.procurement_material_quotation_offer_items oi
    join public.procurement_material_quotation_offers o on o.id=oi.offer_id
    where oi.quotation_id=p_quotation_id and oi.meets_specification and o.status='received'
    group by oi.quotation_item_id
  ) x where qi.id=x.quotation_item_id;

  update public.procurement_material_quotation_items qi
  set best_delivered_unit_cost=null,best_total_cost=null,updated_at=now()
  where qi.quotation_id=p_quotation_id and not exists(
    select 1 from public.procurement_material_quotation_offer_items oi
    join public.procurement_material_quotation_offers o on o.id=oi.offer_id
    where oi.quotation_item_id=qi.id and oi.meets_specification and o.status='received'
  );

  update public.procurement_material_quotations q
  set invited_suppliers_count=(select count(*) from public.procurement_material_quotation_suppliers qs where qs.quotation_id=q.id),
      responses_count=(select count(*) from public.procurement_material_quotation_suppliers qs where qs.quotation_id=q.id and qs.status='responded'),
      total_awarded_amount=(select coalesce(sum(a.awarded_total_cost),0) from public.procurement_material_quotation_awards a where a.quotation_id=q.id),
      updated_at=now()
  where q.id=p_quotation_id;
end; $$;


commit;
