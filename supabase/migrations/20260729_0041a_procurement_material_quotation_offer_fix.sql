-- Elos OS — correções transacionais das propostas da cotação 0041

begin;

create or replace function public.save_procurement_material_supplier_offer(
  p_company_id uuid,p_project_id uuid,p_quotation_id uuid,p_supplier_id uuid,
  p_proposal_number text,p_proposal_date date,p_validity_date date,p_payment_terms text,p_delivery_days integer,
  p_freight_terms text,p_warranty_terms text,p_notes text,p_items jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  q public.procurement_material_quotations%rowtype; qs public.procurement_material_quotation_suppliers%rowtype;
  qi public.procurement_material_quotation_items%rowtype; item jsonb; v_offer_id uuid; qty numeric; price numeric; discount_pct numeric; tax_pct numeric;
  freight numeric; other_cost numeric; subtotal numeric; total numeric; n integer:=0; offer_total numeric:=0;
begin
  if not public.has_company_permission(p_company_id,'procurement.quotations.manage') then raise exception 'Sem permissão para registrar propostas.'; end if;
  select * into q from public.procurement_material_quotations where id=p_quotation_id and company_id=p_company_id and project_id=p_project_id for update;
  if q.id is null or q.status<>'collecting' then raise exception 'A cotação não está recebendo propostas.'; end if;
  select * into qs from public.procurement_material_quotation_suppliers where quotation_id=q.id and supplier_id=p_supplier_id;
  if qs.id is null then raise exception 'O fornecedor não foi convidado para esta cotação.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Informe os preços propostos.'; end if;

  insert into public.procurement_material_quotation_offers(company_id,project_id,quotation_id,quotation_supplier_id,supplier_id,status,proposal_number,proposal_date,validity_date,payment_terms,delivery_days,freight_terms,warranty_terms,notes,received_by,updated_by)
  values(p_company_id,p_project_id,q.id,qs.id,p_supplier_id,'received',nullif(trim(coalesce(p_proposal_number,'')),''),p_proposal_date,p_validity_date,nullif(trim(coalesce(p_payment_terms,'')),''),p_delivery_days,nullif(trim(coalesce(p_freight_terms,'')),''),nullif(trim(coalesce(p_warranty_terms,'')),''),nullif(trim(coalesce(p_notes,'')),''),auth.uid(),auth.uid())
  on conflict(quotation_id,supplier_id) do update set status='received',proposal_number=excluded.proposal_number,proposal_date=excluded.proposal_date,validity_date=excluded.validity_date,payment_terms=excluded.payment_terms,delivery_days=excluded.delivery_days,freight_terms=excluded.freight_terms,warranty_terms=excluded.warranty_terms,notes=excluded.notes,updated_by=auth.uid(),updated_at=now()
  returning id into v_offer_id;
  delete from public.procurement_material_quotation_offer_items where offer_id=v_offer_id;

  for item in select value from jsonb_array_elements(p_items) loop
    qty:=coalesce(nullif(item->>'quantity_offered','')::numeric,0); price:=coalesce(nullif(item->>'unit_price','')::numeric,0);
    if qty<=0 then continue; end if;
    select * into qi from public.procurement_material_quotation_items where id=nullif(item->>'quotation_item_id','')::uuid and quotation_id=q.id;
    if qi.id is null then raise exception 'Um dos itens não pertence à cotação.'; end if;
    if qty>qi.quantity_to_quote+0.000001 then raise exception 'A quantidade ofertada de % ultrapassa a quantidade solicitada.',qi.input_code; end if;
    discount_pct:=greatest(least(coalesce(nullif(item->>'discount_percent','')::numeric,0),100),0);
    tax_pct:=greatest(least(coalesce(nullif(item->>'tax_percent','')::numeric,0),100),0);
    freight:=greatest(coalesce(nullif(item->>'freight_amount','')::numeric,0),0);
    other_cost:=greatest(coalesce(nullif(item->>'other_cost_amount','')::numeric,0),0);
    subtotal:=qty*price*(1-discount_pct/100);
    total:=round(subtotal*(1+tax_pct/100)+freight+other_cost,2);
    n:=n+1; offer_total:=offer_total+total;
    insert into public.procurement_material_quotation_offer_items(company_id,project_id,quotation_id,offer_id,supplier_id,quotation_item_id,quantity_offered,unit_price,discount_percent,tax_percent,freight_amount,other_cost_amount,delivered_unit_cost,total_delivered_cost,brand,manufacturer,delivery_days,meets_specification,technical_notes)
    values(p_company_id,p_project_id,q.id,v_offer_id,p_supplier_id,qi.id,qty,price,discount_pct,tax_pct,freight,other_cost,case when qty>0 then round(total/qty,6) else 0 end,total,nullif(trim(coalesce(item->>'brand','')),''),nullif(trim(coalesce(item->>'manufacturer','')),''),nullif(item->>'delivery_days','')::integer,coalesce((item->>'meets_specification')::boolean,true),nullif(trim(coalesce(item->>'technical_notes','')),''));
  end loop;
  if n=0 then raise exception 'Informe ao menos um item com quantidade ofertada.'; end if;
  update public.procurement_material_quotation_offers set total_delivered_cost=offer_total,updated_at=now() where id=v_offer_id;
  update public.procurement_material_quotation_suppliers set status='responded',responded_at=now(),updated_at=now() where id=qs.id;
  perform public.refresh_procurement_material_quotation(q.id);
  insert into public.procurement_material_quotation_audit(company_id,project_id,quotation_id,action,previous_status,new_status,details,changed_by) values(p_company_id,p_project_id,q.id,'offer_received',q.status,q.status,jsonb_build_object('supplier_id',p_supplier_id,'offer_id',v_offer_id,'total',offer_total),auth.uid());
  return v_offer_id;
end; $$;

create or replace function public.approve_procurement_material_quotation(
  p_company_id uuid,p_project_id uuid,p_quotation_id uuid,p_approval_notes text,p_awards jsonb
) returns text language plpgsql security definer set search_path=public as $$
declare
  q public.procurement_material_quotations%rowtype; qi public.procurement_material_quotation_items%rowtype;
  selected_offer_item public.procurement_material_quotation_offer_items%rowtype; award jsonb; n integer:=0; total numeric:=0; lot_supplier uuid:=null;
begin
  if not public.has_company_permission(p_company_id,'procurement.quotations.approve') then raise exception 'Sem permissão para aprovar a cotação.'; end if;
  select * into q from public.procurement_material_quotations where id=p_quotation_id and company_id=p_company_id and project_id=p_project_id for update;
  if q.id is null or q.status<>'analysis' then raise exception 'Cotação não disponível para aprovação.'; end if;
  if jsonb_typeof(p_awards)<>'array' then raise exception 'Seleção de vencedores inválida.'; end if;
  delete from public.procurement_material_quotation_awards where quotation_id=q.id;
  update public.procurement_material_quotation_offer_items set is_selected=false where quotation_id=q.id;
  update public.procurement_material_quotation_items set awarded_supplier_id=null,awarded_offer_item_id=null,awarded_quantity=0,awarded_unit_cost=null,awarded_total_cost=0 where quotation_id=q.id;

  for award in select value from jsonb_array_elements(p_awards) loop
    select * into qi from public.procurement_material_quotation_items where id=nullif(award->>'quotation_item_id','')::uuid and quotation_id=q.id;
    if qi.id is null then raise exception 'Um dos itens não pertence à cotação.'; end if;
    select offer_item.* into selected_offer_item
    from public.procurement_material_quotation_offer_items offer_item
    join public.procurement_material_quotation_offers offer_header on offer_header.id=offer_item.offer_id
    where offer_item.id=nullif(award->>'offer_item_id','')::uuid and offer_item.quotation_item_id=qi.id and offer_item.meets_specification and offer_header.status='received';
    if selected_offer_item.id is null then raise exception 'Selecione uma proposta tecnicamente válida para %.',qi.input_code; end if;
    if selected_offer_item.quantity_offered+0.000001<qi.quantity_to_quote then raise exception 'A proposta escolhida não atende toda a quantidade de %.',qi.input_code; end if;
    if q.award_mode='lot' then
      if lot_supplier is null then lot_supplier:=selected_offer_item.supplier_id; elsif lot_supplier<>selected_offer_item.supplier_id then raise exception 'No fechamento por lote, todos os itens devem ser atribuídos ao mesmo fornecedor.'; end if;
    end if;
    n:=n+1; total:=total+round(qi.quantity_to_quote*selected_offer_item.delivered_unit_cost,2);
    insert into public.procurement_material_quotation_awards(company_id,project_id,quotation_id,quotation_item_id,offer_id,offer_item_id,supplier_id,awarded_quantity,awarded_unit_cost,awarded_total_cost,justification,approved_by)
    values(p_company_id,p_project_id,q.id,qi.id,selected_offer_item.offer_id,selected_offer_item.id,selected_offer_item.supplier_id,qi.quantity_to_quote,selected_offer_item.delivered_unit_cost,round(qi.quantity_to_quote*selected_offer_item.delivered_unit_cost,2),nullif(trim(coalesce(award->>'justification','')),''),auth.uid());
    update public.procurement_material_quotation_offer_items set is_selected=true where id=selected_offer_item.id;
    update public.procurement_material_quotation_items set awarded_supplier_id=selected_offer_item.supplier_id,awarded_offer_item_id=selected_offer_item.id,awarded_quantity=qi.quantity_to_quote,awarded_unit_cost=selected_offer_item.delivered_unit_cost,awarded_total_cost=round(qi.quantity_to_quote*selected_offer_item.delivered_unit_cost,2),updated_at=now() where id=qi.id;
  end loop;
  if n<>(select count(*) from public.procurement_material_quotation_items where quotation_id=q.id) then raise exception 'Selecione um vencedor para todos os itens.'; end if;
  update public.procurement_material_quotations set status='approved',total_awarded_amount=total,approved_by=auth.uid(),approved_at=now(),approval_notes=nullif(trim(coalesce(p_approval_notes,'')),''),updated_by=auth.uid(),updated_at=now() where id=q.id;
  insert into public.procurement_material_quotation_audit(company_id,project_id,quotation_id,action,previous_status,new_status,reason,details,changed_by) values(p_company_id,p_project_id,q.id,'approved','analysis','approved',nullif(trim(coalesce(p_approval_notes,'')),''),jsonb_build_object('total_awarded_amount',total,'award_mode',q.award_mode),auth.uid());
  return 'approved';
end; $$;

grant execute on function public.save_procurement_material_supplier_offer(uuid,uuid,uuid,uuid,text,date,date,text,integer,text,text,text,jsonb) to authenticated;
grant execute on function public.approve_procurement_material_quotation(uuid,uuid,uuid,text,jsonb) to authenticated;

commit;
