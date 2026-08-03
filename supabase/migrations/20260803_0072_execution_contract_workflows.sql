-- Elos OS — Fase 3 · Fluxos contratuais e financeiros

begin;

create or replace function public.add_execution_service_contract_amendment_with_items(
  p_company_id uuid,
  p_project_id uuid,
  p_contract_id uuid,
  p_type text,
  p_description text,
  p_value_change numeric,
  p_new_end_date date,
  p_justification text,
  p_items jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  c public.execution_service_contracts%rowtype;
  ci public.execution_service_contract_items%rowtype;
  item jsonb;
  seq integer;
  new_id uuid;
  allocation numeric;
  allocation_total numeric := 0;
  item_count integer := 0;
begin
  if not public.has_company_permission(p_company_id,'execution.contracts.amend') then
    raise exception 'Aditivos exigem permissão específica.';
  end if;

  select * into c
  from public.execution_service_contracts
  where id=p_contract_id and company_id=p_company_id and project_id=p_project_id
  for update;

  if c.id is null or c.status not in ('active','suspended') then
    raise exception 'Somente contratos ativos ou suspensos podem receber aditivos.';
  end if;
  if p_type not in ('addition','suppression','time','mixed') then
    raise exception 'Tipo de aditivo inválido.';
  end if;
  if nullif(trim(coalesce(p_description,'')),'') is null or nullif(trim(coalesce(p_justification,'')),'') is null then
    raise exception 'Descrição e justificativa são obrigatórias.';
  end if;
  if p_type in ('time','mixed') and (p_new_end_date is null or p_new_end_date<c.end_date) then
    raise exception 'Informe uma nova data final igual ou posterior à vigência atual.';
  end if;
  if p_type in ('addition','suppression','mixed') and coalesce(p_value_change,0)=0 then
    raise exception 'Informe a alteração de valor do aditivo.';
  end if;
  if p_type='addition' and p_value_change<0 then raise exception 'Acréscimo deve ter valor positivo.'; end if;
  if p_type='suppression' and p_value_change>0 then raise exception 'Supressão deve ter valor negativo.'; end if;

  if p_type in ('addition','suppression','mixed') then
    if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then
      raise exception 'As alocações do aditivo são inválidas.';
    end if;
    for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
      allocation := coalesce(nullif(item->>'value_change','')::numeric,0);
      if allocation=0 then continue; end if;
      select * into ci
      from public.execution_service_contract_items
      where id=nullif(item->>'contract_item_id','')::uuid
        and contract_id=c.id and company_id=p_company_id and project_id=p_project_id;
      if ci.id is null then raise exception 'Uma das alocações não pertence ao contrato.'; end if;
      allocation_total := allocation_total + allocation;
      item_count := item_count + 1;
    end loop;
    if item_count=0 then raise exception 'Distribua o valor do aditivo entre os serviços do contrato.'; end if;
    if abs(round(allocation_total,2)-round(p_value_change,2))>0.01 then
      raise exception 'A soma das alocações (%) deve ser igual ao valor do aditivo (%).',allocation_total,p_value_change;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(c.id::text||':contract-amendments'));
  select coalesce(max(sequence_no),0)+1 into seq
  from public.execution_service_contract_amendments where contract_id=c.id;

  insert into public.execution_service_contract_amendments(
    company_id,project_id,contract_id,sequence_no,amendment_number,amendment_type,
    description,value_change,previous_end_date,new_end_date,approved_by,justification,created_by
  ) values (
    p_company_id,p_project_id,c.id,seq,'AD-'||lpad(seq::text,2,'0'),p_type,
    trim(p_description),coalesce(p_value_change,0),c.end_date,p_new_end_date,auth.uid(),trim(p_justification),auth.uid()
  ) returning id into new_id;

  if p_type in ('addition','suppression','mixed') then
    for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
      allocation := coalesce(nullif(item->>'value_change','')::numeric,0);
      if allocation=0 then continue; end if;
      select * into ci
      from public.execution_service_contract_items
      where id=nullif(item->>'contract_item_id','')::uuid
        and contract_id=c.id and company_id=p_company_id and project_id=p_project_id;
      insert into public.execution_service_contract_amendment_items(
        company_id,project_id,contract_id,amendment_id,contract_item_id,service_id,value_change,created_by
      ) values (
        p_company_id,p_project_id,c.id,new_id,ci.id,ci.service_id,allocation,auth.uid()
      );
    end loop;
  end if;

  if p_new_end_date is not null then
    update public.execution_service_contracts
    set end_date=p_new_end_date,updated_by=auth.uid(),updated_at=now()
    where id=c.id;
  end if;

  perform public.refresh_execution_service_contract_value(c.id);
  insert into public.execution_service_contract_audit(
    company_id,project_id,contract_id,action,previous_status,new_status,reason,details,changed_by
  ) values (
    p_company_id,p_project_id,c.id,'amendment',c.status,c.status,p_justification,
    jsonb_build_object('amendment_id',new_id,'value_change',coalesce(p_value_change,0),'new_end_date',p_new_end_date,'allocated_items',item_count),auth.uid()
  );
  return new_id;
end; $$;

grant execute on function public.add_execution_service_contract_amendment_with_items(uuid,uuid,uuid,text,text,numeric,date,text,jsonb) to authenticated;

commit;
