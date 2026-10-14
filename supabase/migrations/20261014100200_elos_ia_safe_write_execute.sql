begin;

-- Execução atômica: valida permissão atual, chama a MESMA RPC do fluxo manual
-- e marca a proposta como executada na mesma transação. Assim não existe janela
-- em que o lançamento foi criado mas o cartão ficou pendente para um duplo clique.
create or replace function public.ai_execute_action_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  p public.ai_action_proposals%rowtype;
  offer_id uuid;
  measurement_id uuid;
  result jsonb;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  select * into p from public.ai_action_proposals where id=p_proposal_id for update;
  if p.id is null then raise exception 'Ação preparada não encontrada.'; end if;
  if p.status='executed' then return coalesce(p.result,'{}'::jsonb); end if;
  if p.status<>'pending_review' then raise exception 'Esta ação não está mais aguardando revisão.'; end if;
  if p.expires_at<=now() then
    update public.ai_action_proposals set status='expired',updated_at=now() where id=p.id;
    raise exception 'Esta ação expirou. Peça para a Elos IA preparar novamente.';
  end if;
  if not public.has_company_permission(p.company_id,p.required_permission) then
    raise exception 'Você não possui a permissão necessária para executar esta ação.';
  end if;
  if coalesce((p.preview->>'blocked')::boolean,false) then
    raise exception '%',coalesce(p.preview->>'blockReason','Esta ação possui uma divergência que exige tratamento manual.');
  end if;

  if p.action_type='procurement_supplier_offer' then
    offer_id := public.save_procurement_material_supplier_offer(
      p.company_id,p.project_id,
      (p.payload->>'quotationId')::uuid,(p.payload->>'supplierId')::uuid,
      p.payload->>'proposalNumber',nullif(p.payload->>'proposalDate','')::date,nullif(p.payload->>'validityDate','')::date,
      p.payload->>'paymentTerms',nullif(p.payload->>'deliveryDays','')::integer,
      p.payload->>'freightTerms',p.payload->>'warrantyTerms',p.payload->>'notes',p.payload->'items'
    );
    result:=jsonb_build_object('kind','procurement_supplier_offer','offer_id',offer_id,'quotation_id',p.payload->>'quotationId','supplier_id',p.payload->>'supplierId');
  elsif p.action_type='execution_contract_measurement' then
    measurement_id := public.save_execution_contract_measurement(
      p.company_id,p.project_id,null,
      (p.payload->>'contractId')::uuid,(p.payload->>'periodStart')::date,(p.payload->>'periodEnd')::date,
      coalesce((p.payload->>'taxWithholding')::numeric,0),coalesce((p.payload->>'advanceDeduction')::numeric,0),coalesce((p.payload->>'otherDiscount')::numeric,0),
      p.payload->>'notes',p.payload->>'contractorNotes',p.payload->'items',false
    );
    result:=jsonb_build_object('kind','execution_contract_measurement','measurement_id',measurement_id,'contract_id',p.payload->>'contractId');
  else
    raise exception 'Tipo de ação não suportado.';
  end if;

  update public.ai_action_proposals
     set status='executed',reviewed_by=auth.uid(),reviewed_at=now(),executed_by=auth.uid(),executed_at=now(),result=result,last_error=null,updated_at=now()
   where id=p.id;
  return result;
exception when others then
  -- A exceção reverte também qualquer escrita do domínio. O cartão permanece
  -- pendente porque a transação inteira é atômica, permitindo corrigir a origem.
  raise;
end;
$$;

revoke execute on function public.ai_execute_action_proposal(uuid) from public,anon;
grant execute on function public.ai_execute_action_proposal(uuid) to authenticated;

commit;