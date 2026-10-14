-- Elos OS — Incorporação · integridade transacional de participantes
begin;

create or replace function public.commercial_save_sale_party(
  p_company_id uuid,
  p_sale_id uuid,
  p_client_id uuid,
  p_role text,
  p_ownership_percent numeric default null,
  p_is_primary boolean default false,
  p_joined_at date default null,
  p_notes text default null,
  p_user_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  s public.sales;
  party_id uuid;
  actor uuid:=coalesce(p_user_id,auth.uid());
begin
  if not public.has_company_permission(p_company_id,'commercial.incorporation.manage') then
    raise exception 'Sem permissão para alterar participantes da venda.';
  end if;
  if p_role not in ('buyer','co_buyer','spouse','guarantor','assignee','representative','other') then
    raise exception 'Papel contratual inválido.';
  end if;
  if p_ownership_percent is not null and (p_ownership_percent<0 or p_ownership_percent>100) then
    raise exception 'Participação deve estar entre 0 e 100%%.';
  end if;

  select * into s from public.sales where id=p_sale_id and company_id=p_company_id for update;
  if s.id is null then raise exception 'Venda não encontrada.'; end if;
  if not exists(select 1 from public.clients c where c.id=p_client_id and c.company_id=p_company_id) then
    raise exception 'Cliente não pertence à empresa.';
  end if;

  if p_is_primary then
    update public.commercial_sale_parties
       set is_primary=false,updated_at=now()
     where sale_id=s.id and company_id=p_company_id and is_primary=true
       and not (client_id=p_client_id and role=p_role);
  end if;

  insert into public.commercial_sale_parties(
    company_id,project_id,sale_id,client_id,role,ownership_percent,is_primary,status,joined_at,notes,created_by,updated_at
  ) values(
    s.company_id,s.project_id,s.id,p_client_id,p_role,p_ownership_percent,p_is_primary,'active',p_joined_at,p_notes,actor,now()
  )
  on conflict(sale_id,client_id,role) do update set
    ownership_percent=excluded.ownership_percent,
    is_primary=excluded.is_primary,
    status='active',
    joined_at=coalesce(excluded.joined_at,public.commercial_sale_parties.joined_at),
    left_at=null,
    notes=excluded.notes,
    updated_at=now()
  returning id into party_id;

  if p_is_primary then
    update public.sales set client_id=p_client_id,updated_at=now() where id=s.id;
  end if;
  return party_id;
end $$;

grant execute on function public.commercial_save_sale_party(uuid,uuid,uuid,text,numeric,boolean,date,text,uuid) to authenticated;

commit;
