-- Elos IA · Safe Write
-- A IA prepara propostas imutáveis. A execução só ocorre após ação humana
-- e revalida a permissão atual do usuário + as RPCs oficiais de cada módulo.
begin;

create table if not exists public.ai_action_proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  turn_id uuid not null,
  persona text not null,
  action_type text not null check (action_type in ('procurement_supplier_offer','execution_contract_measurement')),
  required_permission text not null,
  title text not null,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  preview jsonb not null default '{}'::jsonb,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  status text not null default 'pending_review' check (status in ('pending_review','executing','executed','rejected','failed','expired')),
  created_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  executed_by uuid references auth.users(id),
  executed_at timestamptz,
  result jsonb,
  last_error text,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_action_proposals_company_status_idx
  on public.ai_action_proposals(company_id,status,created_at desc);
create index if not exists ai_action_proposals_turn_idx
  on public.ai_action_proposals(company_id,turn_id,created_at);
create index if not exists ai_action_proposals_project_idx
  on public.ai_action_proposals(company_id,project_id,status,created_at desc)
  where project_id is not null;

create table if not exists public.ai_action_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  turn_id uuid not null,
  proposal_id uuid references public.ai_action_proposals(id) on delete set null,
  uploaded_by uuid not null references auth.users(id),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint not null default 0 check (file_size >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  unique(company_id,storage_path)
);
create index if not exists ai_action_attachments_turn_idx
  on public.ai_action_attachments(company_id,turn_id,uploaded_by);
create index if not exists ai_action_attachments_proposal_idx
  on public.ai_action_attachments(proposal_id) where proposal_id is not null;

create or replace function public.ai_action_required_permission(p_action_type text)
returns text
language sql
immutable
set search_path=''
as $$
  select case p_action_type
    when 'procurement_supplier_offer' then 'procurement.quotations.manage'
    when 'execution_contract_measurement' then 'execution.measurements.manage'
    else null
  end
$$;

create or replace function public.ai_action_proposal_before_write()
returns trigger
language plpgsql
set search_path=''
as $$
declare required text;
begin
  required := public.ai_action_required_permission(new.action_type);
  if required is null then raise exception 'Tipo de ação do Elos IA não suportado.'; end if;
  new.required_permission := required;
  new.updated_at := now();
  if tg_op='UPDATE' then
    if old.company_id<>new.company_id or old.project_id is distinct from new.project_id
       or old.turn_id<>new.turn_id or old.action_type<>new.action_type
       or old.payload<>new.payload or old.preview<>new.preview or old.created_by<>new.created_by then
      raise exception 'A proposta preparada pelo Elos IA é imutável.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ai_action_proposal_before_write_trg on public.ai_action_proposals;
create trigger ai_action_proposal_before_write_trg
before insert or update on public.ai_action_proposals
for each row execute function public.ai_action_proposal_before_write();

alter table public.ai_action_proposals enable row level security;
alter table public.ai_action_attachments enable row level security;

revoke all on public.ai_action_proposals from anon,authenticated;
revoke all on public.ai_action_attachments from anon,authenticated;
grant select,insert on public.ai_action_proposals to authenticated;
grant select,insert on public.ai_action_attachments to authenticated;

create policy ai_action_proposals_select on public.ai_action_proposals
for select to authenticated
using (
  created_by=(select auth.uid())
  or public.has_company_permission(company_id,required_permission)
);

create policy ai_action_proposals_insert on public.ai_action_proposals
for insert to authenticated
with check (
  created_by=(select auth.uid())
  and public.has_company_permission(company_id,'ai.assistant.use')
  and public.has_company_permission(company_id,required_permission)
);

create policy ai_action_attachments_select on public.ai_action_attachments
for select to authenticated
using (
  uploaded_by=(select auth.uid())
  or exists (
    select 1 from public.ai_action_proposals p
    where p.id=proposal_id and p.company_id=company_id
      and public.has_company_permission(p.company_id,p.required_permission)
  )
);

create policy ai_action_attachments_insert on public.ai_action_attachments
for insert to authenticated
with check (
  uploaded_by=(select auth.uid())
  and public.has_company_permission(company_id,'ai.assistant.use')
);

-- Bucket privado usado somente enquanto a ação aguarda revisão.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'ai-action-attachments','ai-action-attachments',false,15728640,
  array[
    'application/pdf','image/jpeg','image/png','image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel','text/csv','text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ]::text[]
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create policy ai_action_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='ai-action-attachments'
  and split_part(name,'/',2)=(select auth.uid())::text
  and public.has_company_permission(split_part(name,'/',1)::uuid,'ai.assistant.use')
);

create policy ai_action_storage_select on storage.objects
for select to authenticated
using (
  bucket_id='ai-action-attachments'
  and (
    split_part(name,'/',2)=(select auth.uid())::text
    or exists (
      select 1 from public.ai_action_attachments a
      join public.ai_action_proposals p on p.id=a.proposal_id
      where a.storage_path=name
        and p.company_id=a.company_id
        and public.has_company_permission(p.company_id,p.required_permission)
    )
  )
);

create policy ai_action_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id='ai-action-attachments'
  and split_part(name,'/',2)=(select auth.uid())::text
);

create or replace function public.ai_link_action_attachments(p_turn_id uuid,p_proposal_id uuid)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare p public.ai_action_proposals%rowtype; n integer;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  select * into p from public.ai_action_proposals
  where id=p_proposal_id and turn_id=p_turn_id and created_by=auth.uid();
  if p.id is null then raise exception 'Proposta de ação não encontrada.'; end if;
  update public.ai_action_attachments
     set proposal_id=p.id
   where company_id=p.company_id and turn_id=p_turn_id
     and uploaded_by=auth.uid() and proposal_id is null;
  get diagnostics n=row_count;
  return n;
end;
$$;

create or replace function public.ai_claim_action_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare p public.ai_action_proposals%rowtype;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  select * into p from public.ai_action_proposals where id=p_proposal_id for update;
  if p.id is null then raise exception 'Ação preparada não encontrada.'; end if;
  if p.status<>'pending_review' then raise exception 'Esta ação não está mais aguardando revisão.'; end if;
  if p.expires_at<=now() then
    update public.ai_action_proposals set status='expired',updated_at=now() where id=p.id;
    raise exception 'Esta ação expirou. Peça para a Elos IA preparar novamente.';
  end if;
  if not public.has_company_permission(p.company_id,p.required_permission) then
    raise exception 'Você não possui a permissão necessária para executar esta ação.';
  end if;
  update public.ai_action_proposals
     set status='executing',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
   where id=p.id;
  p.status:='executing'; p.reviewed_by:=auth.uid(); p.reviewed_at:=now();
  return to_jsonb(p);
end;
$$;

create or replace function public.ai_finish_action_proposal(p_proposal_id uuid,p_result jsonb)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  update public.ai_action_proposals
     set status='executed',executed_by=auth.uid(),executed_at=now(),result=coalesce(p_result,'{}'::jsonb),last_error=null,updated_at=now()
   where id=p_proposal_id and status='executing' and reviewed_by=auth.uid();
  if not found then raise exception 'A ação não está em execução por este usuário.'; end if;
end;
$$;

create or replace function public.ai_fail_action_proposal(p_proposal_id uuid,p_error text)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  update public.ai_action_proposals
     set status='failed',last_error=left(coalesce(p_error,'Falha ao executar.'),1000),updated_at=now()
   where id=p_proposal_id and status='executing' and reviewed_by=auth.uid();
  if not found then raise exception 'A ação não está em execução por este usuário.'; end if;
end;
$$;

create or replace function public.ai_reject_action_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare p public.ai_action_proposals%rowtype;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  select * into p from public.ai_action_proposals where id=p_proposal_id for update;
  if p.id is null or p.status<>'pending_review' then raise exception 'Ação não disponível para rejeição.'; end if;
  if p.created_by<>auth.uid() and not public.has_company_permission(p.company_id,p.required_permission) then
    raise exception 'Sem permissão para rejeitar esta ação.';
  end if;
  update public.ai_action_proposals
     set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
   where id=p.id;
end;
$$;

revoke execute on function public.ai_action_required_permission(text) from public,anon;
revoke execute on function public.ai_link_action_attachments(uuid,uuid) from public,anon;
revoke execute on function public.ai_claim_action_proposal(uuid) from public,anon;
revoke execute on function public.ai_finish_action_proposal(uuid,jsonb) from public,anon;
revoke execute on function public.ai_fail_action_proposal(uuid,text) from public,anon;
revoke execute on function public.ai_reject_action_proposal(uuid) from public,anon;
grant execute on function public.ai_action_required_permission(text) to authenticated;
grant execute on function public.ai_link_action_attachments(uuid,uuid) to authenticated;
grant execute on function public.ai_claim_action_proposal(uuid) to authenticated;
grant execute on function public.ai_finish_action_proposal(uuid,jsonb) to authenticated;
grant execute on function public.ai_fail_action_proposal(uuid,text) to authenticated;
grant execute on function public.ai_reject_action_proposal(uuid) to authenticated;

comment on table public.ai_action_proposals is 'Propostas imutáveis preparadas pela Elos IA para revisão humana antes de qualquer escrita operacional.';
comment on table public.ai_action_attachments is 'Arquivos temporários enviados à Elos IA e vinculados a uma proposta de ação.';

commit;