begin;

create or replace function public.ai_link_action_attachment(p_turn_id uuid,p_proposal_id uuid,p_file_name text)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare p public.ai_action_proposals%rowtype; attachment_id uuid;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  if nullif(trim(coalesce(p_file_name,'')),'') is null then return null; end if;
  select * into p from public.ai_action_proposals
  where id=p_proposal_id and turn_id=p_turn_id and created_by=auth.uid();
  if p.id is null then raise exception 'Proposta de ação não encontrada.'; end if;

  select a.id into attachment_id
  from public.ai_action_attachments a
  where a.company_id=p.company_id and a.turn_id=p_turn_id and a.uploaded_by=auth.uid()
    and a.file_name=p_file_name and a.proposal_id is null
  order by a.created_at,a.id
  limit 1
  for update;

  if attachment_id is null then raise exception 'Arquivo de origem não encontrado nesta pergunta.'; end if;
  update public.ai_action_attachments set proposal_id=p.id where id=attachment_id;
  return attachment_id;
end;
$$;

revoke execute on function public.ai_link_action_attachment(uuid,uuid,text) from public,anon;
grant execute on function public.ai_link_action_attachment(uuid,uuid,text) to authenticated;

commit;