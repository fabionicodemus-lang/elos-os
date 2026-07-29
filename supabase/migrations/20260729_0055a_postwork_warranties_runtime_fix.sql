-- Elos OS — Garantias · ajustes de consistência
-- Permite histórico de regras gerais sem obra arbitrária e analisa a vigência na data de abertura do chamado.

begin;

alter table public.postwork_warranty_audit alter column project_id drop not null;

create or replace function public.save_postwork_warranty_policy(
  p_company_id uuid,p_project_id uuid,p_policy_id uuid,p_code text,p_name text,p_scope_type text,p_category text,
  p_start_rule text,p_term_months integer,p_alert_days integer,p_supplier_id uuid,p_manufacturer text,
  p_coverage_terms text,p_exclusions text,p_maintenance_requirements text,p_status text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not public.has_company_permission(p_company_id,'postwork.warranties.manage') then raise exception 'Sem permissão para gerenciar regras de garantia.'; end if;
  if nullif(trim(coalesce(p_code,'')),'') is null or nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Informe código e nome da garantia.'; end if;
  if nullif(trim(coalesce(p_coverage_terms,'')),'') is null then raise exception 'Descreva as condições de cobertura.'; end if;
  if p_scope_type not in ('project','common_area','unit','system','equipment') then raise exception 'Abrangência inválida.'; end if;
  if p_category not in ('waterproofing','hydraulic','electrical','finishes','frames','painting','flooring','equipment','structure','gas','common_area','other') then raise exception 'Categoria inválida.'; end if;
  if p_start_rule not in ('project_delivery','unit_delivery','installation','purchase','custom') then raise exception 'Regra de início inválida.'; end if;
  if coalesce(p_term_months,0) not between 1 and 600 then raise exception 'Prazo de garantia inválido.'; end if;
  if coalesce(p_alert_days,0) not between 0 and 730 then raise exception 'Prazo do alerta inválido.'; end if;
  if p_project_id is not null and not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id) then raise exception 'Empreendimento inválido.'; end if;
  if p_supplier_id is not null and not exists(select 1 from public.suppliers where id=p_supplier_id and company_id=p_company_id) then raise exception 'Fornecedor inválido.'; end if;
  if p_status not in ('active','inactive') then raise exception 'Situação inválida.'; end if;

  if p_policy_id is null then
    insert into public.postwork_warranty_policies(company_id,project_id,code,name,scope_type,category,start_rule,term_months,alert_days,supplier_id,manufacturer,coverage_terms,exclusions,maintenance_requirements,status,created_by,updated_by)
    values(p_company_id,p_project_id,upper(trim(p_code)),trim(p_name),p_scope_type,p_category,p_start_rule,p_term_months,p_alert_days,p_supplier_id,nullif(trim(coalesce(p_manufacturer,'')),''),trim(p_coverage_terms),nullif(trim(coalesce(p_exclusions,'')),''),nullif(trim(coalesce(p_maintenance_requirements,'')),''),p_status,auth.uid(),auth.uid()) returning id into v_id;
  else
    update public.postwork_warranty_policies set project_id=p_project_id,code=upper(trim(p_code)),name=trim(p_name),scope_type=p_scope_type,category=p_category,start_rule=p_start_rule,term_months=p_term_months,alert_days=p_alert_days,supplier_id=p_supplier_id,manufacturer=nullif(trim(coalesce(p_manufacturer,'')),''),coverage_terms=trim(p_coverage_terms),exclusions=nullif(trim(coalesce(p_exclusions,'')),''),maintenance_requirements=nullif(trim(coalesce(p_maintenance_requirements,'')),''),status=p_status,updated_by=auth.uid(),updated_at=now()
    where id=p_policy_id and company_id=p_company_id returning id into v_id;
    if v_id is null then raise exception 'Regra de garantia não localizada.'; end if;
  end if;

  insert into public.postwork_warranty_audit(company_id,project_id,policy_id,action,details,changed_by)
  values(p_company_id,p_project_id,v_id,case when p_policy_id is null then 'policy_created' else 'policy_updated' end,jsonb_build_object('code',upper(trim(p_code)),'name',trim(p_name),'term_months',p_term_months),auth.uid());
  return v_id;
end; $$;

create or replace function public.analyze_postwork_assistance_warranty(
  p_company_id uuid,p_project_id uuid,p_ticket_id uuid,p_policy_id uuid,p_asset_id uuid,p_status text,p_reason text
) returns text language plpgsql security definer set search_path=public as $$
declare v_ticket public.postwork_assistance_tickets%rowtype; v_policy public.postwork_warranty_policies%rowtype; v_asset public.postwork_warranty_assets%rowtype; v_reference_date date;
begin
  if not public.has_company_permission(p_company_id,'postwork.warranties.analyze') then raise exception 'Sem permissão para analisar garantias.'; end if;
  if p_status not in ('pending','covered','not_covered','courtesy','not_applicable') then raise exception 'Resultado da análise inválido.'; end if;
  select * into v_ticket from public.postwork_assistance_tickets where id=p_ticket_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_ticket.id is null then raise exception 'Chamado técnico não localizado.'; end if;
  v_reference_date:=coalesce(v_ticket.opened_at,current_date);

  if p_policy_id is not null then
    select * into v_policy from public.postwork_warranty_policies where id=p_policy_id and company_id=p_company_id and status='active';
    if v_policy.id is null or (v_policy.project_id is not null and v_policy.project_id<>p_project_id) then raise exception 'Regra de garantia inválida.'; end if;
  end if;
  if p_asset_id is not null then
    select * into v_asset from public.postwork_warranty_assets where id=p_asset_id and company_id=p_company_id and project_id=p_project_id;
    if v_asset.id is null then raise exception 'Item garantido inválido.'; end if;
    if p_policy_id is null then
      p_policy_id:=v_asset.policy_id;
      select * into v_policy from public.postwork_warranty_policies where id=p_policy_id and company_id=p_company_id;
    elsif v_asset.policy_id<>p_policy_id then
      raise exception 'O item não pertence à regra selecionada.';
    end if;
    if v_ticket.unit_id is not null and v_asset.unit_id is not null and v_asset.unit_id<>v_ticket.unit_id then raise exception 'O item garantido pertence a outra unidade.'; end if;
  end if;
  if p_status='covered' then
    if v_asset.id is null then raise exception 'Selecione o item garantido para confirmar a cobertura.'; end if;
    if v_asset.status<>'active' then raise exception 'O item garantido está cancelado.'; end if;
    if v_reference_date<v_asset.start_date or v_reference_date>v_asset.end_date then raise exception 'A vigência do item não cobre a data de abertura do chamado. Use cortesia ou não coberta conforme a decisão técnica.'; end if;
  end if;
  if p_status in ('not_covered','courtesy') and nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Justifique a decisão de garantia.'; end if;

  update public.postwork_assistance_tickets set warranty_status=p_status,warranty_reason=nullif(trim(coalesce(p_reason,'')),''),warranty_policy_id=p_policy_id,warranty_asset_id=p_asset_id,warranty_analysis_at=now(),warranty_analyzed_by=auth.uid(),updated_by=auth.uid(),updated_at=now() where id=p_ticket_id;
  insert into public.postwork_assistance_audit(company_id,project_id,ticket_id,action,notes,details,changed_by)
  values(p_company_id,p_project_id,p_ticket_id,'warranty_analyzed',p_reason,jsonb_build_object('status',p_status,'policy_id',p_policy_id,'asset_id',p_asset_id,'reference_date',v_reference_date),auth.uid());
  insert into public.postwork_warranty_audit(company_id,project_id,policy_id,asset_id,assistance_ticket_id,action,notes,details,changed_by)
  values(p_company_id,p_project_id,p_policy_id,p_asset_id,p_ticket_id,'assistance_analyzed',p_reason,jsonb_build_object('status',p_status,'ticket_number',v_ticket.number,'reference_date',v_reference_date),auth.uid());
  return p_status;
end; $$;

commit;
