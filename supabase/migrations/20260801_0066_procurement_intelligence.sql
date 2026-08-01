-- Elos OS — V0.69.0 · Inteligência de Suprimentos
-- Integra orçamento, cronograma, solicitações, compras, estoque, fornecedores e indicadores.

begin;

insert into public.permissions(key,module,action,description) values
 ('procurement.intelligence.view','procurement_intelligence','view','Visualizar controle integrado, desempenho de fornecedores e indicadores'),
 ('procurement.intelligence.manage','procurement_intelligence','manage','Reservar estoque, transferir entre obras e administrar parâmetros de suprimentos')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true
from public.roles r cross join(values('procurement.intelligence.view'),('procurement.intelligence.manage'))p(permission_key)
where r.key in('owner','admin','director','procurement')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'procurement.intelligence.view',true
from public.roles r where r.key in('engineering','finance','field','viewer')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

create table if not exists public.procurement_inventory_reservations (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 balance_id uuid not null references public.procurement_inventory_balances(id) on delete restrict,
 input_id uuid not null references public.engineering_inputs(id) on delete restrict,
 location_id uuid not null references public.procurement_inventory_locations(id) on delete restrict,
 service_id uuid references public.engineering_services(id) on delete restrict,
 supply_plan_item_id uuid references public.engineering_supply_plan_items(id) on delete set null,
 quantity numeric(18,6) not null check(quantity>0),
 required_date date,
 status text not null default 'active' check(status in('active','released','consumed','cancelled')),
 notes text,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now(),
 released_by uuid references auth.users(id),
 released_at timestamptz,
 consumed_movement_id uuid references public.procurement_inventory_movements(id) on delete set null
);
create index if not exists procurement_inventory_reservations_project_idx on public.procurement_inventory_reservations(project_id,status,required_date);
create index if not exists procurement_inventory_reservations_balance_idx on public.procurement_inventory_reservations(balance_id,status);

create table if not exists public.procurement_cross_project_transfers (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 from_project_id uuid not null references public.projects(id) on delete restrict,
 to_project_id uuid not null references public.projects(id) on delete restrict,
 from_balance_id uuid not null references public.procurement_inventory_balances(id) on delete restrict,
 to_location_id uuid not null references public.procurement_inventory_locations(id) on delete restrict,
 input_id uuid not null references public.engineering_inputs(id) on delete restrict,
 quantity numeric(18,6) not null check(quantity>0),
 unit_cost numeric(18,6) not null default 0,
 status text not null default 'posted' check(status in('posted','cancelled')),
 source_movement_id uuid references public.procurement_inventory_movements(id) on delete restrict,
 destination_movement_id uuid references public.procurement_inventory_movements(id) on delete restrict,
 notes text,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 constraint procurement_cross_project_transfer_projects_check check(from_project_id<>to_project_id)
);
create index if not exists procurement_cross_project_transfers_company_idx on public.procurement_cross_project_transfers(company_id,created_at desc);

alter table public.procurement_inventory_reservations enable row level security;
alter table public.procurement_cross_project_transfers enable row level security;

drop policy if exists procurement_inventory_reservations_select on public.procurement_inventory_reservations;
create policy procurement_inventory_reservations_select on public.procurement_inventory_reservations for select to authenticated
using(public.has_company_permission(company_id,'procurement.intelligence.view'));
drop policy if exists procurement_inventory_reservations_write on public.procurement_inventory_reservations;
create policy procurement_inventory_reservations_write on public.procurement_inventory_reservations for all to authenticated
using(public.has_company_permission(company_id,'procurement.intelligence.manage'))
with check(public.has_company_permission(company_id,'procurement.intelligence.manage'));

drop policy if exists procurement_cross_project_transfers_select on public.procurement_cross_project_transfers;
create policy procurement_cross_project_transfers_select on public.procurement_cross_project_transfers for select to authenticated
using(public.has_company_permission(company_id,'procurement.intelligence.view'));
drop policy if exists procurement_cross_project_transfers_write on public.procurement_cross_project_transfers;
create policy procurement_cross_project_transfers_write on public.procurement_cross_project_transfers for all to authenticated
using(public.has_company_permission(company_id,'procurement.intelligence.manage'))
with check(public.has_company_permission(company_id,'procurement.intelligence.manage'));

create or replace function public.sync_supply_plan_inventory_for_input(p_project_id uuid,p_input_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_available numeric;
begin
 select coalesce(sum(available_quantity),0) into v_available
 from public.procurement_inventory_balances where project_id=p_project_id and input_id=p_input_id;
 update public.engineering_supply_plan_items
 set available_stock=v_available,
     purchase_quantity=greatest(0,required_quantity-v_available),
     planned_total_cost=round(greatest(0,required_quantity-v_available)*planned_unit_cost,2),
     updated_at=now()
 where project_id=p_project_id and input_id=p_input_id and record_status='active';
end;
$$;

create or replace function public.trigger_sync_supply_plan_inventory()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='DELETE' then
  perform public.sync_supply_plan_inventory_for_input(old.project_id,old.input_id);
  return old;
 end if;
 perform public.sync_supply_plan_inventory_for_input(new.project_id,new.input_id);
 if tg_op='UPDATE' and (old.project_id<>new.project_id or old.input_id<>new.input_id) then
  perform public.sync_supply_plan_inventory_for_input(old.project_id,old.input_id);
 end if;
 return new;
end;
$$;

drop trigger if exists procurement_balance_sync_supply_plan on public.procurement_inventory_balances;
create trigger procurement_balance_sync_supply_plan
after insert or update of quantity_on_hand,reserved_quantity,average_unit_cost or delete
on public.procurement_inventory_balances for each row execute function public.trigger_sync_supply_plan_inventory();

create or replace function public.save_procurement_inventory_reservation(
 p_company_id uuid,p_project_id uuid,p_reservation_id uuid,p_balance_id uuid,p_service_id uuid,p_supply_plan_item_id uuid,
 p_quantity numeric,p_required_date date,p_notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_balance public.procurement_inventory_balances%rowtype; v_res public.procurement_inventory_reservations%rowtype; v_delta numeric; v_id uuid;
begin
 if not public.has_company_permission(p_company_id,'procurement.intelligence.manage') then raise exception 'Sem permissão para reservar estoque.'; end if;
 if coalesce(p_quantity,0)<=0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
 select * into v_balance from public.procurement_inventory_balances
 where id=p_balance_id and company_id=p_company_id and project_id=p_project_id for update;
 if v_balance.id is null then raise exception 'Saldo de estoque não encontrado.'; end if;
 if p_service_id is not null and not exists(select 1 from public.engineering_services where id=p_service_id and company_id=p_company_id and status='active') then raise exception 'Serviço inválido.'; end if;
 if p_supply_plan_item_id is not null and not exists(select 1 from public.engineering_supply_plan_items where id=p_supply_plan_item_id and company_id=p_company_id and project_id=p_project_id and input_id=v_balance.input_id and record_status='active') then raise exception 'Item do planejamento inválido.'; end if;
 if p_reservation_id is null then
  if v_balance.available_quantity<p_quantity-0.000001 then raise exception 'Saldo disponível insuficiente. Disponível: % %.',v_balance.available_quantity,v_balance.unit_snapshot; end if;
  insert into public.procurement_inventory_reservations(company_id,project_id,balance_id,input_id,location_id,service_id,supply_plan_item_id,quantity,required_date,notes,created_by)
  values(p_company_id,p_project_id,v_balance.id,v_balance.input_id,v_balance.location_id,p_service_id,p_supply_plan_item_id,p_quantity,p_required_date,nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id into v_id;
  update public.procurement_inventory_balances set reserved_quantity=reserved_quantity+p_quantity,updated_at=now() where id=v_balance.id;
 else
  select * into v_res from public.procurement_inventory_reservations where id=p_reservation_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_res.id is null or v_res.status<>'active' then raise exception 'Reserva não disponível para edição.'; end if;
  if v_res.balance_id<>v_balance.id then raise exception 'Não é possível trocar o lote/local de uma reserva. Libere e crie outra.'; end if;
  v_delta:=p_quantity-v_res.quantity;
  if v_delta>0 and v_balance.available_quantity<v_delta-0.000001 then raise exception 'Saldo disponível insuficiente para ampliar a reserva.'; end if;
  update public.procurement_inventory_balances set reserved_quantity=reserved_quantity+v_delta,updated_at=now() where id=v_balance.id;
  update public.procurement_inventory_reservations set service_id=p_service_id,supply_plan_item_id=p_supply_plan_item_id,quantity=p_quantity,required_date=p_required_date,notes=nullif(trim(coalesce(p_notes,'')),''),updated_by=auth.uid(),updated_at=now() where id=v_res.id returning id into v_id;
 end if;
 perform public.sync_supply_plan_inventory_for_input(p_project_id,v_balance.input_id);
 return v_id;
end;
$$;

create or replace function public.change_procurement_inventory_reservation(
 p_company_id uuid,p_project_id uuid,p_reservation_id uuid,p_action text,p_notes text
) returns text language plpgsql security definer set search_path=public as $$
declare v_res public.procurement_inventory_reservations%rowtype; v_balance public.procurement_inventory_balances%rowtype; v_movement uuid; v_status text;
begin
 if not public.has_company_permission(p_company_id,'procurement.intelligence.manage') then raise exception 'Sem permissão para administrar reservas.'; end if;
 select * into v_res from public.procurement_inventory_reservations where id=p_reservation_id and company_id=p_company_id and project_id=p_project_id for update;
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
 else raise exception 'Ação inválida.'; end if;
 perform public.sync_supply_plan_inventory_for_input(p_project_id,v_balance.input_id);
 return v_status;
end;
$$;

create or replace function public.transfer_procurement_inventory_between_projects(
 p_company_id uuid,p_from_project_id uuid,p_to_project_id uuid,p_from_balance_id uuid,p_to_location_id uuid,p_quantity numeric,p_notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_balance public.procurement_inventory_balances%rowtype; v_to_location public.procurement_inventory_locations%rowtype; v_id uuid; v_out uuid; v_in uuid;
begin
 if not public.has_company_permission(p_company_id,'procurement.intelligence.manage') then raise exception 'Sem permissão para transferir entre obras.'; end if;
 if p_from_project_id=p_to_project_id then raise exception 'Escolha obras diferentes.'; end if;
 if coalesce(p_quantity,0)<=0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
 select * into v_balance from public.procurement_inventory_balances where id=p_from_balance_id and company_id=p_company_id and project_id=p_from_project_id for update;
 if v_balance.id is null or v_balance.available_quantity<p_quantity-0.000001 then raise exception 'Saldo disponível insuficiente na obra de origem.'; end if;
 select * into v_to_location from public.procurement_inventory_locations where id=p_to_location_id and company_id=p_company_id and project_id=p_to_project_id and status='active';
 if v_to_location.id is null then raise exception 'Local da obra de destino inválido.'; end if;
 insert into public.procurement_cross_project_transfers(company_id,from_project_id,to_project_id,from_balance_id,to_location_id,input_id,quantity,unit_cost,notes,created_by)
 values(p_company_id,p_from_project_id,p_to_project_id,v_balance.id,v_to_location.id,v_balance.input_id,p_quantity,v_balance.average_unit_cost,nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id into v_id;
 v_out:=public.post_procurement_inventory_movement(p_company_id,p_from_project_id,'adjustment_out',current_date,v_balance.input_id,v_balance.location_id,null,p_quantity,v_balance.average_unit_cost,v_balance.batch_number,v_balance.expiration_date,null,null,'cross_project_transfer',v_id,'Transferência para outra obra',p_notes);
 v_in:=public.post_procurement_inventory_movement(p_company_id,p_to_project_id,'adjustment_in',current_date,v_balance.input_id,null,v_to_location.id,p_quantity,v_balance.average_unit_cost,v_balance.batch_number,v_balance.expiration_date,null,null,'cross_project_transfer',v_id,'Transferência recebida de outra obra',p_notes);
 update public.procurement_cross_project_transfers set source_movement_id=v_out,destination_movement_id=v_in where id=v_id;
 perform public.sync_supply_plan_inventory_for_input(p_from_project_id,v_balance.input_id);
 perform public.sync_supply_plan_inventory_for_input(p_to_project_id,v_balance.input_id);
 return v_id;
end;
$$;

create or replace view public.procurement_integrated_supply_control with (security_invoker=true) as
with plan as (
 select distinct on(spi.company_id,spi.project_id,spi.input_id)
  spi.company_id,spi.project_id,spi.id supply_plan_item_id,spi.baseline_id,spi.input_id,spi.code,spi.name,spi.unit_snapshot,spi.category_snapshot,
  spi.required_quantity,spi.planned_unit_cost,spi.planned_total_cost,spi.first_use_date,spi.quotation_start,spi.order_deadline,spi.delivery_deadline
 from public.engineering_supply_plan_items spi
 join public.engineering_schedule_baselines b on b.id=spi.baseline_id
 where spi.record_status='active' and spi.status<>'canceled' and b.status<>'archived'
 order by spi.company_id,spi.project_id,spi.input_id,case when b.status='approved' then 0 else 1 end,b.updated_at desc,spi.updated_at desc
), requests as (
 select i.company_id,i.project_id,i.input_id,sum(i.requested_quantity) requested_quantity,sum(i.ordered_quantity) requested_ordered_quantity
 from public.execution_material_request_items i join public.execution_material_requests r on r.id=i.request_id
 where r.status<>'cancelled' group by i.company_id,i.project_id,i.input_id
), orders as (
 select i.company_id,i.project_id,i.input_id,
  sum(greatest(0,i.ordered_quantity-i.cancelled_quantity)) ordered_quantity,
  sum(i.accepted_quantity) received_quantity,sum(i.rejected_quantity) rejected_quantity,
  sum(i.total_amount) ordered_value,sum(i.accepted_quantity*i.delivered_unit_cost) received_value
 from public.procurement_purchase_order_items i join public.procurement_purchase_orders o on o.id=i.order_id
 where o.status not in('draft','cancelled') group by i.company_id,i.project_id,i.input_id
), stock as (
 select company_id,project_id,input_id,sum(quantity_on_hand) on_hand_quantity,sum(reserved_quantity) reserved_quantity,
  sum(available_quantity) available_quantity,sum(total_value) stock_value,sum(minimum_quantity) minimum_quantity,sum(coalesce(maximum_quantity,0)) maximum_quantity
 from public.procurement_inventory_balances group by company_id,project_id,input_id
), consumption as (
 select company_id,project_id,input_id,
 sum(case when movement_type='issue' then quantity when movement_type='return_to_stock' then -quantity else 0 end) consumed_quantity
 from public.procurement_inventory_movements where movement_type in('issue','return_to_stock') group by company_id,project_id,input_id
), invoices as (
 select i.company_id,i.project_id,i.input_id,sum(i.quantity) invoiced_quantity,sum(i.total_amount) invoiced_value
 from public.finance_electronic_invoice_items i join public.finance_electronic_invoices n on n.id=i.invoice_id
 where n.status='approved' group by i.company_id,i.project_id,i.input_id
)
select p.*,
 coalesce(r.requested_quantity,0) requested_quantity,coalesce(r.requested_ordered_quantity,0) request_converted_quantity,
 coalesce(o.ordered_quantity,0) ordered_quantity,coalesce(o.received_quantity,0) received_quantity,coalesce(o.rejected_quantity,0) rejected_quantity,
 coalesce(i.invoiced_quantity,0) invoiced_quantity,coalesce(c.consumed_quantity,0) consumed_quantity,
 coalesce(s.on_hand_quantity,0) on_hand_quantity,coalesce(s.reserved_quantity,0) reserved_quantity,coalesce(s.available_quantity,0) available_quantity,
 coalesce(s.minimum_quantity,0) minimum_quantity,coalesce(s.maximum_quantity,0) maximum_quantity,
 greatest(0,coalesce(o.ordered_quantity,0)-coalesce(o.received_quantity,0)) outstanding_order_quantity,
 greatest(0,p.required_quantity-coalesce(c.consumed_quantity,0)-coalesce(s.on_hand_quantity,0)-greatest(0,coalesce(o.ordered_quantity,0)-coalesce(o.received_quantity,0))) remaining_to_buy_quantity,
 greatest(
  greatest(0,p.required_quantity-coalesce(c.consumed_quantity,0)-coalesce(s.on_hand_quantity,0)-greatest(0,coalesce(o.ordered_quantity,0)-coalesce(o.received_quantity,0))),
  greatest(0,coalesce(s.minimum_quantity,0)-coalesce(s.available_quantity,0)-greatest(0,coalesce(o.ordered_quantity,0)-coalesce(o.received_quantity,0)))
 ) suggested_purchase_quantity,
 coalesce(o.ordered_value,0) ordered_value,coalesce(o.received_value,0) received_value,coalesce(i.invoiced_value,0) invoiced_value,coalesce(s.stock_value,0) stock_value,
 p.planned_total_cost-coalesce(o.ordered_value,0) budget_balance,
 case
  when greatest(0,p.required_quantity-coalesce(c.consumed_quantity,0)-coalesce(s.on_hand_quantity,0)-greatest(0,coalesce(o.ordered_quantity,0)-coalesce(o.received_quantity,0)))<=0 then 'covered'
  when p.first_use_date<current_date then 'rupture'
  when p.delivery_deadline<current_date then 'critical'
  when p.order_deadline<=current_date then 'order_now'
  when p.quotation_start<=current_date then 'quote_now'
  else 'planned' end coverage_status
from plan p
left join requests r using(company_id,project_id,input_id)
left join orders o using(company_id,project_id,input_id)
left join stock s using(company_id,project_id,input_id)
left join consumption c using(company_id,project_id,input_id)
left join invoices i using(company_id,project_id,input_id);

create or replace view public.procurement_supplier_performance with (security_invoker=true) as
with order_stats as (
 select o.company_id,o.project_id,o.supplier_id,count(distinct o.id) order_count,
  sum(greatest(0,i.ordered_quantity-i.cancelled_quantity)) ordered_quantity,
  sum(i.accepted_quantity) accepted_quantity,sum(i.rejected_quantity) rejected_quantity,sum(o.total_amount) ordered_value
 from public.procurement_purchase_orders o left join public.procurement_purchase_order_items i on i.order_id=o.id
 where o.status not in('draft','cancelled') group by o.company_id,o.project_id,o.supplier_id
), receipt_stats as (
 select r.company_id,r.project_id,r.supplier_id,count(distinct r.id) receipt_count,
  count(distinct r.id) filter(where r.status='approved' and (o.expected_delivery_date is null or r.receipt_date<=o.expected_delivery_date)) on_time_receipts,
  avg(case when r.status='approved' and o.issue_date is not null then r.receipt_date-o.issue_date end) avg_delivery_days
 from public.procurement_material_receipts r join public.procurement_purchase_orders o on o.id=r.order_id
 where r.status='approved' group by r.company_id,r.project_id,r.supplier_id
), invoice_stats as (
 select n.company_id,n.project_id,n.supplier_id,count(distinct n.id) invoice_count,
  count(distinct n.id) filter(where n.three_way_status='ready') matched_invoices,
  count(i.id) item_count,count(i.id) filter(where abs(coalesce(i.unit_price_variance,0))<=greatest(.01,abs(coalesce(i.order_unit_price,0))*.001)) conforming_price_items
 from public.finance_electronic_invoices n left join public.finance_electronic_invoice_items i on i.invoice_id=n.id
 where n.status in('review','approved') group by n.company_id,n.project_id,n.supplier_id
), receipt_div as (
 select r.company_id,r.project_id,r.supplier_id,count(d.id) discrepancy_count,
  count(d.id) filter(where d.status in('resolved','waived')) resolved_count,
  avg(extract(epoch from(coalesce(d.resolved_at,now())-d.created_at))/86400.0) filter(where d.status in('resolved','waived')) avg_resolution_days
 from public.procurement_material_receipts r join public.procurement_material_receipt_discrepancies d on d.receipt_id=r.id
 group by r.company_id,r.project_id,r.supplier_id
), invoice_div as (
 select n.company_id,n.project_id,n.supplier_id,count(d.id) discrepancy_count,
  count(d.id) filter(where d.status in('resolved','waived')) resolved_count,
  avg(extract(epoch from(coalesce(d.resolved_at,now())-d.created_at))/86400.0) filter(where d.status in('resolved','waived')) avg_resolution_days
 from public.finance_electronic_invoices n join public.finance_electronic_invoice_divergences d on d.invoice_id=n.id
 group by n.company_id,n.project_id,n.supplier_id
), base as (
 select s.company_id,p.id project_id,s.id supplier_id,s.legal_name,s.trade_name,s.category,s.status,
  coalesce(o.order_count,0) order_count,coalesce(o.ordered_quantity,0) ordered_quantity,coalesce(o.accepted_quantity,0) accepted_quantity,coalesce(o.rejected_quantity,0) rejected_quantity,coalesce(o.ordered_value,0) ordered_value,
  coalesce(r.receipt_count,0) receipt_count,coalesce(r.on_time_receipts,0) on_time_receipts,r.avg_delivery_days,
  coalesce(n.invoice_count,0) invoice_count,coalesce(n.matched_invoices,0) matched_invoices,coalesce(n.item_count,0) invoice_item_count,coalesce(n.conforming_price_items,0) conforming_price_items,
  coalesce(rd.discrepancy_count,0)+coalesce(nd.discrepancy_count,0) discrepancy_count,
  coalesce(rd.resolved_count,0)+coalesce(nd.resolved_count,0) resolved_discrepancy_count,
  case when coalesce(rd.resolved_count,0)+coalesce(nd.resolved_count,0)>0 then
   (coalesce(rd.avg_resolution_days,0)*coalesce(rd.resolved_count,0)+coalesce(nd.avg_resolution_days,0)*coalesce(nd.resolved_count,0))/(coalesce(rd.resolved_count,0)+coalesce(nd.resolved_count,0)) end avg_resolution_days
 from public.suppliers s cross join public.projects p
 left join order_stats o on o.company_id=s.company_id and o.project_id=p.id and o.supplier_id=s.id
 left join receipt_stats r on r.company_id=s.company_id and r.project_id=p.id and r.supplier_id=s.id
 left join invoice_stats n on n.company_id=s.company_id and n.project_id=p.id and n.supplier_id=s.id
 left join receipt_div rd on rd.company_id=s.company_id and rd.project_id=p.id and rd.supplier_id=s.id
 left join invoice_div nd on nd.company_id=s.company_id and nd.project_id=p.id and nd.supplier_id=s.id
 where p.company_id=s.company_id and p.status<>'archived'
)
select b.*,
 case when receipt_count>0 then round(100.0*on_time_receipts/receipt_count,1) else 50 end punctuality_score,
 case when ordered_quantity>0 then round(100.0*least(1,accepted_quantity/ordered_quantity),1) else 50 end completeness_score,
 case when accepted_quantity+rejected_quantity>0 then round(100.0*accepted_quantity/(accepted_quantity+rejected_quantity),1) else 50 end quality_score,
 case when invoice_item_count>0 then round(100.0*conforming_price_items/invoice_item_count,1) else 50 end price_score,
 case when discrepancy_count>0 then round(100.0*resolved_discrepancy_count/discrepancy_count,1) else 100 end resolution_score,
 case when invoice_count>0 then round(100.0*matched_invoices/invoice_count,1) else 50 end documentation_score,
 case when order_count=0 then null else round(
  .30*(case when receipt_count>0 then 100.0*on_time_receipts/receipt_count else 50 end)+
  .20*(case when ordered_quantity>0 then 100.0*least(1,accepted_quantity/ordered_quantity) else 50 end)+
  .20*(case when accepted_quantity+rejected_quantity>0 then 100.0*accepted_quantity/(accepted_quantity+rejected_quantity) else 50 end)+
  .15*(case when invoice_item_count>0 then 100.0*conforming_price_items/invoice_item_count else 50 end)+
  .10*(case when discrepancy_count>0 then 100.0*resolved_discrepancy_count/discrepancy_count else 100 end)+
  .05*(case when invoice_count>0 then 100.0*matched_invoices/invoice_count else 50 end),1) end overall_score,
 case when order_count=0 then 'Sem histórico'
  when (.30*(case when receipt_count>0 then 100.0*on_time_receipts/receipt_count else 50 end)+.20*(case when ordered_quantity>0 then 100.0*least(1,accepted_quantity/ordered_quantity) else 50 end)+.20*(case when accepted_quantity+rejected_quantity>0 then 100.0*accepted_quantity/(accepted_quantity+rejected_quantity) else 50 end)+.15*(case when invoice_item_count>0 then 100.0*conforming_price_items/invoice_item_count else 50 end)+.10*(case when discrepancy_count>0 then 100.0*resolved_discrepancy_count/discrepancy_count else 100 end)+.05*(case when invoice_count>0 then 100.0*matched_invoices/invoice_count else 50 end))>=90 then 'Excelente'
  when (.30*(case when receipt_count>0 then 100.0*on_time_receipts/receipt_count else 50 end)+.20*(case when ordered_quantity>0 then 100.0*least(1,accepted_quantity/ordered_quantity) else 50 end)+.20*(case when accepted_quantity+rejected_quantity>0 then 100.0*accepted_quantity/(accepted_quantity+rejected_quantity) else 50 end)+.15*(case when invoice_item_count>0 then 100.0*conforming_price_items/invoice_item_count else 50 end)+.10*(case when discrepancy_count>0 then 100.0*resolved_discrepancy_count/discrepancy_count else 100 end)+.05*(case when invoice_count>0 then 100.0*matched_invoices/invoice_count else 50 end))>=75 then 'Bom'
  when (.30*(case when receipt_count>0 then 100.0*on_time_receipts/receipt_count else 50 end)+.20*(case when ordered_quantity>0 then 100.0*least(1,accepted_quantity/ordered_quantity) else 50 end)+.20*(case when accepted_quantity+rejected_quantity>0 then 100.0*accepted_quantity/(accepted_quantity+rejected_quantity) else 50 end)+.15*(case when invoice_item_count>0 then 100.0*conforming_price_items/invoice_item_count else 50 end)+.10*(case when discrepancy_count>0 then 100.0*resolved_discrepancy_count/discrepancy_count else 100 end)+.05*(case when invoice_count>0 then 100.0*matched_invoices/invoice_count else 50 end))>=60 then 'Atenção' else 'Crítico' end classification
from base b;

grant select,insert,update,delete on public.procurement_inventory_reservations,public.procurement_cross_project_transfers to authenticated;
grant select on public.procurement_integrated_supply_control,public.procurement_supplier_performance to authenticated;
grant execute on function public.save_procurement_inventory_reservation(uuid,uuid,uuid,uuid,uuid,uuid,numeric,date,text) to authenticated;
grant execute on function public.change_procurement_inventory_reservation(uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.transfer_procurement_inventory_between_projects(uuid,uuid,uuid,uuid,uuid,numeric,text) to authenticated;

-- Normaliza o planejamento existente com o estoque real.
do $$ declare r record; begin
 for r in select distinct project_id,input_id from public.engineering_supply_plan_items where record_status='active' loop
  perform public.sync_supply_plan_inventory_for_input(r.project_id,r.input_id);
 end loop;
end $$;

commit;
