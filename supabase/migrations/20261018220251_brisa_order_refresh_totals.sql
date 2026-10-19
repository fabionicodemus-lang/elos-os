-- Preserve commercial totals as well as accepted-receipt status and approval guards.
begin;
create or replace function public.refresh_procurement_purchase_order(p_order_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare current_status text; next_status text; total_ordered numeric; total_accepted numeric; begin
 select status into current_status from public.procurement_purchase_orders where id=p_order_id for update;
 if current_status is null then raise exception 'Pedido de compra não encontrado.'; end if;
 select coalesce(sum(ordered_quantity-cancelled_quantity),0),coalesce(sum(accepted_quantity),0) into total_ordered,total_accepted from public.procurement_purchase_order_items where order_id=p_order_id;
 if current_status in('draft','cancelled','closed') then next_status:=current_status;
 elsif total_ordered>0 and total_accepted>=total_ordered then next_status:='received';
 elsif total_accepted>0 then next_status:='partially_received';
 elsif current_status='confirmed' then next_status:='confirmed'; else next_status:='issued'; end if;
 update public.procurement_purchase_orders o set status=next_status,
 subtotal_amount=x.subtotal,freight_amount=x.freight,tax_amount=x.tax,other_cost_amount=x.other_cost,discount_amount=x.discount,total_amount=x.total,
 received_amount=x.received,invoiced_amount=x.invoiced,updated_at=now()
 from(select p_order_id id,
 coalesce(sum(i.ordered_quantity*i.unit_price),0) subtotal,
 coalesce(sum(i.freight_amount),0) freight,
 coalesce(sum((i.ordered_quantity*i.unit_price*(1-i.discount_percent/100))*i.tax_percent/100),0) tax,
 coalesce(sum(i.other_cost_amount),0) other_cost,
 coalesce(sum(i.ordered_quantity*i.unit_price*i.discount_percent/100),0) discount,
 coalesce(sum(i.total_amount),0) total,
 coalesce(sum(i.accepted_quantity*i.delivered_unit_cost),0) received,
   coalesce((select sum(r.invoice_amount) from public.procurement_material_receipts r where r.order_id=p_order_id and r.status='approved'),0)invoiced
   from public.procurement_purchase_order_items i where i.order_id=p_order_id)x where o.id=x.id;
 return next_status;
end; $$;


create or replace function public.issue_procurement_purchase_order(p_company_id uuid,p_project_id uuid,p_order_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare o public.procurement_purchase_orders%rowtype; item record; request_item public.execution_material_request_items%rowtype; approval_enabled boolean; begin
  if not public.has_company_permission(p_company_id,'procurement.orders.issue') then raise exception 'Sem permissão para emitir pedidos.'; end if;
  select * into o from public.procurement_purchase_orders where id=p_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if o.id is null or o.status<>'draft' then raise exception 'Pedido não disponível para emissão.'; end if;
  -- Refresh authorized target before evaluating amount and approval guards.
  perform public.refresh_procurement_purchase_order(o.id);
  select * into o from public.procurement_purchase_orders where id=o.id and company_id=p_company_id and project_id=p_project_id;
  select coalesce(enabled,false) into approval_enabled from public.procurement_purchase_approval_settings where company_id=p_company_id;
  approval_enabled:=coalesce(approval_enabled,false);
  if approval_enabled and o.approval_status<>'approved' then raise exception 'O pedido precisa concluir as alçadas de aprovação antes da emissão.'; end if;
  if o.expected_delivery_date is null or nullif(trim(coalesce(o.delivery_address,'')),'') is null then raise exception 'Informe a data e o endereço de entrega antes da emissão.'; end if;
  if o.total_amount<=0 or not exists(select 1 from public.procurement_purchase_order_items where order_id=o.id) then raise exception 'O pedido precisa possuir itens e valor maior que zero.'; end if;
  for item in select * from public.procurement_purchase_order_items where order_id=o.id order by sort_order for update loop
    select * into request_item from public.execution_material_request_items where id=item.request_item_id for update;
    if request_item.id is null then raise exception 'Item de solicitação não encontrado.'; end if;
    if request_item.ordered_quantity+request_item.stock_fulfilled_quantity+item.ordered_quantity>request_item.requested_quantity+0.000001 then raise exception 'O pedido ultrapassa o saldo solicitado para %.',item.input_code; end if;
    update public.execution_material_request_items set ordered_quantity=ordered_quantity+item.ordered_quantity,updated_at=now() where id=request_item.id;
  end loop;
  update public.procurement_purchase_orders set status='issued',issue_date=current_date,issued_by=auth.uid(),issued_at=now(),updated_by=auth.uid(),updated_at=now() where id=o.id;
  insert into public.procurement_purchase_order_audit(company_id,project_id,order_id,action,previous_status,new_status,details,changed_by) values(p_company_id,p_project_id,o.id,'issued','draft','issued',jsonb_build_object('total_amount',o.total_amount,'approval_status',o.approval_status),auth.uid());
  return 'issued';
end; $$;
commit;
