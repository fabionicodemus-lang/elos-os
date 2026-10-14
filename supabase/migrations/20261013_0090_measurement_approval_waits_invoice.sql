-- Elos OS — Medições: aprovação técnica volta a aguardar a nota fiscal.
--
-- Problema (teste da obra Vinicius, out/2026): desde a 0075 a aprovação já criava
-- a conta a pagar com o número da medição como documento e vencimento contado a
-- partir de HOJE (current_date + prazo), e marcava a medição como 'invoiced'.
-- Com isso:
--   * a nota fiscal real nunca podia ser vinculada à medição (o lançamento de
--     nota manual exige medição 'approved' sem conta a pagar);
--   * lançar a nota separada gerava conta a pagar em duplicidade;
--   * o vencimento ignorava o período medido.
--
-- Correção: aprovar a medição apenas aprova (status 'approved', sem conta a
-- pagar). A conta nasce quando o financeiro informa a nota — pelo formulário
-- "Vincular nota e gerar conta a pagar" da própria medição
-- (send_execution_contract_measurement_to_finance) ou por uma Nota Manual
-- vinculada à medição — com número, emissão e vencimento corretos.

begin;

create or replace function public.approve_execution_contract_measurement(
  p_company_id uuid,p_project_id uuid,p_measurement_id uuid,p_notes text
) returns text
language plpgsql security definer set search_path=public as $$
declare
  m public.execution_contract_measurements%rowtype;
begin
  if not public.has_company_permission(p_company_id,'execution.measurements.approve') then
    raise exception 'Sem permissão para aprovar medições.';
  end if;
  select * into m
  from public.execution_contract_measurements
  where id=p_measurement_id and company_id=p_company_id and project_id=p_project_id
  for update;
  if m.id is null or m.status<>'submitted' then raise exception 'Medição não disponível para aprovação.'; end if;
  if m.payable_id is not null then raise exception 'A medição já possui conta a pagar vinculada.'; end if;

  update public.execution_contract_measurements set
    status='approved',approved_by=auth.uid(),approved_at=now(),approval_notes=nullif(trim(coalesce(p_notes,'')),''),
    updated_by=auth.uid(),updated_at=now()
  where id=m.id;

  perform public.refresh_execution_service_contract_measurements(m.contract_id);
  insert into public.execution_contract_measurement_audit(
    company_id,project_id,measurement_id,action,previous_status,new_status,reason,details,changed_by
  ) values (
    p_company_id,p_project_id,m.id,'approved','submitted','approved',nullif(trim(coalesce(p_notes,'')),''),
    jsonb_build_object('net_amount',m.net_amount),auth.uid()
  );
  return 'approved';
end; $$;

grant execute on function public.approve_execution_contract_measurement(uuid,uuid,uuid,text) to authenticated;

commit;
