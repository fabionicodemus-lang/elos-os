-- Elos OS — Fase 3 · Medições com confirmação de estouro

begin;

-- Substitui a função existente para admitir estouro somente com confirmação explícita.
drop function if exists public.save_execution_contract_measurement(uuid,uuid,uuid,uuid,date,date,numeric,numeric,numeric,text,text,jsonb);

create function public.save_execution_contract_measurement(
  p_company_id uuid,
  p_project_id uuid,
  p_measurement_id uuid,
  p_contract_id uuid,
  p_period_start date,
  p_period_end date,
  p_tax_withholding numeric,
  p_advance_deduction numeric,
  p_other_discount numeric,
  p_notes text,
  p_contractor_notes text,
  p_items jsonb,
  p_over_contract_confirmed boolean default false
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  m public.execution_contract_measurements%rowtype;
  c public.execution_service_contracts%rowtype;
  ci public.execution_service_contract_items%rowtype;
  item jsonb;
  resolved_id uuid;
  seq integer;
  n integer:=0;
  current_qty numeric;
  previous_qty numeric;
  current_amount numeric;
  gross numeric:=0;
  contractual_retention numeric;
  guarantee_retention numeric;
  deductions numeric;
  net numeric;
  requester text;
  exceeds_item boolean:=false;
  exceeds_contract boolean:=false;
begin
  if not public.has_company_permission(p_company_id,'execution.measurements.manage') then
    raise exception 'Sem permissão para criar ou editar medições.';
  end if;
  select * into c
  from public.execution_service_contracts
  where id=p_contract_id and company_id=p_company_id and project_id=p_project_id and status in ('active','suspended');
  if c.id is null then raise exception 'Selecione um contrato ativo ou suspenso da obra.'; end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'Revise o período da medição.'; end if;
  if p_period_start<c.start_date or p_period_end>c.end_date then raise exception 'O período da medição deve estar dentro da vigência atual do contrato.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Informe pelo menos um item medido.'; end if;

  select coalesce(nullif(trim(pr.full_name),''),nullif(auth.jwt()->>'email',''),'Usuário') into requester
  from public.profiles pr where pr.id=auth.uid();
  requester:=coalesce(requester,nullif(auth.jwt()->>'email',''),'Usuário');

  if p_measurement_id is null then
    perform pg_advisory_xact_lock(hashtext(p_project_id::text||':contract-measurements'));
    select coalesce(max(sequence_no),0)+1 into seq from public.execution_contract_measurements where project_id=p_project_id;
    insert into public.execution_contract_measurements(
      company_id,project_id,contract_id,supplier_id,sequence_no,measurement_number,period_start,period_end,status,
      requester_user_id,requester_name,created_by,updated_by
    ) values (
      p_company_id,p_project_id,c.id,c.supplier_id,seq,'MED-'||lpad(seq::text,4,'0'),p_period_start,p_period_end,'draft',
      auth.uid(),requester,auth.uid(),auth.uid()
    ) returning id into resolved_id;
  else
    select * into m
    from public.execution_contract_measurements
    where id=p_measurement_id and company_id=p_company_id and project_id=p_project_id
    for update;
    if m.id is null then raise exception 'Medição não encontrada.'; end if;
    if m.status not in ('draft','rejected') then raise exception 'Somente medições em elaboração ou rejeitadas podem ser editadas.'; end if;
    if m.contract_id<>p_contract_id then raise exception 'O contrato da medição não pode ser alterado.'; end if;
    resolved_id:=m.id;
    delete from public.execution_contract_measurement_items where measurement_id=resolved_id;
    update public.execution_contract_measurements
    set period_start=p_period_start,period_end=p_period_end,status='draft',rejection_reason=null,rejected_by=null,rejected_at=null,
        over_contract_confirmed=false,over_contract_confirmed_by=null,over_contract_confirmed_at=null,
        updated_by=auth.uid(),updated_at=now()
    where id=resolved_id;
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    current_qty:=coalesce(nullif(item->>'current_quantity','')::numeric,0);
    if current_qty<=0 then continue; end if;
    select * into ci
    from public.execution_service_contract_items
    where id=nullif(item->>'contract_item_id','')::uuid
      and contract_id=c.id and company_id=p_company_id and project_id=p_project_id;
    if ci.id is null then raise exception 'Um dos itens não pertence ao contrato selecionado.'; end if;
    previous_qty:=coalesce(ci.measured_quantity,0);
    if previous_qty+current_qty>ci.contracted_quantity+0.000001 then exceeds_item:=true; end if;
    current_amount:=round(current_qty*ci.unit_price,2);
    gross:=gross+current_amount;
    n:=n+1;
    insert into public.execution_contract_measurement_items(
      company_id,project_id,measurement_id,contract_id,contract_item_id,service_id,location_id,
      service_code,service_name,location_name,unit_snapshot,contracted_quantity,previous_approved_quantity,current_quantity,
      accumulated_quantity,unit_price,previous_approved_amount,current_amount,accumulated_amount,progress_percent,notes,sort_order
    ) values (
      p_company_id,p_project_id,resolved_id,c.id,ci.id,ci.service_id,ci.location_id,
      ci.service_code,ci.service_name,ci.location_name,ci.unit_snapshot,ci.contracted_quantity,previous_qty,current_qty,
      previous_qty+current_qty,ci.unit_price,ci.measured_value,current_amount,ci.measured_value+current_amount,
      round(((previous_qty+current_qty)/ci.contracted_quantity)*100,4),nullif(trim(coalesce(item->>'notes','')),''),n
    );
  end loop;

  if n=0 or gross<=0 then raise exception 'Informe ao menos uma quantidade medida com valor maior que zero.'; end if;
  exceeds_contract := coalesce(c.measured_value,0)+gross > coalesce(c.current_value,0)+0.01;
  if (exceeds_item or exceeds_contract) and not coalesce(p_over_contract_confirmed,false) then
    raise exception 'A medição ultrapassa o contrato. Confirme explicitamente o estouro para continuar.';
  end if;

  contractual_retention:=round(gross*coalesce(c.retention_percent,0)/100,2);
  guarantee_retention:=round(gross*coalesce(c.guarantee_percent,0)/100,2);
  deductions:=contractual_retention+guarantee_retention+greatest(coalesce(p_tax_withholding,0),0)+greatest(coalesce(p_advance_deduction,0),0)+greatest(coalesce(p_other_discount,0),0);
  net:=gross-deductions;
  if net<0 then raise exception 'As retenções e descontos não podem superar o valor bruto medido.'; end if;

  update public.execution_contract_measurements set
    gross_amount=gross,
    contractual_retention_percent=c.retention_percent,
    contractual_retention_amount=contractual_retention,
    guarantee_retention_percent=c.guarantee_percent,
    guarantee_retention_amount=guarantee_retention,
    tax_withholding_amount=greatest(coalesce(p_tax_withholding,0),0),
    advance_deduction_amount=greatest(coalesce(p_advance_deduction,0),0),
    other_discount_amount=greatest(coalesce(p_other_discount,0),0),
    total_deductions=deductions,
    net_amount=net,
    notes=nullif(trim(coalesce(p_notes,'')),''),
    contractor_notes=nullif(trim(coalesce(p_contractor_notes,'')),''),
    over_contract_confirmed=(exceeds_item or exceeds_contract),
    over_contract_confirmed_by=case when exceeds_item or exceeds_contract then auth.uid() else null end,
    over_contract_confirmed_at=case when exceeds_item or exceeds_contract then now() else null end,
    updated_by=auth.uid(),updated_at=now()
  where id=resolved_id;

  insert into public.execution_contract_measurement_audit(company_id,project_id,measurement_id,action,new_status,details,changed_by)
  values(
    p_company_id,p_project_id,resolved_id,case when p_measurement_id is null then 'created' else 'updated' end,'draft',
    jsonb_build_object('gross_amount',gross,'net_amount',net,'over_contract_confirmed',(exceeds_item or exceeds_contract)),auth.uid()
  );
  return resolved_id;
end; $$;

grant execute on function public.save_execution_contract_measurement(uuid,uuid,uuid,uuid,date,date,numeric,numeric,numeric,text,text,jsonb,boolean) to authenticated;

commit;
