-- Elos OS — Suprimentos · Recebimento de Materiais
-- Conferência de pedidos, aceite/rejeição, divergências e atualização dos saldos.

begin;

create table if not exists public.procurement_material_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  order_id uuid not null references public.procurement_purchase_orders(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  sequence_no integer not null,
  receipt_number text not null,
  status text not null default 'draft' check(status in ('draft','submitted','approved','rejected','cancelled')),
  receipt_date date not null,
  arrival_time time,
  invoice_number text,
  invoice_series text,
  invoice_access_key text,
  invoice_date date,
  invoice_amount numeric(18,2),
  carrier_name text,
  vehicle_plate text,
  driver_name text,
  delivery_document text,
  warehouse_location text,
  general_condition text check(general_condition is null or general_condition in ('good','partial_damage','damaged','divergent')),
  notes text,
  receiver_user_id uuid references auth.users(id),
  receiver_name text,
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  approval_notes text,
  rejected_by uuid references auth.users(id),
  rejected_at timestamptz,
  rejection_reason text,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,sequence_no),
  unique(project_id,receipt_number),
  constraint procurement_material_receipt_invoice_check check(invoice_amount is null or invoice_amount>=0),
  constraint procurement_material_receipt_rejection_check check(status<>'rejected' or nullif(trim(coalesce(rejection_reason,'')),'') is not null),
  constraint procurement_material_receipt_cancel_check check(status<>'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null)
);

create table if not exists public.procurement_material_receipt_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  receipt_id uuid not null references public.procurement_material_receipts(id) on delete cascade,
  order_id uuid not null references public.procurement_purchase_orders(id) on delete restrict,
  order_item_id uuid not null references public.procurement_purchase_order_items(id) on delete restrict,
  input_id uuid not null references public.engineering_inputs(id) on delete restrict,
  cost_center_service_id uuid references public.engineering_services(id) on delete restrict,
  input_code text not null,
  input_name text not null,
  unit_snapshot text not null,
  cost_center_code text not null,
  cost_center_name text not null,
  ordered_quantity numeric(18,6) not null,
  previously_accepted_quantity numeric(18,6) not null default 0,
  delivered_quantity numeric(18,6) not null,
  accepted_quantity numeric(18,6) not null,
  rejected_quantity numeric(18,6) not null default 0,
  unit_cost numeric(18,6) not null,
  accepted_amount numeric(18,2) not null default 0,
  batch_number text,
  expiration_date date,
  condition text not null default 'good' check(condition in ('good','damaged','wrong_specification','shortage','excess','other')),
  rejection_reason text,
  destination_location text,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(receipt_id,order_item_id),
  constraint procurement_material_receipt_item_values_check check(
    ordered_quantity>0 and previously_accepted_quantity>=0 and delivered_quantity>0 and accepted_quantity>=0 and rejected_quantity>=0 and
    accepted_quantity+rejected_quantity=delivered_quantity and previously_accepted_quantity+accepted_quantity<=ordered_quantity+0.000001 and
    unit_cost>=0 and accepted_amount>=0
  ),
  constraint procurement_material_receipt_item_rejection_check check(rejected_quantity=0 or nullif(trim(coalesce(rejection_reason,'')),'') is not null)
);

create table if not exists public.procurement_material_receipt_discrepancies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  receipt_id uuid not null references public.procurement_material_receipts(id) on delete cascade,
  receipt_item_id uuid references public.procurement_material_receipt_items(id) on delete cascade,
  discrepancy_type text not null check(discrepancy_type in ('quantity','damage','specification','invoice','documentation','delivery_date','other')),
  description text not null,
  severity text not null default 'medium' check(severity in ('low','medium','high','critical')),
  status text not null default 'open' check(status in ('open','supplier_notified','resolved','waived')),
  supplier_response text,
  resolution_notes text,
  due_date date,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.procurement_material_receipt_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  receipt_id uuid not null references public.procurement_material_receipts(id) on delete cascade,
  document_type text not null default 'evidence' check(document_type in ('invoice','delivery_document','evidence','damage','approval','other')),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  caption text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  unique(receipt_id,storage_path)
);

create table if not exists public.procurement_material_receipt_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  receipt_id uuid not null references public.procurement_material_receipts(id) on delete cascade,
  action text not null,
  previous_status text,
  new_status text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create index if not exists procurement_material_receipts_project_status_idx on public.procurement_material_receipts(project_id,status,receipt_date desc);
create index if not exists procurement_material_receipts_order_idx on public.procurement_material_receipts(order_id,sequence_no);
create index if not exists procurement_material_receipt_items_receipt_idx on public.procurement_material_receipt_items(receipt_id,sort_order);
create index if not exists procurement_material_receipt_items_order_item_idx on public.procurement_material_receipt_items(order_item_id);
create index if not exists procurement_material_receipt_discrepancies_idx on public.procurement_material_receipt_discrepancies(receipt_id,status,severity);

insert into public.permissions(key,module,action,description) values
 ('procurement.receipts.view','procurement_receipts','view','Visualizar recebimentos de materiais'),
 ('procurement.receipts.manage','procurement_receipts','manage','Criar e editar conferências de entrega'),
 ('procurement.receipts.submit','procurement_receipts','submit','Enviar recebimentos para aprovação'),
 ('procurement.receipts.approve','procurement_receipts','approve','Aprovar ou devolver recebimentos'),
 ('procurement.receipts.discrepancies','procurement_receipts','discrepancies','Tratar divergências com fornecedores'),
 ('procurement.receipts.cancel','procurement_receipts','cancel','Cancelar recebimentos não aprovados')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r cross join(values('procurement.receipts.view'),('procurement.receipts.manage'),('procurement.receipts.submit'),('procurement.receipts.approve'),('procurement.receipts.discrepancies'),('procurement.receipts.cancel'))p(permission_key)
where r.key in('owner','admin','director','procurement') on conflict(role_id,permission_key) do update set allowed=excluded.allowed;
insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r cross join(values('procurement.receipts.view'),('procurement.receipts.manage'),('procurement.receipts.submit'))p(permission_key)
where r.key in('field') on conflict(role_id,permission_key) do update set allowed=excluded.allowed;
insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'procurement.receipts.view',true from public.roles r where r.key in('engineering','finance','viewer') on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

alter table public.procurement_material_receipts enable row level security;
alter table public.procurement_material_receipt_items enable row level security;
alter table public.procurement_material_receipt_discrepancies enable row level security;
alter table public.procurement_material_receipt_documents enable row level security;
alter table public.procurement_material_receipt_audit enable row level security;

do $$ declare t text; begin
 foreach t in array array['procurement_material_receipts','procurement_material_receipt_items','procurement_material_receipt_discrepancies','procurement_material_receipt_documents','procurement_material_receipt_audit'] loop
  execute format('drop policy if exists %I_select on public.%I',t,t);
  execute format('create policy %I_select on public.%I for select to authenticated using(public.has_company_permission(company_id,''procurement.receipts.view'') or public.has_company_permission(company_id,''procurement.receipts.manage'') or public.has_company_permission(company_id,''procurement.receipts.approve''))',t,t);
  execute format('drop policy if exists %I_write on public.%I',t,t);
  execute format('create policy %I_write on public.%I for all to authenticated using(public.has_company_permission(company_id,''procurement.receipts.manage'') or public.has_company_permission(company_id,''procurement.receipts.approve'') or public.has_company_permission(company_id,''procurement.receipts.discrepancies'')) with check(public.has_company_permission(company_id,''procurement.receipts.manage'') or public.has_company_permission(company_id,''procurement.receipts.approve'') or public.has_company_permission(company_id,''procurement.receipts.discrepancies''))',t,t);
 end loop;
end $$;

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
 update public.procurement_purchase_orders o set status=next_status,received_amount=coalesce(x.received,0),invoiced_amount=coalesce(x.invoiced,0),updated_at=now()
 from(select p_order_id id,coalesce(sum(accepted_quantity*delivered_unit_cost),0)received,
   coalesce((select sum(r.invoice_amount) from public.procurement_material_receipts r where r.order_id=p_order_id and r.status='approved'),0)invoiced
   from public.procurement_purchase_order_items where order_id=p_order_id)x where o.id=x.id;
 return next_status;
end; $$;

create or replace function public.save_procurement_material_receipt(
 p_company_id uuid,p_project_id uuid,p_receipt_id uuid,p_order_id uuid,p_receipt_date date,p_arrival_time time,
 p_invoice_number text,p_invoice_series text,p_invoice_access_key text,p_invoice_date date,p_invoice_amount numeric,
 p_carrier_name text,p_vehicle_plate text,p_driver_name text,p_delivery_document text,p_warehouse_location text,p_general_condition text,p_notes text,p_items jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare r public.procurement_material_receipts%rowtype; po public.procurement_purchase_orders%rowtype; poi public.procurement_purchase_order_items%rowtype; item jsonb; resolved_id uuid; seq integer; n integer:=0; delivered numeric; accepted numeric; rejected numeric; receiver text; begin
 if not public.has_company_permission(p_company_id,'procurement.receipts.manage') then raise exception 'Sem permissão para registrar recebimentos.'; end if;
 select * into po from public.procurement_purchase_orders where id=p_order_id and company_id=p_company_id and project_id=p_project_id and status in('issued','confirmed','partially_received');
 if po.id is null then raise exception 'Selecione um pedido emitido, confirmado ou parcialmente recebido.'; end if;
 if p_receipt_date is null then raise exception 'Informe a data do recebimento.'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Informe ao menos um item entregue.'; end if;
 select coalesce(nullif(trim(pr.full_name),''),nullif(auth.jwt()->>'email',''),'Usuário') into receiver from public.profiles pr where pr.id=auth.uid(); receiver:=coalesce(receiver,'Usuário');
 if p_receipt_id is null then
  perform pg_advisory_xact_lock(hashtext(p_project_id::text||':material-receipts'));
  select coalesce(max(sequence_no),0)+1 into seq from public.procurement_material_receipts where project_id=p_project_id;
  insert into public.procurement_material_receipts(company_id,project_id,order_id,supplier_id,sequence_no,receipt_number,receipt_date,arrival_time,invoice_number,invoice_series,invoice_access_key,invoice_date,invoice_amount,carrier_name,vehicle_plate,driver_name,delivery_document,warehouse_location,general_condition,notes,receiver_user_id,receiver_name,created_by,updated_by)
  values(p_company_id,p_project_id,po.id,po.supplier_id,seq,'REC-'||lpad(seq::text,4,'0'),p_receipt_date,p_arrival_time,nullif(trim(coalesce(p_invoice_number,'')),''),nullif(trim(coalesce(p_invoice_series,'')),''),nullif(trim(coalesce(p_invoice_access_key,'')),''),p_invoice_date,p_invoice_amount,nullif(trim(coalesce(p_carrier_name,'')),''),nullif(trim(coalesce(p_vehicle_plate,'')),''),nullif(trim(coalesce(p_driver_name,'')),''),nullif(trim(coalesce(p_delivery_document,'')),''),nullif(trim(coalesce(p_warehouse_location,'')),''),p_general_condition,nullif(trim(coalesce(p_notes,'')),''),auth.uid(),receiver,auth.uid(),auth.uid()) returning id into resolved_id;
 else
  select * into r from public.procurement_material_receipts where id=p_receipt_id and company_id=p_company_id and project_id=p_project_id for update;
  if r.id is null then raise exception 'Recebimento não encontrado.'; end if;
  if r.status not in('draft','rejected') then raise exception 'Somente recebimentos em elaboração ou devolvidos podem ser editados.'; end if;
  if r.order_id<>p_order_id then raise exception 'O pedido do recebimento não pode ser alterado.'; end if;
  resolved_id:=r.id;
  update public.procurement_material_receipts set receipt_date=p_receipt_date,arrival_time=p_arrival_time,invoice_number=nullif(trim(coalesce(p_invoice_number,'')),''),invoice_series=nullif(trim(coalesce(p_invoice_series,'')),''),invoice_access_key=nullif(trim(coalesce(p_invoice_access_key,'')),''),invoice_date=p_invoice_date,invoice_amount=p_invoice_amount,carrier_name=nullif(trim(coalesce(p_carrier_name,'')),''),vehicle_plate=nullif(trim(coalesce(p_vehicle_plate,'')),''),driver_name=nullif(trim(coalesce(p_driver_name,'')),''),delivery_document=nullif(trim(coalesce(p_delivery_document,'')),''),warehouse_location=nullif(trim(coalesce(p_warehouse_location,'')),''),general_condition=p_general_condition,notes=nullif(trim(coalesce(p_notes,'')),''),status='draft',rejection_reason=null,rejected_by=null,rejected_at=null,updated_by=auth.uid(),updated_at=now() where id=resolved_id;
  delete from public.procurement_material_receipt_items where receipt_id=resolved_id;
 end if;
 for item in select value from jsonb_array_elements(p_items) loop
  delivered:=coalesce(nullif(item->>'delivered_quantity','')::numeric,0); accepted:=coalesce(nullif(item->>'accepted_quantity','')::numeric,0); rejected:=coalesce(nullif(item->>'rejected_quantity','')::numeric,0);
  if delivered<=0 then continue; end if;
  if accepted+rejected<>delivered then raise exception 'Aceito + rejeitado deve ser igual ao entregue.'; end if;
  select * into poi from public.procurement_purchase_order_items where id=nullif(item->>'order_item_id','')::uuid and order_id=po.id;
  if poi.id is null then raise exception 'Um dos itens não pertence ao pedido.'; end if;
  if poi.accepted_quantity+accepted>poi.ordered_quantity-poi.cancelled_quantity+0.000001 then raise exception 'A quantidade aceita de % ultrapassa o saldo do pedido.',poi.input_code; end if;
  if rejected>0 and nullif(trim(coalesce(item->>'rejection_reason','')),'') is null then raise exception 'Informe o motivo da rejeição de %.',poi.input_code; end if;
  n:=n+1;
  insert into public.procurement_material_receipt_items(company_id,project_id,receipt_id,order_id,order_item_id,input_id,cost_center_service_id,input_code,input_name,unit_snapshot,cost_center_code,cost_center_name,ordered_quantity,previously_accepted_quantity,delivered_quantity,accepted_quantity,rejected_quantity,unit_cost,accepted_amount,batch_number,expiration_date,condition,rejection_reason,destination_location,notes,sort_order)
  values(p_company_id,p_project_id,resolved_id,po.id,poi.id,poi.input_id,poi.cost_center_service_id,poi.input_code,poi.input_name,poi.unit_snapshot,poi.cost_center_code,poi.cost_center_name,poi.ordered_quantity,poi.accepted_quantity,delivered,accepted,rejected,poi.delivered_unit_cost,round(accepted*poi.delivered_unit_cost,2),nullif(trim(coalesce(item->>'batch_number','')),''),nullif(item->>'expiration_date','')::date,coalesce(nullif(item->>'condition',''),'good'),nullif(trim(coalesce(item->>'rejection_reason','')),''),nullif(trim(coalesce(item->>'destination_location','')),''),nullif(trim(coalesce(item->>'notes','')),''),n);
 end loop;
 if n=0 then raise exception 'Informe ao menos uma quantidade entregue maior que zero.'; end if;
 insert into public.procurement_material_receipt_audit(company_id,project_id,receipt_id,action,new_status,changed_by) values(p_company_id,p_project_id,resolved_id,case when p_receipt_id is null then 'created' else 'updated' end,'draft',auth.uid());
 return resolved_id;
end; $$;

create or replace function public.submit_procurement_material_receipt(p_company_id uuid,p_project_id uuid,p_receipt_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare r public.procurement_material_receipts%rowtype; begin
 if not public.has_company_permission(p_company_id,'procurement.receipts.submit') then raise exception 'Sem permissão para enviar recebimentos.'; end if;
 select * into r from public.procurement_material_receipts where id=p_receipt_id and company_id=p_company_id and project_id=p_project_id for update;
 if r.id is null or r.status not in('draft','rejected') then raise exception 'Recebimento não disponível para envio.'; end if;
 if not exists(select 1 from public.procurement_material_receipt_items where receipt_id=r.id) then raise exception 'O recebimento não possui itens.'; end if;
 update public.procurement_material_receipts set status='submitted',submitted_by=auth.uid(),submitted_at=now(),updated_by=auth.uid(),updated_at=now() where id=r.id;
 insert into public.procurement_material_receipt_audit(company_id,project_id,receipt_id,action,previous_status,new_status,changed_by) values(p_company_id,p_project_id,r.id,'submitted',r.status,'submitted',auth.uid()); return 'submitted';
end; $$;

create or replace function public.approve_procurement_material_receipt(p_company_id uuid,p_project_id uuid,p_receipt_id uuid,p_notes text)
returns text language plpgsql security definer set search_path=public as $$
declare r public.procurement_material_receipts%rowtype; item record; begin
 if not public.has_company_permission(p_company_id,'procurement.receipts.approve') then raise exception 'Sem permissão para aprovar recebimentos.'; end if;
 select * into r from public.procurement_material_receipts where id=p_receipt_id and company_id=p_company_id and project_id=p_project_id for update;
 if r.id is null or r.status<>'submitted' then raise exception 'Recebimento não disponível para aprovação.'; end if;
 for item in select * from public.procurement_material_receipt_items where receipt_id=r.id order by sort_order loop
  update public.procurement_purchase_order_items set received_quantity=received_quantity+item.delivered_quantity,accepted_quantity=accepted_quantity+item.accepted_quantity,rejected_quantity=rejected_quantity+item.rejected_quantity,updated_at=now() where id=item.order_item_id;
  if item.rejected_quantity>0 then insert into public.procurement_material_receipt_discrepancies(company_id,project_id,receipt_id,receipt_item_id,discrepancy_type,description,severity,status,due_date,created_by) values(p_company_id,p_project_id,r.id,item.id,case when item.condition='damaged' then 'damage' when item.condition='wrong_specification' then 'specification' else 'quantity' end,coalesce(item.rejection_reason,'Material rejeitado'),'high','open',current_date+3,auth.uid()); end if;
 end loop;
 update public.procurement_material_receipts set status='approved',approved_by=auth.uid(),approved_at=now(),approval_notes=nullif(trim(coalesce(p_notes,'')),''),updated_by=auth.uid(),updated_at=now() where id=r.id;
 perform public.refresh_procurement_purchase_order(r.order_id);
 insert into public.procurement_material_receipt_audit(company_id,project_id,receipt_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,r.id,'approved','submitted','approved',nullif(trim(coalesce(p_notes,'')),''),auth.uid()); return 'approved';
end; $$;

create or replace function public.reject_procurement_material_receipt(p_company_id uuid,p_project_id uuid,p_receipt_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$
declare r public.procurement_material_receipts%rowtype; begin
 if not public.has_company_permission(p_company_id,'procurement.receipts.approve') then raise exception 'Sem permissão para devolver recebimentos.'; end if;
 if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo da devolução.'; end if;
 select * into r from public.procurement_material_receipts where id=p_receipt_id and company_id=p_company_id and project_id=p_project_id for update;
 if r.id is null or r.status<>'submitted' then raise exception 'Recebimento não disponível para devolução.'; end if;
 update public.procurement_material_receipts set status='rejected',rejected_by=auth.uid(),rejected_at=now(),rejection_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() where id=r.id;
 insert into public.procurement_material_receipt_audit(company_id,project_id,receipt_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,r.id,'rejected','submitted','rejected',trim(p_reason),auth.uid()); return 'rejected';
end; $$;

create or replace function public.cancel_procurement_material_receipt(p_company_id uuid,p_project_id uuid,p_receipt_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$
declare r public.procurement_material_receipts%rowtype; begin
 if not public.has_company_permission(p_company_id,'procurement.receipts.cancel') then raise exception 'Sem permissão para cancelar recebimentos.'; end if;
 if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
 select * into r from public.procurement_material_receipts where id=p_receipt_id and company_id=p_company_id and project_id=p_project_id for update;
 if r.id is null or r.status not in('draft','rejected') then raise exception 'Somente recebimentos não aprovados podem ser cancelados.'; end if;
 update public.procurement_material_receipts set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() where id=r.id;
 insert into public.procurement_material_receipt_audit(company_id,project_id,receipt_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,r.id,'cancelled',r.status,'cancelled',trim(p_reason),auth.uid()); return 'cancelled';
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('material-receipt-documents','material-receipt-documents',false,26214400,array['application/pdf','image/jpeg','image/png','image/webp','text/xml','application/xml']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists material_receipt_documents_select on storage.objects;
create policy material_receipt_documents_select on storage.objects for select to authenticated using(bucket_id='material-receipt-documents' and exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and m.status='active' and m.company_id::text=(storage.foldername(name))[1]));
drop policy if exists material_receipt_documents_insert on storage.objects;
create policy material_receipt_documents_insert on storage.objects for insert to authenticated with check(bucket_id='material-receipt-documents' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'procurement.receipts.manage'));

grant select,insert,update,delete on public.procurement_material_receipts,public.procurement_material_receipt_items,public.procurement_material_receipt_discrepancies,public.procurement_material_receipt_documents,public.procurement_material_receipt_audit to authenticated;
grant execute on function public.save_procurement_material_receipt(uuid,uuid,uuid,uuid,date,time,text,text,text,date,numeric,text,text,text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.submit_procurement_material_receipt(uuid,uuid,uuid) to authenticated;
grant execute on function public.approve_procurement_material_receipt(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.reject_procurement_material_receipt(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.cancel_procurement_material_receipt(uuid,uuid,uuid,text) to authenticated;

commit;
