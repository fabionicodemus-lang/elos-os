-- Elos OS — Suprimentos · Pedidos de Compras
-- Conversão dos vencedores das cotações em compromissos de compra por fornecedor.

begin;

create table if not exists public.procurement_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  quotation_id uuid not null references public.procurement_material_quotations(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  sequence_no integer not null,
  order_number text not null,
  status text not null default 'draft' check (status in ('draft','issued','confirmed','partially_received','received','closed','cancelled')),
  issue_date date,
  expected_delivery_date date,
  delivery_address text,
  payment_terms text,
  freight_terms text,
  warranty_terms text,
  supplier_contact_name text,
  supplier_contact_email text,
  supplier_contact_phone text,
  buyer_name text,
  subtotal_amount numeric(18,2) not null default 0,
  freight_amount numeric(18,2) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  other_cost_amount numeric(18,2) not null default 0,
  discount_amount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  received_amount numeric(18,2) not null default 0,
  invoiced_amount numeric(18,2) not null default 0,
  notes text,
  supplier_notes text,
  issued_by uuid references auth.users(id),
  issued_at timestamptz,
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  supplier_confirmation_reference text,
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, sequence_no),
  unique (project_id, order_number),
  unique (quotation_id, supplier_id),
  constraint procurement_purchase_order_values_check check (
    subtotal_amount >= 0 and freight_amount >= 0 and tax_amount >= 0 and other_cost_amount >= 0 and discount_amount >= 0 and
    total_amount >= 0 and received_amount >= 0 and invoiced_amount >= 0
  ),
  constraint procurement_purchase_order_cancel_check check (
    status <> 'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null
  )
);

create table if not exists public.procurement_purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  order_id uuid not null references public.procurement_purchase_orders(id) on delete cascade,
  quotation_id uuid not null references public.procurement_material_quotations(id) on delete restrict,
  quotation_item_id uuid not null references public.procurement_material_quotation_items(id) on delete restrict,
  award_id uuid not null references public.procurement_material_quotation_awards(id) on delete restrict,
  offer_item_id uuid not null references public.procurement_material_quotation_offer_items(id) on delete restrict,
  request_id uuid not null references public.execution_material_requests(id) on delete restrict,
  request_item_id uuid not null references public.execution_material_request_items(id) on delete restrict,
  input_id uuid not null references public.engineering_inputs(id) on delete restrict,
  cost_center_service_id uuid references public.engineering_services(id) on delete restrict,
  request_number text not null,
  input_code text not null,
  input_name text not null,
  unit_snapshot text not null,
  cost_center_code text not null,
  cost_center_name text not null,
  brand text,
  manufacturer text,
  ordered_quantity numeric(18,6) not null,
  received_quantity numeric(18,6) not null default 0,
  accepted_quantity numeric(18,6) not null default 0,
  rejected_quantity numeric(18,6) not null default 0,
  cancelled_quantity numeric(18,6) not null default 0,
  unit_price numeric(18,6) not null,
  discount_percent numeric(8,4) not null default 0 check (discount_percent between 0 and 100),
  tax_percent numeric(8,4) not null default 0 check (tax_percent between 0 and 100),
  freight_amount numeric(18,2) not null default 0,
  other_cost_amount numeric(18,2) not null default 0,
  delivered_unit_cost numeric(18,6) not null,
  total_amount numeric(18,2) not null,
  expected_delivery_date date,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (award_id),
  constraint procurement_purchase_order_item_values_check check (
    ordered_quantity > 0 and received_quantity >= 0 and accepted_quantity >= 0 and rejected_quantity >= 0 and cancelled_quantity >= 0 and
    received_quantity <= ordered_quantity + 0.000001 and accepted_quantity + rejected_quantity <= received_quantity + 0.000001 and
    cancelled_quantity <= ordered_quantity - received_quantity + 0.000001 and unit_price >= 0 and freight_amount >= 0 and other_cost_amount >= 0 and
    delivered_unit_cost >= 0 and total_amount >= 0
  )
);

create table if not exists public.procurement_purchase_order_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  order_id uuid not null references public.procurement_purchase_orders(id) on delete cascade,
  document_type text not null default 'other' check (document_type in ('order','supplier_confirmation','invoice','delivery','technical','other')),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  caption text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  unique (order_id, storage_path)
);

create table if not exists public.procurement_purchase_order_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  order_id uuid not null references public.procurement_purchase_orders(id) on delete cascade,
  action text not null,
  previous_status text,
  new_status text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create index if not exists procurement_purchase_orders_project_status_idx on public.procurement_purchase_orders(project_id,status,expected_delivery_date,created_at desc);
create index if not exists procurement_purchase_orders_supplier_idx on public.procurement_purchase_orders(company_id,supplier_id,status);
create index if not exists procurement_purchase_order_items_order_idx on public.procurement_purchase_order_items(order_id,sort_order);
create index if not exists procurement_purchase_order_items_request_idx on public.procurement_purchase_order_items(request_item_id);
create index if not exists procurement_purchase_order_documents_idx on public.procurement_purchase_order_documents(order_id,uploaded_at);

insert into public.permissions (key,module,action,description) values
  ('procurement.orders.view','procurement_orders','view','Visualizar pedidos de compras da obra'),
  ('procurement.orders.manage','procurement_orders','manage','Gerar e editar pedidos de compras em elaboração'),
  ('procurement.orders.issue','procurement_orders','issue','Emitir pedidos e comprometer quantidades solicitadas'),
  ('procurement.orders.confirm','procurement_orders','confirm','Registrar confirmação do fornecedor'),
  ('procurement.orders.cancel','procurement_orders','cancel','Cancelar pedidos com estorno das quantidades ainda não recebidas')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values('procurement.orders.view'),('procurement.orders.manage'),('procurement.orders.issue'),('procurement.orders.confirm'),('procurement.orders.cancel')) p(permission_key)
where r.key in ('owner','admin','director','procurement')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'procurement.orders.view',true from public.roles r
where r.key in ('engineering','field','finance','viewer')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

alter table public.procurement_purchase_orders enable row level security;
alter table public.procurement_purchase_order_items enable row level security;
alter table public.procurement_purchase_order_documents enable row level security;
alter table public.procurement_purchase_order_audit enable row level security;

do $$
declare t text;
begin
  foreach t in array array['procurement_purchase_orders','procurement_purchase_order_items','procurement_purchase_order_documents','procurement_purchase_order_audit']
  loop
    execute format('drop policy if exists %I_select on public.%I',t,t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.has_company_permission(company_id,''procurement.orders.view'') or public.has_company_permission(company_id,''procurement.orders.manage'') or public.has_company_permission(company_id,''procurement.orders.issue''))',t,t);
    execute format('drop policy if exists %I_write on public.%I',t,t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.has_company_permission(company_id,''procurement.orders.manage'') or public.has_company_permission(company_id,''procurement.orders.issue'') or public.has_company_permission(company_id,''procurement.orders.confirm'')) with check (public.has_company_permission(company_id,''procurement.orders.manage'') or public.has_company_permission(company_id,''procurement.orders.issue'') or public.has_company_permission(company_id,''procurement.orders.confirm''))',t,t);
  end loop;
end $$;

create or replace function public.refresh_procurement_purchase_order(p_order_id uuid)
returns text
language plpgsql security definer set search_path=public as $$
declare current_status text; next_status text; total_ordered numeric; total_received numeric; begin
  select status into current_status from public.procurement_purchase_orders where id=p_order_id for update;
  if current_status is null then raise exception 'Pedido de compra não encontrado.'; end if;
  select coalesce(sum(ordered_quantity-cancelled_quantity),0),coalesce(sum(received_quantity),0)
  into total_ordered,total_received from public.procurement_purchase_order_items where order_id=p_order_id;
  if current_status in ('draft','cancelled','closed') then next_status:=current_status;
  elsif total_ordered>0 and total_received>=total_ordered then next_status:='received';
  elsif total_received>0 then next_status:='partially_received';
  elsif current_status='confirmed' then next_status:='confirmed';
  else next_status:='issued'; end if;
  update public.procurement_purchase_orders o set
    status=next_status,
    subtotal_amount=coalesce(x.subtotal,0),freight_amount=coalesce(x.freight,0),tax_amount=coalesce(x.tax,0),other_cost_amount=coalesce(x.other_cost,0),discount_amount=coalesce(x.discount,0),
    total_amount=coalesce(x.total,0),received_amount=coalesce(x.received,0),updated_at=now()
  from (
    select p_order_id id,
      coalesce(sum(ordered_quantity*unit_price),0) subtotal,
      coalesce(sum(freight_amount),0) freight,
      coalesce(sum((ordered_quantity*unit_price*(1-discount_percent/100))*tax_percent/100),0) tax,
      coalesce(sum(other_cost_amount),0) other_cost,
      coalesce(sum(ordered_quantity*unit_price*discount_percent/100),0) discount,
      coalesce(sum(total_amount),0) total,
      coalesce(sum(accepted_quantity*delivered_unit_cost),0) received
    from public.procurement_purchase_order_items where order_id=p_order_id
  ) x where o.id=x.id;
  return next_status;
end; $$;

create or replace function public.generate_procurement_purchase_orders_from_quotation(
  p_company_id uuid,p_project_id uuid,p_quotation_id uuid
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  q public.procurement_material_quotations%rowtype; award_group record; award record; offer public.procurement_material_quotation_offers%rowtype;
  qi public.procurement_material_quotation_items%rowtype; oi public.procurement_material_quotation_offer_items%rowtype;
  supplier public.suppliers%rowtype; order_id uuid; seq integer; item_index integer; created_ids uuid[]:=array[]::uuid[];
begin
  if not public.has_company_permission(p_company_id,'procurement.orders.manage') then raise exception 'Sem permissão para gerar pedidos de compras.'; end if;
  select * into q from public.procurement_material_quotations where id=p_quotation_id and company_id=p_company_id and project_id=p_project_id and status='approved';
  if q.id is null then raise exception 'Selecione uma cotação aprovada da obra.'; end if;
  if not exists(select 1 from public.procurement_material_quotation_awards a where a.quotation_id=q.id) then raise exception 'A cotação não possui fornecedores vencedores.'; end if;

  for award_group in
    select a.supplier_id from public.procurement_material_quotation_awards a
    where a.quotation_id=q.id and not exists(select 1 from public.procurement_purchase_order_items poi where poi.award_id=a.id)
    group by a.supplier_id order by a.supplier_id
  loop
    select * into supplier from public.suppliers s where s.id=award_group.supplier_id and s.company_id=p_company_id and s.status='active';
    if supplier.id is null then raise exception 'Um dos fornecedores vencedores não está ativo.'; end if;
    perform pg_advisory_xact_lock(hashtext(p_project_id::text||':purchase-orders'));
    select coalesce(max(sequence_no),0)+1 into seq from public.procurement_purchase_orders where project_id=p_project_id;
    select o.* into offer from public.procurement_material_quotation_offers o where o.quotation_id=q.id and o.supplier_id=supplier.id;
    insert into public.procurement_purchase_orders(
      company_id,project_id,quotation_id,supplier_id,sequence_no,order_number,status,expected_delivery_date,delivery_address,payment_terms,freight_terms,warranty_terms,
      buyer_name,notes,created_by,updated_by
    ) values(
      p_company_id,p_project_id,q.id,supplier.id,seq,'PC-'||lpad(seq::text,4,'0'),'draft',q.desired_delivery_date,q.delivery_address,
      coalesce(offer.payment_terms,q.payment_terms),offer.freight_terms,offer.warranty_terms,
      coalesce(nullif(auth.jwt()->>'email',''),'Usuário'),q.approval_notes,auth.uid(),auth.uid()
    ) returning id into order_id;
    item_index:=0;
    for award in select a.* from public.procurement_material_quotation_awards a where a.quotation_id=q.id and a.supplier_id=supplier.id and not exists(select 1 from public.procurement_purchase_order_items poi where poi.award_id=a.id) order by a.approved_at,a.id
    loop
      select * into qi from public.procurement_material_quotation_items where id=award.quotation_item_id;
      select * into oi from public.procurement_material_quotation_offer_items where id=award.offer_item_id;
      item_index:=item_index+1;
      insert into public.procurement_purchase_order_items(
        company_id,project_id,order_id,quotation_id,quotation_item_id,award_id,offer_item_id,request_id,request_item_id,input_id,cost_center_service_id,
        request_number,input_code,input_name,unit_snapshot,cost_center_code,cost_center_name,brand,manufacturer,ordered_quantity,unit_price,discount_percent,tax_percent,
        freight_amount,other_cost_amount,delivered_unit_cost,total_amount,expected_delivery_date,notes,sort_order
      ) values(
        p_company_id,p_project_id,order_id,q.id,qi.id,award.id,oi.id,qi.request_id,qi.request_item_id,qi.input_id,qi.cost_center_service_id,
        qi.request_number,qi.input_code,qi.input_name,qi.unit_snapshot,qi.cost_center_code,qi.cost_center_name,oi.brand,oi.manufacturer,award.awarded_quantity,
        oi.unit_price,oi.discount_percent,oi.tax_percent,
        case when oi.quantity_offered>0 then round(oi.freight_amount*(award.awarded_quantity/oi.quantity_offered),2) else 0 end,
        case when oi.quantity_offered>0 then round(oi.other_cost_amount*(award.awarded_quantity/oi.quantity_offered),2) else 0 end,
        award.awarded_unit_cost,award.awarded_total_cost,q.desired_delivery_date,award.justification,item_index
      );
    end loop;
    perform public.refresh_procurement_purchase_order(order_id);
    insert into public.procurement_purchase_order_audit(company_id,project_id,order_id,action,new_status,details,changed_by)
    values(p_company_id,p_project_id,order_id,'generated','draft',jsonb_build_object('quotation_id',q.id,'supplier_id',supplier.id),auth.uid());
    created_ids:=array_append(created_ids,order_id);
  end loop;
  if coalesce(array_length(created_ids,1),0)=0 then raise exception 'Todos os vencedores desta cotação já foram convertidos em pedidos.'; end if;
  return jsonb_build_object('created_count',array_length(created_ids,1),'order_ids',to_jsonb(created_ids));
end; $$;

create or replace function public.save_procurement_purchase_order_header(
  p_company_id uuid,p_project_id uuid,p_order_id uuid,p_expected_delivery_date date,p_delivery_address text,p_payment_terms text,p_freight_terms text,p_warranty_terms text,
  p_supplier_contact_name text,p_supplier_contact_email text,p_supplier_contact_phone text,p_notes text,p_supplier_notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare o public.procurement_purchase_orders%rowtype; begin
  if not public.has_company_permission(p_company_id,'procurement.orders.manage') then raise exception 'Sem permissão para editar pedidos.'; end if;
  select * into o from public.procurement_purchase_orders where id=p_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if o.id is null then raise exception 'Pedido não encontrado.'; end if;
  if o.status<>'draft' then raise exception 'Somente pedidos em elaboração podem ser editados.'; end if;
  if p_expected_delivery_date is null then raise exception 'Informe a data prevista de entrega.'; end if;
  update public.procurement_purchase_orders set expected_delivery_date=p_expected_delivery_date,delivery_address=nullif(trim(coalesce(p_delivery_address,'')),''),payment_terms=nullif(trim(coalesce(p_payment_terms,'')),''),freight_terms=nullif(trim(coalesce(p_freight_terms,'')),''),warranty_terms=nullif(trim(coalesce(p_warranty_terms,'')),''),supplier_contact_name=nullif(trim(coalesce(p_supplier_contact_name,'')),''),supplier_contact_email=nullif(trim(coalesce(p_supplier_contact_email,'')),''),supplier_contact_phone=nullif(trim(coalesce(p_supplier_contact_phone,'')),''),notes=nullif(trim(coalesce(p_notes,'')),''),supplier_notes=nullif(trim(coalesce(p_supplier_notes,'')),''),updated_by=auth.uid(),updated_at=now() where id=o.id;
  update public.procurement_purchase_order_items set expected_delivery_date=p_expected_delivery_date,updated_at=now() where order_id=o.id;
  insert into public.procurement_purchase_order_audit(company_id,project_id,order_id,action,previous_status,new_status,changed_by) values(p_company_id,p_project_id,o.id,'header_updated','draft','draft',auth.uid());
  return o.id;
end; $$;

create or replace function public.issue_procurement_purchase_order(p_company_id uuid,p_project_id uuid,p_order_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare o public.procurement_purchase_orders%rowtype; item record; request_item public.execution_material_request_items%rowtype; begin
  if not public.has_company_permission(p_company_id,'procurement.orders.issue') then raise exception 'Sem permissão para emitir pedidos.'; end if;
  select * into o from public.procurement_purchase_orders where id=p_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if o.id is null or o.status<>'draft' then raise exception 'Pedido não disponível para emissão.'; end if;
  if o.expected_delivery_date is null or nullif(trim(coalesce(o.delivery_address,'')),'') is null then raise exception 'Informe a data e o endereço de entrega antes da emissão.'; end if;
  if o.total_amount<=0 or not exists(select 1 from public.procurement_purchase_order_items where order_id=o.id) then raise exception 'O pedido precisa possuir itens e valor maior que zero.'; end if;
  for item in select * from public.procurement_purchase_order_items where order_id=o.id order by sort_order for update
  loop
    select * into request_item from public.execution_material_request_items where id=item.request_item_id for update;
    if request_item.id is null then raise exception 'Item de solicitação não encontrado.'; end if;
    if request_item.ordered_quantity+item.ordered_quantity>request_item.requested_quantity+0.000001 then raise exception 'O pedido ultrapassa o saldo solicitado para %.',item.input_code; end if;
    update public.execution_material_request_items set ordered_quantity=ordered_quantity+item.ordered_quantity,updated_at=now() where id=request_item.id;
  end loop;
  update public.procurement_purchase_orders set status='issued',issue_date=current_date,issued_by=auth.uid(),issued_at=now(),updated_by=auth.uid(),updated_at=now() where id=o.id;
  insert into public.procurement_purchase_order_audit(company_id,project_id,order_id,action,previous_status,new_status,details,changed_by) values(p_company_id,p_project_id,o.id,'issued','draft','issued',jsonb_build_object('total_amount',o.total_amount),auth.uid());
  return 'issued';
end; $$;

create or replace function public.confirm_procurement_purchase_order(
  p_company_id uuid,p_project_id uuid,p_order_id uuid,p_reference text,p_confirmed_delivery_date date,p_notes text
) returns text language plpgsql security definer set search_path=public as $$
declare o public.procurement_purchase_orders%rowtype; begin
  if not public.has_company_permission(p_company_id,'procurement.orders.confirm') then raise exception 'Sem permissão para confirmar pedidos.'; end if;
  select * into o from public.procurement_purchase_orders where id=p_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if o.id is null or o.status<>'issued' then raise exception 'Pedido não disponível para confirmação.'; end if;
  update public.procurement_purchase_orders set status='confirmed',expected_delivery_date=coalesce(p_confirmed_delivery_date,expected_delivery_date),supplier_confirmation_reference=nullif(trim(coalesce(p_reference,'')),''),supplier_notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),supplier_notes),confirmed_by=auth.uid(),confirmed_at=now(),updated_by=auth.uid(),updated_at=now() where id=o.id;
  if p_confirmed_delivery_date is not null then update public.procurement_purchase_order_items set expected_delivery_date=p_confirmed_delivery_date,updated_at=now() where order_id=o.id; end if;
  insert into public.procurement_purchase_order_audit(company_id,project_id,order_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,o.id,'supplier_confirmed','issued','confirmed',nullif(trim(coalesce(p_notes,'')),''),auth.uid());
  return 'confirmed';
end; $$;

create or replace function public.cancel_procurement_purchase_order(
  p_company_id uuid,p_project_id uuid,p_order_id uuid,p_reason text
) returns text language plpgsql security definer set search_path=public as $$
declare o public.procurement_purchase_orders%rowtype; item record; begin
  if not public.has_company_permission(p_company_id,'procurement.orders.cancel') then raise exception 'Sem permissão para cancelar pedidos.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into o from public.procurement_purchase_orders where id=p_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if o.id is null or o.status in ('received','closed','cancelled') then raise exception 'Pedido não disponível para cancelamento.'; end if;
  if exists(select 1 from public.procurement_purchase_order_items where order_id=o.id and received_quantity>0) then raise exception 'O pedido possui recebimentos e não pode ser cancelado integralmente.'; end if;
  if o.status<>'draft' then
    for item in select * from public.procurement_purchase_order_items where order_id=o.id for update
    loop
      update public.execution_material_request_items set ordered_quantity=greatest(0,ordered_quantity-item.ordered_quantity),updated_at=now() where id=item.request_item_id;
      perform public.recalculate_execution_material_request_status(item.request_id);
    end loop;
  end if;
  update public.procurement_purchase_order_items set cancelled_quantity=ordered_quantity,updated_at=now() where order_id=o.id;
  update public.procurement_purchase_orders set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() where id=o.id;
  insert into public.procurement_purchase_order_audit(company_id,project_id,order_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,o.id,'cancelled',o.status,'cancelled',trim(p_reason),auth.uid());
  return 'cancelled';
end; $$;

create or replace function public.close_procurement_purchase_order(p_company_id uuid,p_project_id uuid,p_order_id uuid,p_notes text)
returns text language plpgsql security definer set search_path=public as $$
declare o public.procurement_purchase_orders%rowtype; begin
  if not public.has_company_permission(p_company_id,'procurement.orders.issue') then raise exception 'Sem permissão para encerrar pedidos.'; end if;
  select * into o from public.procurement_purchase_orders where id=p_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if o.id is null or o.status<>'received' then raise exception 'Somente pedidos totalmente recebidos podem ser encerrados.'; end if;
  update public.procurement_purchase_orders set status='closed',closed_by=auth.uid(),closed_at=now(),notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),updated_by=auth.uid(),updated_at=now() where id=o.id;
  insert into public.procurement_purchase_order_audit(company_id,project_id,order_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,o.id,'closed','received','closed',nullif(trim(coalesce(p_notes,'')),''),auth.uid());
  return 'closed';
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('purchase-order-documents','purchase-order-documents',false,26214400,array['application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists purchase_order_documents_select on storage.objects;
create policy purchase_order_documents_select on storage.objects for select to authenticated using(bucket_id='purchase-order-documents' and exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and m.status='active' and m.company_id::text=(storage.foldername(name))[1]));
drop policy if exists purchase_order_documents_insert on storage.objects;
create policy purchase_order_documents_insert on storage.objects for insert to authenticated with check(bucket_id='purchase-order-documents' and (public.has_company_permission(((storage.foldername(name))[1])::uuid,'procurement.orders.manage') or public.has_company_permission(((storage.foldername(name))[1])::uuid,'procurement.orders.confirm')));
drop policy if exists purchase_order_documents_delete on storage.objects;
create policy purchase_order_documents_delete on storage.objects for delete to authenticated using(bucket_id='purchase-order-documents' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'procurement.orders.manage'));

grant select,insert,update,delete on public.procurement_purchase_orders,public.procurement_purchase_order_items,public.procurement_purchase_order_documents,public.procurement_purchase_order_audit to authenticated;
grant execute on function public.refresh_procurement_purchase_order(uuid) to authenticated;
grant execute on function public.generate_procurement_purchase_orders_from_quotation(uuid,uuid,uuid) to authenticated;
grant execute on function public.save_procurement_purchase_order_header(uuid,uuid,uuid,date,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.issue_procurement_purchase_order(uuid,uuid,uuid) to authenticated;
grant execute on function public.confirm_procurement_purchase_order(uuid,uuid,uuid,text,date,text) to authenticated;
grant execute on function public.cancel_procurement_purchase_order(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.close_procurement_purchase_order(uuid,uuid,uuid,text) to authenticated;

commit;
