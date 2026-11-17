-- One explicit human confirmation, one transaction, and one permanent source.
begin;

create or replace function elos_ia_private.ai_execute_document_action_proposal(p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare p public.ai_action_proposals%rowtype; a public.ai_action_attachments%rowtype;
  v_result jsonb; duplicate_id uuid; n integer;
begin
  if auth.uid() is null then raise exception 'Sua sessão expirou.'; end if;
  select * into p from public.ai_action_proposals where id=p_proposal_id for update;
  if p.id is null or p.action_type not in ('commercial_sale_create','procurement_quotation_create','execution_contract_create')
    then raise exception 'Rascunho de documento não encontrado.'; end if;
  -- Check authorization BEFORE returning even an already executed result.
  if not public.has_company_permission(p.company_id,'ai.assistant.use')
    or not public.has_company_permission(p.company_id,public.ai_action_required_permission(p.action_type))
    then raise exception 'Você não tem permissão para confirmar este lançamento.'; end if;
  if not exists(select 1 from public.projects where id=p.project_id and company_id=p.company_id)
    then raise exception 'A obra não pertence à empresa do rascunho.'; end if;
  if p.status='executed' then return coalesce(p.result,'{}'::jsonb); end if;
  if p.status<>'pending_review' then raise exception 'Este rascunho não está mais aguardando confirmação.'; end if;
  if p.expires_at<=now() then raise exception 'Este rascunho expirou. Reenvie o documento e revise novamente.'; end if;
  if p.preview->'blocked' is distinct from 'false'::jsonb then
    raise exception '%',coalesce(p.preview->>'blockReason','Resolva as pendências do documento antes de gerar.');
  end if;
  if p.document_fingerprint is null then raise exception 'Documento sem identificação verificável. Prepare novamente.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p.company_id::text||':'||p.action_type||':'||p.document_fingerprint,0));
  select id into duplicate_id from public.ai_action_proposals
    where company_id=p.company_id and action_type=p.action_type and document_fingerprint=p.document_fingerprint
      and status='executed' and id<>p.id limit 1;
  if duplicate_id is not null then raise exception 'Este documento já foi confirmado em outro rascunho (%).',duplicate_id; end if;
  select count(*) into n from public.ai_action_attachments where proposal_id=p.id and company_id=p.company_id;
  if n<>1 then raise exception 'Não foi possível verificar o documento vinculado. Prepare novamente.'; end if;
  select * into a from public.ai_action_attachments where proposal_id=p.id and company_id=p.company_id for update;
  if a.content_sha256 is null or a.content_sha256<>split_part(p.document_fingerprint,':',1)
    or a.expires_at is null or a.expires_at<=now()
    or p.preview->>'sourceFile' is distinct from a.file_name
    or p.preview->>'kind' is distinct from p.action_type
    or not exists(select 1 from storage.objects where bucket_id='ai-action-attachments' and name=a.storage_path)
    then raise exception 'O documento de origem não está disponível ou foi alterado. Prepare novamente.'; end if;

  if p.action_type='commercial_sale_create' then
    if public.ai_validate_sale_document_preview(p.company_id,p.project_id,p.payload,p.preview) is distinct from true then
      raise exception 'Os dados da venda mudaram ou divergem da revisão. Prepare novamente.';
    end if;
    v_result:=public.ai_create_sale_from_document(p.company_id,p.project_id,p.payload);
  elsif p.action_type='procurement_quotation_create' then
    if public.ai_validate_procurement_document_preview(p.company_id,p.project_id,p.action_type,p.payload,p.preview) is distinct from true then
      raise exception 'Os dados da cotação mudaram ou divergem da revisão. Prepare novamente.';
    end if;
    v_result:=public.ai_create_quotation_from_document(p.company_id,p.project_id,p.payload);
  else
    if public.ai_validate_procurement_document_preview(p.company_id,p.project_id,p.action_type,p.payload,p.preview) is distinct from true then
      raise exception 'Os dados da contratação mudaram ou divergem da revisão. Prepare novamente.';
    end if;
    v_result:=public.ai_create_service_contract_from_document(p.company_id,p.project_id,p.payload);
  end if;
  if v_result is null or jsonb_typeof(v_result)<>'object' then raise exception 'O módulo não retornou o registro criado.'; end if;
  v_result:=v_result||jsonb_build_object('source_proposal_id',p.id);
  update public.ai_action_proposals set status='executed',reviewed_by=auth.uid(),reviewed_at=now(),
    executed_by=auth.uid(),executed_at=now(),result=v_result,last_error=null,updated_at=now() where id=p.id;
  update public.ai_action_attachments set retained_at=now(),expires_at=null where id=a.id;
  return v_result;
end;
$$;
revoke execute on function elos_ia_private.ai_execute_document_action_proposal(uuid) from public,anon;
grant execute on function elos_ia_private.ai_execute_document_action_proposal(uuid) to authenticated;
create or replace function public.ai_execute_document_action_proposal(p_proposal_id uuid)
returns jsonb language sql security invoker set search_path=''
as $$select elos_ia_private.ai_execute_document_action_proposal(p_proposal_id)$$;
revoke execute on function public.ai_execute_document_action_proposal(uuid) from public,anon;
grant execute on function public.ai_execute_document_action_proposal(uuid) to authenticated;

-- Helpers are deliberately unavailable as independent API calls.
revoke execute on function public.ai_create_sale_from_document(uuid,uuid,jsonb) from public,anon,authenticated;
revoke execute on function public.ai_create_quotation_from_document(uuid,uuid,jsonb) from public,anon,authenticated;
revoke execute on function public.ai_create_service_contract_from_document(uuid,uuid,jsonb) from public,anon,authenticated;
commit;
