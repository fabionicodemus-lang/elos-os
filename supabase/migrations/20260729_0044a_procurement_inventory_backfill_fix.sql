-- Elos OS — Estoque 0044a
-- Permite carga técnica dos recebimentos aprovados durante a instalação e mantém a validação de permissão para usuários autenticados.

begin;

create or replace function public.post_procurement_inventory_movement(
 p_company_id uuid,p_project_id uuid,p_movement_type text,p_movement_date date,p_input_id uuid,p_from_location_id uuid,p_to_location_id uuid,
 p_quantity numeric,p_unit_cost numeric,p_batch_number text,p_expiration_date date,p_cost_center_service_id uuid,p_recipient_name text,
 p_source_type text,p_source_id uuid,p_source_reference text,p_notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare
 input_row public.engineering_inputs%rowtype;
 service_row public.engineering_services%rowtype;
 source_balance public.procurement_inventory_balances%rowtype;
 seq bigint;
 movement_id uuid;
 resolved_cost numeric;
 required_permission text;
begin
 required_permission:=case
  when p_movement_type='issue' then 'procurement.inventory.issue'
  when p_movement_type='transfer' then 'procurement.inventory.transfer'
  else 'procurement.inventory.adjust'
 end;
 if p_movement_type='receipt' and p_source_type='material_receipt' then
  required_permission:='procurement.receipts.approve';
 end if;
 if auth.uid() is not null and not public.has_company_permission(p_company_id,required_permission) then
  raise exception 'Sem permissão para registrar esta movimentação.';
 end if;
 if p_movement_type not in('receipt','issue','transfer','adjustment_in','adjustment_out','return_to_supplier','return_to_stock') then
  raise exception 'Tipo de movimentação inválido.';
 end if;
 if coalesce(p_quantity,0)<=0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
 select * into input_row from public.engineering_inputs where id=p_input_id and company_id=p_company_id and status='active';
 if input_row.id is null then raise exception 'Material não encontrado ou inativo.'; end if;
 if p_cost_center_service_id is not null then
  select * into service_row from public.engineering_services where id=p_cost_center_service_id and company_id=p_company_id and status='active';
 end if;
 if p_source_id is not null then
  select id into movement_id from public.procurement_inventory_movements
  where source_type=p_source_type and source_id=p_source_id and movement_type=p_movement_type;
  if movement_id is not null then return movement_id; end if;
 end if;
 resolved_cost:=greatest(coalesce(p_unit_cost,0),0);
 if p_movement_type in('issue','transfer','adjustment_out','return_to_supplier') then
  select * into source_balance from public.procurement_inventory_balances
  where project_id=p_project_id and input_id=p_input_id and location_id=p_from_location_id
    and batch_number=coalesce(trim(p_batch_number),'')
    and expiration_date=coalesce(p_expiration_date,'9999-12-31'::date)
  for update;
  if source_balance.id is null or source_balance.available_quantity<p_quantity-0.000001 then
   raise exception 'Saldo disponível insuficiente para a movimentação.';
  end if;
  resolved_cost:=source_balance.average_unit_cost;
 end if;
 perform pg_advisory_xact_lock(hashtext(p_project_id::text||':inventory-movements'));
 select coalesce(max(sequence_no),0)+1 into seq from public.procurement_inventory_movements where project_id=p_project_id;
 insert into public.procurement_inventory_movements(
  company_id,project_id,sequence_no,movement_number,movement_type,movement_date,input_id,input_code,input_name,unit_snapshot,
  from_location_id,to_location_id,quantity,unit_cost,total_value,batch_number,expiration_date,cost_center_service_id,cost_center_code,
  cost_center_name,responsible_name,recipient_name,source_type,source_id,source_reference,notes,created_by
 ) values(
  p_company_id,p_project_id,seq,'MOV-'||lpad(seq::text,6,'0'),p_movement_type,coalesce(p_movement_date,current_date),
  p_input_id,input_row.code,input_row.description,input_row.unit,p_from_location_id,p_to_location_id,p_quantity,resolved_cost,
  round(p_quantity*resolved_cost,2),coalesce(trim(p_batch_number),''),coalesce(p_expiration_date,'9999-12-31'::date),
  service_row.id,service_row.code,service_row.description,coalesce(nullif(auth.jwt()->>'email',''),'Sistema'),
  nullif(trim(coalesce(p_recipient_name,'')),''),nullif(trim(coalesce(p_source_type,'')),''),p_source_id,
  nullif(trim(coalesce(p_source_reference,'')),''),nullif(trim(coalesce(p_notes,'')),''),auth.uid()
 ) returning id into movement_id;
 if p_movement_type in('receipt','adjustment_in','return_to_stock') then
  perform public.apply_procurement_inventory_balance(p_company_id,p_project_id,p_input_id,p_to_location_id,p_batch_number,p_expiration_date,p_quantity,resolved_cost);
 elsif p_movement_type in('issue','adjustment_out','return_to_supplier') then
  perform public.apply_procurement_inventory_balance(p_company_id,p_project_id,p_input_id,p_from_location_id,p_batch_number,p_expiration_date,-p_quantity,resolved_cost);
 elsif p_movement_type='transfer' then
  perform public.apply_procurement_inventory_balance(p_company_id,p_project_id,p_input_id,p_from_location_id,p_batch_number,p_expiration_date,-p_quantity,resolved_cost);
  perform public.apply_procurement_inventory_balance(p_company_id,p_project_id,p_input_id,p_to_location_id,p_batch_number,p_expiration_date,p_quantity,resolved_cost);
 end if;
 insert into public.procurement_inventory_audit(company_id,project_id,entity_type,entity_id,action,details,changed_by)
 values(p_company_id,p_project_id,'movement',movement_id,'posted',jsonb_build_object('type',p_movement_type,'quantity',p_quantity,'unit_cost',resolved_cost),auth.uid());
 return movement_id;
end; $$;

-- A chave única de origem torna a carga repetível e impede entradas duplicadas.
do $$
declare receipt record;
begin
 for receipt in select id from public.procurement_material_receipts where status='approved' loop
  perform public.register_approved_material_receipt_in_inventory(receipt.id);
 end loop;
end $$;

grant execute on function public.post_procurement_inventory_movement(uuid,uuid,text,date,uuid,uuid,uuid,numeric,numeric,text,date,uuid,text,text,uuid,text,text) to authenticated;

commit;
