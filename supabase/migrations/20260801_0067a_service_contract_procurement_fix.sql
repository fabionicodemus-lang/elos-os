-- Elos OS — V0.70.0 · Correções de medição por etapas

begin;

create or replace function public.save_execution_stage_contract_measurement(
 p_company_id uuid,p_project_id uuid,p_measurement_id uuid,p_contract_id uuid,p_period_start date,p_period_end date,
 p_tax_withholding numeric,p_advance_deduction numeric,p_other_discount numeric,p_notes text,p_contractor_notes text,p_items jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare
 m public.execution_contract_measurements%rowtype;
 c public.execution_service_contracts%rowtype;
 s public.execution_service_contract_stages%rowtype;
 ci public.execution_service_contract_items%rowtype;
 item jsonb;
 resolved uuid;
 seq integer;
 n integer:=0;
 current_qty numeric;
 previous_qty numeric;
 previous_amount numeric;
 current_amount numeric;
 gross numeric:=0;
 contractual_retention numeric;
 guarantee_retention numeric;
 deductions numeric;
 net numeric;
 requester text;
begin
 if not public.has_company_permission(p_company_id,'execution.measurements.manage') then
  raise exception 'Sem permissão para criar medições.';
 end if;

 select * into c
 from public.execution_service_contracts
 where id=p_contract_id and company_id=p_company_id and project_id=p_project_id and status in('active','suspended');
 if c.id is null then raise exception 'Selecione um contrato ativo ou suspenso.'; end if;

 if p_period_start is null or p_period_end is null or p_period_end<p_period_start
    or p_period_start<c.start_date or p_period_end>c.end_date then
  raise exception 'Revise o período da medição.';
 end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
  raise exception 'Informe pelo menos uma etapa medida.';
 end if;

 select coalesce(nullif(trim(full_name),''),nullif(auth.jwt()->>'email',''),'Usuário')
 into requester from public.profiles where id=auth.uid();
 requester:=coalesce(requester,nullif(auth.jwt()->>'email',''),'Usuário');

 if p_measurement_id is null then
  perform pg_advisory_xact_lock(hashtext(p_project_id::text||':contract-measurements'));
  select coalesce(max(sequence_no),0)+1 into seq
  from public.execution_contract_measurements where project_id=p_project_id;
  insert into public.execution_contract_measurements(
   company_id,project_id,contract_id,supplier_id,sequence_no,measurement_number,
   period_start,period_end,status,requester_user_id,requester_name,created_by,updated_by
  ) values(
   p_company_id,p_project_id,c.id,c.supplier_id,seq,'MED-'||lpad(seq::text,4,'0'),
   p_period_start,p_period_end,'draft',auth.uid(),requester,auth.uid(),auth.uid()
  ) returning id into resolved;
 else
  select * into m
  from public.execution_contract_measurements
  where id=p_measurement_id and company_id=p_company_id and project_id=p_project_id
  for update;
  if m.id is null or m.status not in('draft','rejected') or m.contract_id<>c.id then
   raise exception 'Medição não disponível para edição.';
  end if;
  resolved:=m.id;
  delete from public.execution_contract_measurement_items where measurement_id=resolved;
  update public.execution_contract_measurements
  set period_start=p_period_start,period_end=p_period_end,status='draft',
      rejection_reason=null,rejected_by=null,rejected_at=null,updated_by=auth.uid(),updated_at=now()
  where id=resolved;
 end if;

 for item in select value from jsonb_array_elements(p_items) loop
  select * into s
  from public.execution_service_contract_stages
  where id=nullif(item->>'stage_id','')::uuid and contract_id=c.id
    and company_id=p_company_id and project_id=p_project_id
  for update;
  if s.id is null then raise exception 'Etapa contratual inválida.'; end if;

  select * into ci from public.execution_service_contract_items where id=s.contract_item_id;
  if ci.id is null then raise exception 'Serviço principal da etapa não encontrado.'; end if;

  select
   s.opening_measured_quantity + coalesce(sum(mi.current_quantity) filter(where mm.id is not null),0),
   s.opening_measured_value + coalesce(sum(mi.current_amount) filter(where mm.id is not null),0)
  into previous_qty,previous_amount
  from public.execution_contract_measurement_items mi
  left join public.execution_contract_measurements mm
    on mm.id=mi.measurement_id and mm.status in('approved','invoiced','paid')
  where mi.contract_stage_id=s.id;

  previous_qty:=coalesce(previous_qty,s.opening_measured_quantity);
  previous_amount:=coalesce(previous_amount,s.opening_measured_value);
  current_qty:=coalesce(nullif(item->>'current_quantity','')::numeric,0);
  if current_qty<=0 or previous_qty+current_qty>s.contracted_quantity+.000001 then
   raise exception 'Quantidade inválida para a etapa %. Saldo disponível: % %.',
    s.stage_name,greatest(0,s.contracted_quantity-previous_qty),s.unit_snapshot;
  end if;

  current_amount:=round(current_qty*s.unit_price,2);
  gross:=gross+current_amount;
  n:=n+1;
  insert into public.execution_contract_measurement_items(
   company_id,project_id,measurement_id,contract_id,contract_item_id,contract_stage_id,
   service_id,location_id,service_code,service_name,location_name,unit_snapshot,
   contracted_quantity,previous_approved_quantity,current_quantity,accumulated_quantity,
   unit_price,previous_approved_amount,current_amount,accumulated_amount,progress_percent,notes,sort_order
  ) values(
   p_company_id,p_project_id,resolved,c.id,ci.id,s.id,s.service_id,s.location_id,
   ci.service_code||' · '||s.stage_code,ci.service_name||' · '||s.stage_name,ci.location_name,s.unit_snapshot,
   s.contracted_quantity,previous_qty,current_qty,previous_qty+current_qty,s.unit_price,
   previous_amount,current_amount,round(previous_amount+current_amount,2),
   round(100*(previous_qty+current_qty)/s.contracted_quantity,4),
   nullif(trim(coalesce(item->>'notes','')),''),n
  );
 end loop;

 contractual_retention:=round(gross*c.retention_percent/100,2);
 guarantee_retention:=round(gross*c.guarantee_percent/100,2);
 deductions:=contractual_retention+guarantee_retention
   +greatest(coalesce(p_tax_withholding,0),0)
   +greatest(coalesce(p_advance_deduction,0),0)
   +greatest(coalesce(p_other_discount,0),0);
 if deductions>gross+.01 then raise exception 'As retenções e descontos não podem superar o valor bruto.'; end if;
 net:=round(gross-deductions,2);

 update public.execution_contract_measurements
 set gross_amount=round(gross,2),
     contractual_retention_percent=c.retention_percent,
     contractual_retention_amount=contractual_retention,
     guarantee_retention_percent=c.guarantee_percent,
     guarantee_retention_amount=guarantee_retention,
     tax_withholding_amount=greatest(coalesce(p_tax_withholding,0),0),
     advance_deduction_amount=greatest(coalesce(p_advance_deduction,0),0),
     other_discount_amount=greatest(coalesce(p_other_discount,0),0),
     total_deductions=round(deductions,2),net_amount=net,
     notes=nullif(trim(coalesce(p_notes,'')),''),
     contractor_notes=nullif(trim(coalesce(p_contractor_notes,'')),''),
     updated_by=auth.uid(),updated_at=now()
 where id=resolved;
 return resolved;
end $$;

grant execute on function public.save_execution_stage_contract_measurement(uuid,uuid,uuid,uuid,date,date,numeric,numeric,numeric,text,text,jsonb) to authenticated;

commit;
