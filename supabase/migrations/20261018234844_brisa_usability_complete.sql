begin;

create or replace function public.engineering_service_identity_matches(a_name text,a_unit text,b_name text,b_unit text)
returns boolean language sql immutable set search_path=public as $$
 select lower(regexp_replace(btrim(coalesce(a_name,'')),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim(coalesce(b_name,'')),'[[:space:]]+',' ','g'))
 and replace(replace(lower(regexp_replace(coalesce(a_unit,'un'),'[[:space:]]+','','g')),'²','2'),'³','3')=replace(replace(lower(regexp_replace(coalesce(b_unit,'un'),'[[:space:]]+','','g')),'²','2'),'³','3');
$$;

alter table public.engineering_supply_plan_items
 add column if not exists physical_stock numeric not null default 0,
 add column if not exists reserved_stock numeric not null default 0,
 add column if not exists consumed_stock numeric not null default 0,
 add column if not exists stock_observed_at timestamptz;

create or replace function public.sync_supply_plan_inventory_for_input(p_project_id uuid,p_input_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare physical numeric; reserved numeric; consumed numeric;
begin
 select coalesce(sum(quantity_on_hand),0),coalesce(sum(reserved_quantity),0) into physical,reserved
 from public.procurement_inventory_balances where project_id=p_project_id and input_id=p_input_id;
 select greatest(0,coalesce(sum(case when movement_type='issue' then quantity when movement_type='return_to_stock' then -quantity else 0 end),0)) into consumed
 from public.procurement_inventory_movements where project_id=p_project_id and input_id=p_input_id;
 update public.engineering_supply_plan_items set physical_stock=physical,reserved_stock=reserved,consumed_stock=consumed,
 available_stock=greatest(0,physical-reserved),purchase_quantity=greatest(0,required_quantity-physical-consumed),
 stock_observed_at=now(),updated_at=now()
 where project_id=p_project_id and input_id=p_input_id and record_status='active';
end; $$;

create or replace function public.refresh_supply_plan_stock(p_company_id uuid,p_project_id uuid,p_baseline_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare item record;
begin
 if auth.uid() is null or not public.has_company_permission(p_company_id,'supply_plan.manage') then raise exception 'Sem permissão para sincronizar o estoque do planejamento.'; end if;
 if not exists(select 1 from public.engineering_schedule_baselines where id=p_baseline_id and company_id=p_company_id and project_id=p_project_id) then raise exception 'Linha de base não encontrada nesta obra.'; end if;
 for item in select distinct input_id from public.engineering_supply_plan_items where company_id=p_company_id and project_id=p_project_id and baseline_id=p_baseline_id loop
  perform public.sync_supply_plan_inventory_for_input(p_project_id,item.input_id);
 end loop;
end; $$;
revoke all on function public.refresh_supply_plan_stock(uuid,uuid,uuid) from public,anon;
grant execute on function public.refresh_supply_plan_stock(uuid,uuid,uuid) to authenticated;

alter table public.procurement_material_receipts
 add column if not exists warehouse_location_id uuid references public.procurement_inventory_locations(id),
 add column if not exists delivery_instructions text;

create or replace function public.save_procurement_material_receipt_at_location(
 p_company_id uuid,p_project_id uuid,p_receipt_id uuid,p_location_id uuid,p_details jsonb,p_items jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare location public.procurement_inventory_locations%rowtype; receipt_id uuid;
begin
 if auth.uid() is null or not public.has_company_permission(p_company_id,'procurement.receipts.manage') then raise exception 'Sem permissão para registrar recebimento.'; end if;
 select * into location from public.procurement_inventory_locations where id=p_location_id and company_id=p_company_id and project_id=p_project_id and status='active';
 if location.id is null then raise exception 'Selecione um local ativo da própria obra.'; end if;
 receipt_id:=public.save_procurement_material_receipt(p_company_id,p_project_id,p_receipt_id,
 (p_details->>'order_id')::uuid,(p_details->>'receipt_date')::date,nullif(p_details->>'arrival_time','')::time,
 p_details->>'invoice_number',p_details->>'invoice_series',p_details->>'invoice_access_key',nullif(p_details->>'invoice_date','')::date,
 nullif(p_details->>'invoice_amount','')::numeric,p_details->>'carrier_name',p_details->>'vehicle_plate',p_details->>'driver_name',p_details->>'delivery_document',location.name,
 p_details->>'general_condition',p_details->>'notes',p_items);
 update public.procurement_material_receipts set warehouse_location_id=location.id,delivery_instructions=nullif(trim(p_details->>'delivery_instructions'),'') where id=receipt_id and company_id=p_company_id and project_id=p_project_id;
 return receipt_id;
end; $$;
revoke all on function public.save_procurement_material_receipt_at_location(uuid,uuid,uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_procurement_material_receipt_at_location(uuid,uuid,uuid,uuid,jsonb,jsonb) to authenticated;

create or replace function public.register_approved_material_receipt_in_inventory(p_receipt_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r public.procurement_material_receipts%rowtype; item record; location_id uuid;
begin
 select * into r from public.procurement_material_receipts where id=p_receipt_id and status='approved';
 if r.id is null then return; end if;
 if r.warehouse_location_id is not null then
  select id into location_id from public.procurement_inventory_locations where id=r.warehouse_location_id and company_id=r.company_id and project_id=r.project_id and status='active';
  if location_id is null then raise exception 'O local selecionado está inativo ou não pertence à obra.'; end if;
 else
  location_id:=public.ensure_procurement_inventory_location(r.company_id,r.project_id,r.warehouse_location);
 end if;
 for item in select * from public.procurement_material_receipt_items where receipt_id=r.id and accepted_quantity>0 order by sort_order loop
  perform public.post_procurement_inventory_movement(r.company_id,r.project_id,'receipt',r.receipt_date,item.input_id,null,location_id,item.accepted_quantity,item.unit_cost,item.batch_number,item.expiration_date,item.cost_center_service_id,null,'material_receipt',item.id,r.receipt_number,concat_ws(' · ','Entrada por recebimento aprovado',r.invoice_number));
 end loop;
end; $$;

alter table public.procurement_material_receipt_discrepancies
 add column if not exists assignee_user_id uuid references auth.users(id),
 add column if not exists replacement_receipt_id uuid references public.procurement_material_receipts(id);

create or replace function public.treat_procurement_receipt_discrepancy(
 p_company_id uuid,p_project_id uuid,p_discrepancy_id uuid,p_status text,p_assignee_user_id uuid,p_replacement_receipt_id uuid,p_notes text
) returns void language plpgsql security definer set search_path=public as $$
declare d public.procurement_material_receipt_discrepancies%rowtype; r public.procurement_material_receipts%rowtype; original public.procurement_material_receipt_items%rowtype; available numeric; allocated numeric;
begin
 if auth.uid() is null or not public.has_company_permission(p_company_id,'procurement.receipts.discrepancies') then raise exception 'Sem permissão para tratar divergências.'; end if;
 if p_status not in ('open','supplier_notified','resolved','waived') then raise exception 'Situação de divergência inválida.'; end if;
 if nullif(trim(p_notes),'') is null then raise exception 'Descreva o tratamento da divergência.'; end if;
 select * into d from public.procurement_material_receipt_discrepancies where id=p_discrepancy_id and company_id=p_company_id and project_id=p_project_id for update;
 if d.id is null then raise exception 'Divergência não encontrada nesta obra.'; end if;
 if d.status in ('resolved','waived') then raise exception 'Esta divergência já foi encerrada.'; end if;
 if p_assignee_user_id is null or not exists(select 1 from public.company_memberships where company_id=p_company_id and user_id=p_assignee_user_id and status='active') then raise exception 'Selecione um responsável ativo da empresa.'; end if;
 select * into r from public.procurement_material_receipts where id=d.receipt_id and company_id=p_company_id and project_id=p_project_id;
 select * into original from public.procurement_material_receipt_items where id=d.receipt_item_id and receipt_id=r.id;
 if p_replacement_receipt_id is not null then
  perform pg_advisory_xact_lock(hashtext(p_replacement_receipt_id::text||':replacement-allocation'));
  if p_replacement_receipt_id=r.id or not exists(select 1 from public.procurement_material_receipts where id=p_replacement_receipt_id and company_id=p_company_id and project_id=p_project_id and order_id=r.order_id and status='approved') then raise exception 'A reposição deve ser um outro recebimento aprovado do mesmo pedido e obra.'; end if;
  select coalesce(sum(accepted_quantity),0) into available from public.procurement_material_receipt_items where receipt_id=p_replacement_receipt_id and input_id=original.input_id;
  select coalesce(sum(i.rejected_quantity),0) into allocated from public.procurement_material_receipt_discrepancies x join public.procurement_material_receipt_items i on i.id=x.receipt_item_id where x.replacement_receipt_id=p_replacement_receipt_id and x.status='resolved' and i.input_id=original.input_id and x.id<>d.id;
  if original.id is null or available-allocated < original.rejected_quantity then raise exception 'O recebimento de reposição não cobre a quantidade rejeitada deste material.'; end if;
 end if;
 update public.procurement_material_receipt_discrepancies set status=p_status,assignee_user_id=p_assignee_user_id,replacement_receipt_id=p_replacement_receipt_id,resolution_notes=concat_ws(E'\n',resolution_notes,trim(p_notes)),resolved_by=case when p_status in ('resolved','waived') then auth.uid() end,resolved_at=case when p_status in ('resolved','waived') then now() end,updated_at=now() where id=d.id;
 insert into public.procurement_material_receipt_audit(company_id,project_id,receipt_id,action,previous_status,new_status,reason,details,changed_by)
 values(p_company_id,p_project_id,r.id,'discrepancy_treated',d.status,p_status,trim(p_notes),jsonb_build_object('discrepancy_id',d.id,'assignee_user_id',p_assignee_user_id,'replacement_receipt_id',p_replacement_receipt_id),auth.uid());
end; $$;
revoke all on function public.treat_procurement_receipt_discrepancy(uuid,uuid,uuid,text,uuid,uuid,text) from public,anon;
grant execute on function public.treat_procurement_receipt_discrepancy(uuid,uuid,uuid,text,uuid,uuid,text) to authenticated;

alter table public.procurement_material_quotations
 add column if not exists is_historical boolean not null default false,
 add column if not exists original_date date,
 add column if not exists history_reason text;
insert into public.permissions(key,module,action,description) values ('procurement.quotations.history','procurement_quotations','history','Implantar cotações históricas com justificativa e data original') on conflict(key) do nothing;
insert into public.role_permissions(role_id,permission_key,allowed) select id,'procurement.quotations.history',true from public.roles where key in ('owner','admin') on conflict(role_id,permission_key) do nothing;
create or replace function public.save_procurement_material_quotation_v2(
  p_company_id uuid,p_project_id uuid,p_quotation_id uuid,p_title text,p_award_mode text,
  p_response_deadline date,p_desired_delivery_date date,p_payment_terms text,p_delivery_address text,p_notes text,
  p_items jsonb,p_suppliers jsonb,p_historical boolean,p_original_date date,p_history_reason text
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
  if auth.uid() is null then raise exception 'Autenticação obrigatória.'; end if;
  if p_historical then
    if not public.has_company_permission(p_company_id,'procurement.quotations.history') then raise exception 'Sem permissão para implantação histórica.'; end if;
    if p_original_date is null or p_original_date>current_date or nullif(trim(p_history_reason),'') is null then raise exception 'Informe a data original, até hoje, e a justificativa da implantação histórica.'; end if;
    if p_response_deadline is null or p_response_deadline<p_original_date or (p_desired_delivery_date is not null and p_desired_delivery_date<p_original_date) then raise exception 'As datas da cotação não podem anteceder a data original.'; end if;
  elsif p_response_deadline is null or p_response_deadline<current_date then
    raise exception 'Informe uma data-limite igual ou posterior a hoje.';
  end if;
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
    if q.is_historical and not coalesce(p_historical,false) then raise exception 'Não é permitido retirar a identificação de implantação histórica.'; end if;
    if q.is_historical and not public.has_company_permission(p_company_id,'procurement.quotations.history') then raise exception 'Sem permissão para editar implantação histórica.'; end if;
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
  update public.procurement_material_quotations set is_historical=coalesce(p_historical,false),original_date=case when p_historical then p_original_date end,history_reason=case when p_historical then trim(p_history_reason) end where id=resolved_id;
  if p_historical then
    insert into public.procurement_material_quotation_audit(company_id,project_id,quotation_id,action,new_status,details,changed_by)
    values(p_company_id,p_project_id,resolved_id,'historical_implementation','draft',jsonb_build_object('original_date',p_original_date,'reason',trim(p_history_reason),'response_deadline',p_response_deadline,'registered_at',now()),auth.uid());
  end if;
  perform public.refresh_procurement_material_quotation(resolved_id);
  insert into public.procurement_material_quotation_audit(company_id,project_id,quotation_id,action,new_status,changed_by)
  values(p_company_id,p_project_id,resolved_id,case when p_quotation_id is null then 'created' else 'updated' end,'draft',auth.uid());
  return resolved_id;
end;
$$;

revoke all on function public.save_procurement_material_quotation_v2(uuid,uuid,uuid,text,text,date,date,text,text,text,jsonb,jsonb,boolean,date,text) from public,anon;
grant execute on function public.save_procurement_material_quotation_v2(uuid,uuid,uuid,text,text,date,date,text,text,text,jsonb,jsonb,boolean,date,text) to authenticated;
revoke all on function public.sync_supply_plan_inventory_for_input(uuid,uuid) from public,anon,authenticated;
revoke all on function public.register_approved_material_receipt_in_inventory(uuid) from public,anon,authenticated;

create or replace function public.reconcile_engineering_budget_service(p_company_id uuid,p_budget_id uuid,p_item_id uuid,p_service_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare item public.engineering_budget_items%rowtype; service public.engineering_services%rowtype; budget public.engineering_budgets%rowtype;
begin
 if auth.uid() is null or not public.has_company_permission(p_company_id,'budgets.manage') then raise exception 'Sem permissão para reconciliar serviços.'; end if;
 select * into budget from public.engineering_budgets where id=p_budget_id and company_id=p_company_id for update;
 if budget.id is null or budget.status not in ('draft','in_progress') then raise exception 'Reconcilie o vínculo numa revisão em elaboração.'; end if;
 if exists(select 1 from public.engineering_schedule_baselines where budget_id=budget.id and status='approved') then raise exception 'Esta revisão já possui cronograma aprovado. Crie uma nova revisão para reconciliar.'; end if;
 select * into item from public.engineering_budget_items where id=p_item_id and budget_id=budget.id and company_id=p_company_id and status='active' for update;
 if item.id is null then raise exception 'Item não encontrado nesta revisão.'; end if;
 if p_service_id is null then
   insert into public.engineering_services(company_id,code,description,unit,status,created_by,notes)
   values(p_company_id,'SRV-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),item.description,item.unit,'active',auth.uid(),'Criado na reconciliação do item '||item.id::text) returning * into service;
 else
   select * into service from public.engineering_services where id=p_service_id and company_id=p_company_id and status='active';
   if service.id is null then raise exception 'Cadastro não encontrado nesta empresa.'; end if;
   if not public.engineering_service_identity_matches(service.description,service.unit,item.description,item.unit) then raise exception 'O cadastro selecionado possui descrição ou unidade incompatível.'; end if;
 end if;
 update public.engineering_budget_items set service_id=service.id,updated_at=now() where id=item.id;
 update public.engineering_budget_item_compositions set source_service_id=service.id,source_composition_id=null,is_customized=true,updated_at=now() where budget_item_id=item.id and company_id=p_company_id;
 return service.id;
end; $$;
revoke all on function public.reconcile_engineering_budget_service(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.reconcile_engineering_budget_service(uuid,uuid,uuid,uuid) to authenticated;
create or replace function public.list_procurement_discrepancy_assignees(p_company_id uuid)
returns table(user_id uuid,full_name text) language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not public.has_company_permission(p_company_id,'procurement.receipts.view') then raise exception 'Sem permissão para listar responsáveis.'; end if;
 return query select m.user_id,coalesce(nullif(trim(p.full_name),''),'Usuário da empresa') from public.company_memberships m left join public.profiles p on p.id=m.user_id where m.company_id=p_company_id and m.status='active' order by p.full_name,m.user_id;
end; $$;
revoke all on function public.list_procurement_discrepancy_assignees(uuid) from public,anon;
grant execute on function public.list_procurement_discrepancy_assignees(uuid) to authenticated;

create or replace function public.guard_budget_service_identity()
returns trigger language plpgsql set search_path=public as $$
declare service public.engineering_services%rowtype;
begin
 if new.service_id is null then return new; end if;
 if tg_op='UPDATE' then if new.service_id is not distinct from old.service_id then return new; end if; end if;
 select * into service from public.engineering_services where id=new.service_id and company_id=new.company_id and status='active';
 if service.id is null or not public.engineering_service_identity_matches(new.description,new.unit,service.description,service.unit) then raise exception 'O vínculo de serviço possui descrição ou unidade incompatível. Reconcilie o cadastro antes de vincular o orçamento.'; end if;
 return new;
end; $$;
drop trigger if exists budget_service_identity_guard on public.engineering_budget_items;
-- Copied legacy snapshots retain their original identity; explicit relinking must be compatible.
create trigger budget_service_identity_guard before update of service_id on public.engineering_budget_items for each row execute function public.guard_budget_service_identity();

create or replace function public.guard_historical_quotation_identity()
returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op='UPDATE' and old.is_historical then
  if not new.is_historical then raise exception 'Não é permitido retirar a identificação de implantação histórica.'; end if;
  if (new.original_date,new.history_reason,new.response_deadline,new.desired_delivery_date,new.title) is not distinct from (old.original_date,old.history_reason,old.response_deadline,old.desired_delivery_date,old.title) then return new; end if;
 end if;
 if new.is_historical then
  if auth.uid() is null or not public.has_company_permission(new.company_id,'procurement.quotations.history') then raise exception 'Sem permissão para implantação histórica.'; end if;
  if new.original_date is null or new.original_date>current_date or nullif(trim(new.history_reason),'') is null or new.response_deadline<new.original_date then raise exception 'Revise data original, prazo e justificativa da implantação histórica.'; end if;
 end if;
 return new;
end; $$;
drop trigger if exists historical_quotation_identity_guard on public.procurement_material_quotations;
create trigger historical_quotation_identity_guard before insert or update on public.procurement_material_quotations for each row execute function public.guard_historical_quotation_identity();
commit;
