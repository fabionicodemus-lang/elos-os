-- Elos OS — Vistorias e Chamados · ajustes de execução
-- Preserva a não conformidade original durante a reinspeção e valida fornecedores da empresa.

begin;

create or replace function public.complete_postwork_unit_inspection(p_company_id uuid,p_project_id uuid,p_inspection_id uuid,p_items jsonb,p_general_notes text)
returns text language plpgsql security definer set search_path=public as $$
declare
  v_inspection public.postwork_unit_inspections%rowtype;
  v_item jsonb;
  v_row public.postwork_unit_inspection_items%rowtype;
  v_result text;
  v_supplier_id uuid;
  v_status text;
  v_is_reinspection boolean;
begin
  if not public.has_company_permission(p_company_id,'postwork.inspections.fill') then raise exception 'Sem permissão para concluir a vistoria.'; end if;
  select * into v_inspection from public.postwork_unit_inspections where id=p_inspection_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_inspection.id is null or v_inspection.status<>'in_progress' then raise exception 'Vistoria não está em preenchimento.'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then raise exception 'Itens do checklist inválidos.'; end if;
  v_is_reinspection:=v_inspection.completed_at is not null and exists(select 1 from public.postwork_unit_inspection_items where inspection_id=p_inspection_id and result='nonconform');

  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_row from public.postwork_unit_inspection_items where id=nullif(v_item->>'item_id','')::uuid and inspection_id=p_inspection_id for update;
    if v_row.id is null then raise exception 'Item do checklist inválido.'; end if;
    v_result:=coalesce(v_item->>'result','pending');
    if v_result not in ('pending','conform','nonconform','not_applicable') then raise exception 'Resultado de checklist inválido.'; end if;
    v_supplier_id:=nullif(v_item->>'supplier_id','')::uuid;
    if v_supplier_id is not null and not exists(select 1 from public.suppliers where id=v_supplier_id and company_id=p_company_id) then raise exception 'Fornecedor inválido no item %.',coalesce(v_row.code,v_row.title); end if;

    if v_is_reinspection and v_row.result='nonconform' then
      if v_row.correction_status not in ('corrected','open') then continue; end if;
      if v_result not in ('conform','nonconform') then raise exception 'Na reinspeção, informe Conforme ou Não conforme para o item %.',coalesce(v_row.code,v_row.title); end if;
      update public.postwork_unit_inspection_items set
        result='nonconform',
        correction_status=case when v_result='conform' then 'verified' else 'open' end,
        verification_notes=nullif(trim(coalesce(v_item->>'notes','')),''),
        verified_at=case when v_result='conform' then now() else null end,
        verified_by=case when v_result='conform' then auth.uid() else null end,
        updated_at=now()
      where id=v_row.id;
    elsif not v_is_reinspection then
      update public.postwork_unit_inspection_items set
        result=v_result,
        notes=nullif(trim(coalesce(v_item->>'notes','')),''),
        correction_status=case when v_result='nonconform' then 'open' else 'none' end,
        correction_due_date=case when v_result='nonconform' then nullif(v_item->>'correction_due_date','')::date else null end,
        correction_responsible_name=case when v_result='nonconform' then nullif(trim(coalesce(v_item->>'correction_responsible_name','')),'') else null end,
        supplier_id=case when v_result='nonconform' then v_supplier_id else null end,
        corrected_at=null,corrected_by=null,verified_at=null,verified_by=null,verification_notes=null,assistance_ticket_id=null,updated_at=now()
      where id=v_row.id;
    end if;
  end loop;

  if not v_is_reinspection and exists(select 1 from public.postwork_unit_inspection_items where inspection_id=p_inspection_id and is_mandatory and result='pending') then raise exception 'Responda todos os itens obrigatórios.'; end if;
  v_status:=case when exists(select 1 from public.postwork_unit_inspection_items where inspection_id=p_inspection_id and result='nonconform' and correction_status not in ('verified','transferred')) then 'pending_corrections' else 'approved' end;
  update public.postwork_unit_inspections set
    status=v_status,
    general_notes=coalesce(nullif(trim(coalesce(p_general_notes,'')),''),general_notes),
    completed_at=coalesce(completed_at,now()),
    approved_at=case when v_status='approved' then now() else approved_at end,
    updated_by=auth.uid(),updated_at=now()
  where id=p_inspection_id;
  insert into public.postwork_inspection_audit(company_id,project_id,inspection_id,action,previous_status,new_status,notes,details,changed_by)
  values(p_company_id,p_project_id,p_inspection_id,case when v_is_reinspection then 'reinspection' else 'completed' end,v_inspection.status,v_status,nullif(trim(coalesce(p_general_notes,'')),''),jsonb_build_object('reinspection',v_is_reinspection,'open_nonconformities',(select count(*) from public.postwork_unit_inspection_items where inspection_id=p_inspection_id and result='nonconform' and correction_status not in ('verified','transferred'))),auth.uid());
  return v_status;
end; $$;

grant execute on function public.complete_postwork_unit_inspection(uuid,uuid,uuid,jsonb,text) to authenticated;

commit;
