-- Elos OS — Suprimentos 9.5 · Solicitação inteligente + atendimento por estoque
-- Integra necessidade planejada, compras, estoque e solicitações sem perder rastreabilidade.

begin;

alter table public.execution_material_request_items
  add column if not exists stock_fulfilled_quantity numeric(18,6) not null default 0;

alter table public.execution_material_request_items
  drop constraint if exists execution_material_request_item_quantity_check;
alter table public.execution_material_request_items
  add constraint execution_material_request_item_quantity_check check (
    requested_quantity > 0
    and ordered_quantity >= 0
    and stock_fulfilled_quantity >= 0
    and ordered_quantity + stock_fulfilled_quantity <= requested_quantity + 0.000001
  );

alter table public.procurement_inventory_reservations
  add column if not exists request_item_id uuid references public.execution_material_request_items(id) on delete restrict;
create index if not exists procurement_inventory_reservations_request_item_idx
  on public.procurement_inventory_reservations(request_item_id,status)
  where request_item_id is not null;

-- Solicitação é considerada atendida tanto por compra quanto por estoque reservado para a frente.
create or replace function public.recalculate_execution_material_request_status(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record public.execution_material_requests%rowtype;
  total_requested numeric;
  total_fulfilled numeric;
  next_status text;
begin
  select * into request_record
  from public.execution_material_requests
  where id = p_request_id
  for update;

  if request_record.id is null then raise exception 'Solicitação de materiais não encontrada.'; end if;
  if request_record.status = 'cancelled' then return request_record.status; end if;

  select coalesce(sum(requested_quantity),0),
         coalesce(sum(ordered_quantity + stock_fulfilled_quantity),0)
    into total_requested,total_fulfilled
  from public.execution_material_request_items
  where request_id = p_request_id;

  next_status := case
    when total_requested > 0 and total_fulfilled >= total_requested - 0.000001 then 'attended'
    when total_fulfilled > 0 then 'partially_ordered'
    when request_record.approved_at is not null then 'approved'
    else 'requested'
  end;

  update public.execution_material_requests
  set status=next_status,updated_at=now()
  where id=p_request_id;
  return next_status;
end;
$$;

create or replace function public.execution_material_request_item_status_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.recalculate_execution_material_request_status(coalesce(new.request_id,old.request_id));
  return coalesce(new,old);
end;
$$;

drop trigger if exists execution_material_request_item_status on public.execution_material_request_items;
create trigger execution_material_request_item_status
after insert or update of requested_quantity,ordered_quantity,stock_fulfilled_quantity or delete
on public.execution_material_request_items
for each row execute function public.execution_material_request_item_status_trigger();

-- Reserva estoque para atender uma solicitação aprovada. A reserva protege o material até o consumo.
create or replace function public.fulfill_execution_material_request_from_stock(
  p_company_id uuid,
  p_project_id uuid,
  p_request_item_id uuid,
  p_balance_id uuid,
  p_quantity numeric,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_item public.execution_material_request_items%rowtype;
  v_request public.execution_material_requests%rowtype;
  v_balance public.procurement_inventory_balances%rowtype;
  v_remaining numeric;
  v_id uuid;
  v_plan uuid;
begin
  if not (
    public.has_company_permission(p_company_id,'procurement.inventory.issue')
    or public.has_company_permission(p_company_id,'procurement.intelligence.manage')
  ) then raise exception 'Sem permissão para atender a solicitação com estoque.'; end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'Informe uma quantidade maior que zero.'; end if;

  select * into v_item from public.execution_material_request_items
  where id=p_request_item_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_item.id is null then raise exception 'Item da solicitação não encontrado.'; end if;
  select * into v_request from public.execution_material_requests
  where id=v_item.request_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_request.id is null or v_request.status not in('approved','partially_ordered') then
    raise exception 'A solicitação precisa estar aprovada e ainda possuir saldo.';
  end if;

  v_remaining:=greatest(0,v_item.requested_quantity-v_item.ordered_quantity-v_item.stock_fulfilled_quantity);
  if p_quantity>v_remaining+0.000001 then
    raise exception 'Quantidade superior ao saldo da solicitação. Saldo: % %.',v_remaining,v_item.unit_snapshot;
  end if;

  select * into v_balance from public.procurement_inventory_balances
  where id=p_balance_id and company_id=p_company_id and project_id=p_project_id and input_id=v_item.input_id for update;
  if v_balance.id is null then raise exception 'Saldo de estoque compatível não encontrado.'; end if;
  if v_balance.available_quantity<p_quantity-0.000001 then
    raise exception 'Estoque disponível insuficiente. Disponível: % %.',v_balance.available_quantity,v_balance.unit_snapshot;
  end if;

  select c.supply_plan_item_id into v_plan
  from public.procurement_integrated_supply_control c
  where c.company_id=p_company_id and c.project_id=p_project_id and c.input_id=v_item.input_id
  limit 1;

  insert into public.procurement_inventory_reservations(
    company_id,project_id,balance_id,input_id,location_id,service_id,supply_plan_item_id,request_item_id,
    quantity,required_date,status,notes,created_by
  ) values(
    p_company_id,p_project_id,v_balance.id,v_balance.input_id,v_balance.location_id,v_item.cost_center_service_id,v_plan,v_item.id,
    p_quantity,v_request.needed_date,'active',nullif(trim(coalesce(p_notes,'')),''),auth.uid()
  ) returning id into v_id;

  update public.procurement_inventory_balances
  set reserved_quantity=reserved_quantity+p_quantity,updated_at=now()
  where id=v_balance.id;

  update public.execution_material_request_items
  set stock_fulfilled_quantity=stock_fulfilled_quantity+p_quantity,updated_at=now()
  where id=v_item.id;

  perform public.recalculate_execution_material_request_status(v_item.request_id);
  perform public.sync_supply_plan_inventory_for_input(p_project_id,v_item.input_id);
  return v_id;
end;
$$;

-- Ao liberar/cancelar uma reserva ligada à solicitação, devolve o saldo à solicitação.
-- Ao consumir, mantém o item como atendido e registra a saída física normalmente.
create or replace function public.change_procurement_inventory_reservation(
 p_company_id uuid,p_project_id uuid,p_reservation_id uuid,p_action text,p_notes text
) returns text language plpgsql security definer set search_path=public as $$
declare
 v_res public.procurement_inventory_reservations%rowtype;
 v_balance public.procurement_inventory_balances%rowtype;
 v_item public.execution_material_request_items%rowtype;
 v_movement uuid;
 v_status text;
begin
 if not public.has_company_permission(p_company_id,'procurement.intelligence.manage')
    and not public.has_company_permission(p_company_id,'procurement.inventory.issue') then
   raise exception 'Sem permissão para administrar reservas.';
 end if;
 select * into v_res from public.procurement_inventory_reservations
 where id=p_reservation_id and company_id=p_company_id and project_id=p_project_id for update;
 if v_res.id is null or v_res.status<>'active' then raise exception 'Reserva não disponível.'; end if;
 select * into v_balance from public.procurement_inventory_balances where id=v_res.balance_id for update;
 if v_balance.id is null then raise exception 'Saldo da reserva não encontrado.'; end if;

 if p_action='consume' then
  update public.procurement_inventory_balances set reserved_quantity=greatest(0,reserved_quantity-v_res.quantity),updated_at=now() where id=v_balance.id;
  v_movement:=public.post_procurement_inventory_movement(p_company_id,p_project_id,'issue',current_date,v_balance.input_id,v_balance.location_id,null,v_res.quantity,v_balance.average_unit_cost,v_balance.batch_number,v_balance.expiration_date,v_res.service_id,null,'inventory_reservation',v_res.id,'Reserva de estoque',coalesce(nullif(trim(p_notes),''),v_res.notes));
  v_status:='consumed';
  update public.procurement_inventory_reservations set status=v_status,consumed_movement_id=v_movement,released_by=auth.uid(),released_at=now(),updated_by=auth.uid(),updated_at=now() where id=v_res.id;
 elsif p_action in('release','cancel') then
  update public.procurement_inventory_balances set reserved_quantity=greatest(0,reserved_quantity-v_res.quantity),updated_at=now() where id=v_balance.id;
  v_status:=case when p_action='release' then 'released' else 'cancelled' end;
  update public.procurement_inventory_reservations set status=v_status,notes=concat_ws(E'\n',notes,nullif(trim(coalesce(p_notes,'')),'')),released_by=auth.uid(),released_at=now(),updated_by=auth.uid(),updated_at=now() where id=v_res.id;
  if v_res.request_item_id is not null then
    select * into v_item from public.execution_material_request_items where id=v_res.request_item_id for update;
    if v_item.id is not null then
      update public.execution_material_request_items
      set stock_fulfilled_quantity=greatest(0,stock_fulfilled_quantity-v_res.quantity),updated_at=now()
      where id=v_item.id;
      perform public.recalculate_execution_material_request_status(v_item.request_id);
    end if;
  end if;
 else raise exception 'Ação inválida.'; end if;
 perform public.sync_supply_plan_inventory_for_input(p_project_id,v_balance.input_id);
 return v_status;
end;
$$;

-- Cancelamento de solicitação libera reservas ainda ativas ligadas a ela.
create or replace function public.cancel_execution_material_request(
  p_company_id uuid,p_project_id uuid,p_request_id uuid,p_reason text
) returns text
language plpgsql security definer set search_path=public as $$
declare r record;
begin
  if not public.has_company_permission(p_company_id,'execution.material_requests.approve') then raise exception 'Sem permissão para cancelar solicitações de materiais.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  if not exists(select 1 from public.execution_material_requests where id=p_request_id and company_id=p_company_id and project_id=p_project_id and status not in('attended','cancelled')) then
    raise exception 'A solicitação não está disponível para cancelamento.';
  end if;

  for r in
    select res.id,res.balance_id,res.quantity,res.request_item_id,b.input_id
    from public.procurement_inventory_reservations res
    join public.procurement_inventory_balances b on b.id=res.balance_id
    join public.execution_material_request_items ri on ri.id=res.request_item_id
    where ri.request_id=p_request_id and res.status='active'
    for update of res,b,ri
  loop
    update public.procurement_inventory_balances set reserved_quantity=greatest(0,reserved_quantity-r.quantity),updated_at=now() where id=r.balance_id;
    update public.procurement_inventory_reservations set status='cancelled',notes=concat_ws(E'\n',notes,'Reserva liberada pelo cancelamento da solicitação.'),released_by=auth.uid(),released_at=now(),updated_by=auth.uid(),updated_at=now() where id=r.id;
    update public.execution_material_request_items set stock_fulfilled_quantity=greatest(0,stock_fulfilled_quantity-r.quantity),updated_at=now() where id=r.request_item_id;
    perform public.sync_supply_plan_inventory_for_input(p_project_id,r.input_id);
  end loop;

  update public.execution_material_requests set status='cancelled',cancellation_reason=trim(p_reason),cancelled_by=auth.uid(),cancelled_at=now(),updated_by=auth.uid(),updated_at=now()
  where id=p_request_id and company_id=p_company_id and project_id=p_project_id;
  return 'cancelled';
end;
$$;

-- Cotação não pode ignorar o que já foi atendido pelo estoque.
create or replace function public.save_procurement_material_quotation(
  p_company_id uuid,p_project_id uuid,p_quotation_id uuid,p_title text,p_award_mode text,
  p_response_deadline date,p_desired_delivery_date date,p_payment_terms text,p_delivery_address text,p_notes text,
  p_items jsonb,p_suppliers jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  q public.procurement_material_quotations%rowtype; request_row public.execution_material_requests%rowtype;
  request_item public.execution_material_request_items%rowtype; supplier public.suppliers%rowtype;
  item jsonb; supplier_item jsonb; resolved_id uuid; seq integer; n integer:=0; sn integer:=0; qty numeric;
begin
  if not public.has_company_permission(p_company_id,'procurement.quotations.manage') then raise exception 'Sem permissão para criar ou editar cotações.'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null then raise exception 'Informe o título da cotação.'; end if;
  if p_award_mode not in ('item','lot') then raise exception 'Forma de fechamento inválida.'; end if;
  if p_response_deadline is null or p_response_deadline<current_date then raise exception 'Informe uma data-limite igual ou posterior a hoje.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Inclua ao menos um item de solicitação.'; end if;
  if jsonb_typeof(p_suppliers)<>'array' or jsonb_array_length(p_suppliers)=0 then raise exception 'Convide ao menos um fornecedor ativo.'; end if;

  if p_quotation_id is null then
    perform pg_advisory_xact_lock(hashtext(p_project_id::text||':material-quotations'));
    select coalesce(max(sequence_no),0)+1 into seq from public.procurement_material_quotations where project_id=p_project_id;
    insert into public.procurement_material_quotations(company_id,project_id,sequence_no,quotation_number,title,award_mode,response_deadline,desired_delivery_date,payment_terms,delivery_address,notes,created_by,updated_by)
    values(p_company_id,p_project_id,seq,'COT-'||lpad(seq::text,4,'0'),trim(p_title),p_award_mode,p_response_deadline,p_desired_delivery_date,nullif(trim(coalesce(p_payment_terms,'')),''),nullif(trim(coalesce(p_delivery_address,'')),''),nullif(trim(coalesce(p_notes,'')),''),auth.uid(),auth.uid()) returning id into resolved_id;
  else
    select * into q from public.procurement_material_quotations where id=p_quotation_id and company_id=p_company_id and project_id=p_project_id for update;
    if q.id is null then raise exception 'Cotação não encontrada.'; end if;
    if q.status<>'draft' then raise exception 'Somente cotações em elaboração podem ser editadas.'; end if;
    resolved_id:=q.id;
    update public.procurement_material_quotations set title=trim(p_title),award_mode=p_award_mode,response_deadline=p_response_deadline,desired_delivery_date=p_desired_delivery_date,payment_terms=nullif(trim(coalesce(p_payment_terms,'')),''),delivery_address=nullif(trim(coalesce(p_delivery_address,'')),''),notes=nullif(trim(coalesce(p_notes,'')),''),updated_by=auth.uid(),updated_at=now() where id=resolved_id;
    delete from public.procurement_material_quotation_requests where quotation_id=resolved_id;
    delete from public.procurement_material_quotation_items where quotation_id=resolved_id;
    delete from public.procurement_material_quotation_suppliers where quotation_id=resolved_id;
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    qty:=coalesce(nullif(item->>'quantity_to_quote','')::numeric,0);
    if qty<=0 then continue; end if;
    select ri.* into request_item from public.execution_material_request_items ri join public.execution_material_requests r on r.id=ri.request_id
    where ri.id=nullif(item->>'request_item_id','')::uuid and ri.company_id=p_company_id and ri.project_id=p_project_id and r.status in('approved','partially_ordered');
    if request_item.id is null then raise exception 'Um dos itens não pertence a uma solicitação aprovada.'; end if;
    if qty>request_item.requested_quantity-request_item.ordered_quantity-request_item.stock_fulfilled_quantity+0.000001 then raise exception 'A quantidade cotada de % ultrapassa o saldo pendente.',request_item.input_code; end if;
    select * into request_row from public.execution_material_requests where id=request_item.request_id;
    insert into public.procurement_material_quotation_requests(company_id,project_id,quotation_id,request_id,request_number,needed_date)
    values(p_company_id,p_project_id,resolved_id,request_row.id,request_row.request_number,request_row.needed_date) on conflict(quotation_id,request_id) do nothing;
    n:=n+1;
    insert into public.procurement_material_quotation_items(company_id,project_id,quotation_id,request_id,request_item_id,input_id,cost_center_service_id,request_number,input_code,input_name,unit_snapshot,category_snapshot,cost_center_code,cost_center_name,requested_quantity,previously_ordered_quantity,quantity_to_quote,notes,sort_order)
    values(p_company_id,p_project_id,resolved_id,request_item.request_id,request_item.id,request_item.input_id,request_item.cost_center_service_id,request_row.request_number,request_item.input_code,request_item.input_name,request_item.unit_snapshot,request_item.category_snapshot,request_item.cost_center_code,request_item.cost_center_name,request_item.requested_quantity,request_item.ordered_quantity,qty,nullif(trim(coalesce(item->>'notes','')),''),n);
  end loop;
  if n=0 then raise exception 'Informe ao menos uma quantidade válida para cotação.'; end if;

  for supplier_item in select value from jsonb_array_elements(p_suppliers) loop
    select * into supplier from public.suppliers s where s.id=nullif(supplier_item->>'supplier_id','')::uuid and s.company_id=p_company_id and s.status='active';
    if supplier.id is null then raise exception 'Um dos fornecedores convidados não está ativo.'; end if;
    sn:=sn+1;
    insert into public.procurement_material_quotation_suppliers(company_id,project_id,quotation_id,supplier_id,supplier_name,contact_name,contact_email,contact_phone,notes)
    values(p_company_id,p_project_id,resolved_id,supplier.id,coalesce(nullif(trim(supplier.trade_name),''),supplier.legal_name),nullif(trim(coalesce(supplier_item->>'contact_name','')),''),nullif(trim(coalesce(supplier_item->>'contact_email','')),''),nullif(trim(coalesce(supplier_item->>'contact_phone','')),''),nullif(trim(coalesce(supplier_item->>'notes','')),''));
  end loop;
  if sn=0 then raise exception 'Convide ao menos um fornecedor.'; end if;
  perform public.refresh_procurement_material_quotation(resolved_id);
  insert into public.procurement_material_quotation_audit(company_id,project_id,quotation_id,action,new_status,changed_by)
  values(p_company_id,p_project_id,resolved_id,case when p_quotation_id is null then 'created' else 'updated' end,'draft',auth.uid());
  return resolved_id;
end;
$$;

-- Pedido também respeita atendimento por estoque para impedir compra acima da necessidade solicitada.
create or replace function public.issue_procurement_purchase_order(p_company_id uuid,p_project_id uuid,p_order_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare o public.procurement_purchase_orders%rowtype; item record; request_item public.execution_material_request_items%rowtype; begin
  if not public.has_company_permission(p_company_id,'procurement.orders.issue') then raise exception 'Sem permissão para emitir pedidos.'; end if;
  select * into o from public.procurement_purchase_orders where id=p_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if o.id is null or o.status<>'draft' then raise exception 'Pedido não disponível para emissão.'; end if;
  if o.expected_delivery_date is null or nullif(trim(coalesce(o.delivery_address,'')),'') is null then raise exception 'Informe a data e o endereço de entrega antes da emissão.'; end if;
  if o.total_amount<=0 or not exists(select 1 from public.procurement_purchase_order_items where order_id=o.id) then raise exception 'O pedido precisa possuir itens e valor maior que zero.'; end if;
  for item in select * from public.procurement_purchase_order_items where order_id=o.id order by sort_order for update loop
    select * into request_item from public.execution_material_request_items where id=item.request_item_id for update;
    if request_item.id is null then raise exception 'Item de solicitação não encontrado.'; end if;
    if request_item.ordered_quantity+request_item.stock_fulfilled_quantity+item.ordered_quantity>request_item.requested_quantity+0.000001 then raise exception 'O pedido ultrapassa o saldo solicitado para %.',item.input_code; end if;
    update public.execution_material_request_items set ordered_quantity=ordered_quantity+item.ordered_quantity,updated_at=now() where id=request_item.id;
  end loop;
  update public.procurement_purchase_orders set status='issued',issue_date=current_date,issued_by=auth.uid(),issued_at=now(),updated_by=auth.uid(),updated_at=now() where id=o.id;
  insert into public.procurement_purchase_order_audit(company_id,project_id,order_id,action,previous_status,new_status,details,changed_by) values(p_company_id,p_project_id,o.id,'issued','draft','issued',jsonb_build_object('total_amount',o.total_amount),auth.uid());
  return 'issued';
end;
$$;

grant execute on function public.fulfill_execution_material_request_from_stock(uuid,uuid,uuid,uuid,numeric,text) to authenticated;
grant execute on function public.change_procurement_inventory_reservation(uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.cancel_execution_material_request(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.save_procurement_material_quotation(uuid,uuid,uuid,text,text,date,date,text,text,text,jsonb,jsonb) to authenticated;
grant execute on function public.issue_procurement_purchase_order(uuid,uuid,uuid) to authenticated;

commit;
