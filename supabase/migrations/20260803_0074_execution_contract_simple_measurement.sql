-- Elos OS — Fase 3 · Medição mensal simples

begin;

create or replace function public.create_simple_execution_contract_measurement(
  p_company_id uuid,
  p_project_id uuid,
  p_contract_id uuid,
  p_competence date,
  p_gross_amount numeric,
  p_progress_percent numeric,
  p_over_contract_confirmed boolean,
  p_notes text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  c public.execution_service_contracts%rowtype;
  ci record;
  measurement_id uuid;
  seq integer;
  gross numeric;
  contractual_retention numeric;
  guarantee_retention numeric;
  deductions numeric;
  net numeric;
  period_start date;
  period_end date;
  requester text;
  total_remaining numeric:=0;
  total_weight numeric:=0;
  allocated numeric:=0;
  item_amount numeric;
  item_quantity numeric;
  item_number integer:=0;
  item_total integer:=0;
  exceeds_contract boolean:=false;
begin
  if not public.has_company_permission(p_company_id,'execution.measurements.manage')
     or not public.has_company_permission(p_company_id,'execution.measurements.submit') then
    raise exception 'Sem permissão para registrar e enviar medições.';
  end if;

  select * into c
  from public.execution_service_contracts
  where id=p_contract_id and company_id=p_company_id and project_id=p_project_id and status in ('active','suspended')
  for update;
  if c.id is null then raise exception 'Selecione um contrato ativo ou suspenso.'; end if;
  if p_competence is null then raise exception 'Informe a competência.'; end if;

  gross:=round(coalesce(p_gross_amount,0),2);
  if gross<=0 and coalesce(p_progress_percent,0)>0 then
    gross:=round(c.current_value*p_progress_percent/100,2);
  end if;
  if gross<=0 then raise exception 'Informe o valor ou o percentual da medição.'; end if;

  exceeds_contract:=coalesce(c.measured_value,0)+gross>coalesce(c.current_value,0)+0.01;
  if exceeds_contract and not coalesce(p_over_contract_confirmed,false) then
    raise exception 'A medição ultrapassa o valor vigente. Confirme explicitamente o estouro.';
  end if;

  period_start:=greatest(date_trunc('month',p_competence)::date,c.start_date);
  period_end:=least((date_trunc('month',p_competence)+interval '1 month - 1 day')::date,c.end_date);
  if period_end<period_start then
    raise exception 'A competência não possui dias cobertos pela vigência atual do contrato.';
  end if;

  select count(*),
         coalesce(sum(greatest((ci.total_value+coalesce(ai.amendment_value,0))-ci.measured_value,0)),0),
         coalesce(sum(greatest(ci.total_value+coalesce(ai.amendment_value,0),0)),0)
  into item_total,total_remaining,total_weight
  from public.execution_service_contract_items ci
  left join (
    select contract_item_id,sum(value_change) amendment_value
    from public.execution_service_contract_amendment_items
    where contract_id=c.id group by contract_item_id
  ) ai on ai.contract_item_id=ci.id
  where ci.contract_id=c.id;

  if item_total=0 then raise exception 'O contrato não possui itens para medição.'; end if;
  if total_remaining>0 then total_weight:=total_remaining; end if;
  if total_weight<=0 then total_weight:=item_total; end if;

  perform pg_advisory_xact_lock(hashtext(p_project_id::text||':contract-measurements'));
  select coalesce(max(sequence_no),0)+1 into seq
  from public.execution_contract_measurements where project_id=p_project_id;
  select coalesce(nullif(trim(pr.full_name),''),nullif(auth.jwt()->>'email',''),'Usuário') into requester
  from public.profiles pr where pr.id=auth.uid();
  requester:=coalesce(requester,nullif(auth.jwt()->>'email',''),'Usuário');

  contractual_retention:=round(gross*coalesce(c.retention_percent,0)/100,2);
  guarantee_retention:=round(gross*coalesce(c.guarantee_percent,0)/100,2);
  deductions:=contractual_retention+guarantee_retention;
  net:=gross-deductions;

  insert into public.execution_contract_measurements(
    company_id,project_id,contract_id,supplier_id,sequence_no,measurement_number,period_start,period_end,status,
    gross_amount,contractual_retention_percent,contractual_retention_amount,
    guarantee_retention_percent,guarantee_retention_amount,total_deductions,net_amount,notes,
    requester_user_id,requester_name,submitted_by,submitted_at,
    over_contract_confirmed,over_contract_confirmed_by,over_contract_confirmed_at,created_by,updated_by
  ) values (
    p_company_id,p_project_id,c.id,c.supplier_id,seq,'MED-'||lpad(seq::text,4,'0'),period_start,period_end,'submitted',
    gross,c.retention_percent,contractual_retention,c.guarantee_percent,guarantee_retention,deductions,net,nullif(trim(coalesce(p_notes,'')),''),
    auth.uid(),requester,auth.uid(),now(),
    exceeds_contract,case when exceeds_contract then auth.uid() else null end,case when exceeds_contract then now() else null end,auth.uid(),auth.uid()
  ) returning id into measurement_id;

  for ci in
    select ci.*,
           ci.total_value+coalesce(ai.amendment_value,0) commitment_value,
           greatest((ci.total_value+coalesce(ai.amendment_value,0))-ci.measured_value,0) remaining_value
    from public.execution_service_contract_items ci
    left join (
      select contract_item_id,sum(value_change) amendment_value
      from public.execution_service_contract_amendment_items
      where contract_id=c.id group by contract_item_id
    ) ai on ai.contract_item_id=ci.id
    where ci.contract_id=c.id
    order by ci.sort_order,ci.id
  loop
    item_number:=item_number+1;
    if item_number=item_total then
      item_amount:=round(gross-allocated,2);
    else
      item_amount:=round(gross*(case when total_remaining>0 then ci.remaining_value else greatest(ci.commitment_value,0) end)/total_weight,2);
      allocated:=allocated+item_amount;
    end if;
    if item_amount<=0 then continue; end if;
    item_quantity:=case
      when ci.unit_price>0 then item_amount/ci.unit_price
      when ci.commitment_value>0 then ci.contracted_quantity*(item_amount/ci.commitment_value)
      else 1
    end;
    insert into public.execution_contract_measurement_items(
      company_id,project_id,measurement_id,contract_id,contract_item_id,service_id,location_id,
      service_code,service_name,location_name,unit_snapshot,contracted_quantity,previous_approved_quantity,current_quantity,
      accumulated_quantity,unit_price,previous_approved_amount,current_amount,accumulated_amount,progress_percent,notes,sort_order
    ) values (
      p_company_id,p_project_id,measurement_id,c.id,ci.id,ci.service_id,ci.location_id,
      ci.service_code,ci.service_name,ci.location_name,ci.unit_snapshot,ci.contracted_quantity,ci.measured_quantity,item_quantity,
      ci.measured_quantity+item_quantity,ci.unit_price,ci.measured_value,item_amount,ci.measured_value+item_amount,
      case when ci.commitment_value>0 then round(((ci.measured_value+item_amount)/ci.commitment_value)*100,4) else 0 end,
      'Distribuição proporcional da medição mensal simples.',item_number
    );
  end loop;

  insert into public.execution_contract_measurement_audit(
    company_id,project_id,measurement_id,action,new_status,details,changed_by
  ) values (
    p_company_id,p_project_id,measurement_id,'created_and_submitted','submitted',
    jsonb_build_object('gross_amount',gross,'net_amount',net,'simple_monthly',true,'over_contract_confirmed',exceeds_contract),auth.uid()
  );
  return measurement_id;
end; $$;

grant execute on function public.create_simple_execution_contract_measurement(uuid,uuid,uuid,date,numeric,numeric,boolean,text) to authenticated;

commit;
