-- Elos OS — ativa automaticamente contratos formulados pelo fluxo aprovado
-- Evita que a edição manual de itens desmonte as etapas de medição já definidas.

begin;

create or replace function public.activate_service_contract_from_approved_request()
returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status='contracted' and new.contract_id is not null and (old.status is distinct from new.status or old.contract_id is distinct from new.contract_id) then
    update public.execution_service_contracts
    set status='active',activated_by=coalesce(auth.uid(),new.updated_by,new.created_by),activated_at=now(),updated_by=coalesce(auth.uid(),new.updated_by,new.created_by),updated_at=now()
    where id=new.contract_id and service_request_id=new.id and status='draft';

    insert into public.execution_service_contract_audit(company_id,project_id,contract_id,action,previous_status,new_status,reason,details,changed_by)
    select c.company_id,c.project_id,c.id,'activated','draft','active','Ativação automática após aprovação do mapa e definição das etapas de medição',
      jsonb_build_object('service_request_id',new.id,'request_number',new.request_number),coalesce(auth.uid(),new.updated_by,new.created_by)
    from public.execution_service_contracts c
    where c.id=new.contract_id and c.service_request_id=new.id and c.status='active'
      and not exists(select 1 from public.execution_service_contract_audit a where a.contract_id=c.id and a.action='activated' and a.details->>'service_request_id'=new.id::text);
  end if;
  return new;
end; $$;

drop trigger if exists activate_service_contract_from_approved_request_trigger on public.execution_service_requests;
create trigger activate_service_contract_from_approved_request_trigger
after update of status,contract_id on public.execution_service_requests
for each row execute function public.activate_service_contract_from_approved_request();

grant execute on function public.activate_service_contract_from_approved_request() to authenticated;

commit;
