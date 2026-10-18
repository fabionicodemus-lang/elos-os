-- Importação limpa — Onda 3a: contratos de serviço e medições do Flow
--
-- Origem: contratos de serviço e medições da obra Flow na origem.
-- * No Elos um contrato nasce de Solicitação de Serviços → Mapa de Concorrência → Contrato.
--   Para cada contrato histórico é registrada essa cadeia, já concluída (SS-, MC-, CT-),
--   com o fornecedor contratado como vencedor.
-- * Cada serviço do contrato vira um item ligado ao centro de custo (serviço do orçamento) pelo de-para,
--   com uma única etapa de medição ("Execução", 100%).
-- * O aditivo da origem entra como contrato próprio, identificado como aditivo do contrato principal,
--   para manter as medições ligadas a ele.
-- * Só medições aprovadas entram (abertas e reprovadas ficam de fora). Numeração MED-0001... pela data.

create or replace function elos_import.wave3a_contracts(p_company_id uuid, p_project_id uuid, p_budget_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_run uuid; c record; s record; m record; mi record;
  v_supplier uuid; v_req uuid; v_comp uuid; v_offer uuid; v_ct uuid; v_ri uuid; v_ci uuid; v_st uuid; v_med uuid;
  v_seq_req int; v_seq_comp int; v_seq_ct int; v_seq_med int; v_sort int; v_end date; v_start date; v_title text; v_main text;
  v_prev_end date; v_last_ct uuid; v_gross numeric; v_prev_q numeric; v_prev_a numeric; v_total numeric;
  v_cts int := 0; v_items int := 0; v_meds int := 0; v_mitems int := 0; v_value numeric := 0; v_mvalue numeric := 0;
begin
  insert into elos_import.runs(company_id, project_id, wave) values (p_company_id, p_project_id, '3a-contratos-medicoes') returning id into v_run;
  select coalesce(max(sequence_no), 0) into v_seq_req from execution_service_requests where project_id = p_project_id;
  select coalesce(max(sequence_no), 0) into v_seq_comp from execution_service_competitions where project_id = p_project_id;
  select coalesce(max(sequence_no), 0) into v_seq_ct from execution_service_contracts where project_id = p_project_id;
  select coalesce(max(sequence_no), 0) into v_seq_med from execution_contract_measurements where project_id = p_project_id;

  -- Contratos (principal antes do aditivo)
  for c in
    select payload->'data' d from koper_staging_records
    where entity = 'mirror.engineering_contract_detail' and payload->>'_enterprise' = 'flow'
    order by (payload->'data'->>'mainContractId') nulls first, (payload->'data'->>'contractDate')::timestamp, (payload->'data'->>'contractId')::int
  loop
    if elos_import.map_get(p_company_id, p_project_id, 'engineering_contract', c.d->>'contractId') is not null then continue; end if;
    v_supplier := elos_import.ensure_supplier(p_company_id, c.d->>'supplierId', coalesce(c.d->>'supplierName', c.d->>'companyName'), null);
    v_start := (c.d->>'contractDate')::timestamp::date;
    select greatest(v_start, max((x.payload->'data'->>'measurementDate')::date)) into v_end
    from koper_staging_records x where x.entity = 'mirror.build_measurement_detail' and x.payload->>'_enterprise' = 'flow'
      and x.payload->'data'->>'contractId' = c.d->>'contractId';
    v_end := coalesce(v_end, v_start);
    select string_agg(distinct se.description, ', ') into v_title
    from jsonb_array_elements(c.d->'services') x
    join integration_mappings mp on mp.project_id = p_project_id and mp.source_system = 'koper' and mp.source_entity_type = 'cost_center'
      and mp.key_kind = 'code' and mp.external_code = x->>'itemReference' and mp.status = 'confirmed'
    join engineering_services se on se.id = mp.target_entity_id;
    v_main := null;
    if c.d->>'mainContractId' is not null then
      select contract_number into v_main from execution_service_contracts
       where id = elos_import.map_get(p_company_id, p_project_id, 'engineering_contract', c.d->>'mainContractId');
    end if;
    v_title := left(case when v_main is not null then 'Aditivo do ' || v_main || ' — ' else '' end || coalesce(v_title, 'Serviços'), 200);
    select sum((x->>'totalServiceValue')::numeric) into v_total from jsonb_array_elements(c.d->'services') x;

    v_seq_req := v_seq_req + 1;
    insert into execution_service_requests(company_id, project_id, budget_id, sequence_no, request_number, title, scope_summary, status, needed_start,
      requester_user_id, requester_name, submitted_by, submitted_at, approved_by, approved_at, created_by, updated_by, created_at, updated_at)
    values (p_company_id, p_project_id, p_budget_id, v_seq_req, 'SS-' || lpad(v_seq_req::text, 4, '0'), v_title, v_title, 'contracted', v_start,
      p_user_id, coalesce(c.d->>'userName', 'Equipe da obra'), p_user_id, v_start, p_user_id, v_start, p_user_id, p_user_id, v_start, now())
    returning id into v_req;
    v_seq_comp := v_seq_comp + 1;
    insert into execution_service_competitions(company_id, project_id, request_id, sequence_no, competition_number, title, status, award_criteria,
      winner_supplier_id, approved_by, approved_at, approval_notes, created_by, created_at, updated_at)
    values (p_company_id, p_project_id, v_req, v_seq_comp, 'MC-' || lpad(v_seq_comp::text, 4, '0'), v_title, 'approved', 'Contratação histórica',
      v_supplier, p_user_id, v_start, 'Contratação histórica trazida na importação do Flow.', p_user_id, v_start, now())
    returning id into v_comp;
    insert into execution_service_competition_offers(company_id, project_id, competition_id, supplier_id, status, proposal_date, proposed_start, proposed_finish,
      total_amount, received_by, received_at, updated_at)
    values (p_company_id, p_project_id, v_comp, v_supplier, 'winner', v_start, v_start, v_end, coalesce(v_total, 0), p_user_id, v_start, now())
    returning id into v_offer;
    update execution_service_competitions set winner_offer_id = v_offer where id = v_comp;

    v_seq_ct := v_seq_ct + 1;
    insert into execution_service_contracts(company_id, project_id, supplier_id, budget_id, source_request_id, source_competition_id, sequence_no, contract_number,
      title, scope_summary, status, signed_date, start_date, end_date, responsible_user_id, responsible_name, activated_by, activated_at, notes,
      created_by, updated_by, created_at, updated_at)
    values (p_company_id, p_project_id, v_supplier, p_budget_id, v_req, v_comp, v_seq_ct, 'CT-' || lpad(v_seq_ct::text, 4, '0'),
      v_title, v_title, 'active', case when c.d->>'contractStatus' = 'Assinado' then v_start end, v_start, v_end,
      p_user_id, coalesce(c.d->>'userName', 'Equipe da obra'), p_user_id, v_start,
      case when v_main is not null then 'Aditivo do contrato ' || v_main || '.' end,
      p_user_id, p_user_id, v_start, now())
    returning id into v_ct;
    update execution_service_competitions set generated_contract_id = v_ct where id = v_comp;
    perform elos_import.map_put(p_company_id, p_project_id, 'engineering_contract', c.d->>'contractId', 'execution_service_contract', v_ct, 'imported',
      'CT-' || lpad(v_seq_ct::text, 4, '0'));
    v_cts := v_cts + 1; v_value := v_value + coalesce(v_total, 0);

    v_sort := 0;
    for s in
      select x, se.id sid, se.code, se.description nm
      from jsonb_array_elements(c.d->'services') x
      join integration_mappings mp on mp.project_id = p_project_id and mp.source_system = 'koper' and mp.source_entity_type = 'cost_center'
        and mp.key_kind = 'code' and mp.external_code = x->>'itemReference' and mp.status = 'confirmed'
      join engineering_services se on se.id = mp.target_entity_id
      where coalesce((x->>'serviceAmount')::numeric, 0) > 0
    loop
      v_sort := v_sort + 1;
      insert into execution_service_request_items(company_id, project_id, request_id, service_id, service_code, service_name, unit_snapshot,
        requested_quantity, estimated_unit_price, estimated_total, scope_notes, sort_order)
      values (p_company_id, p_project_id, v_req, s.sid, s.code, s.nm, coalesce(s.x->>'symbol', 'vb'), (s.x->>'serviceAmount')::numeric,
        (s.x->>'serviceValue')::numeric, (s.x->>'totalServiceValue')::numeric, s.x->>'serviceName', v_sort)
      returning id into v_ri;
      insert into execution_service_competition_offer_items(company_id, project_id, offer_id, request_item_id, offered_quantity, unit_price, total_amount, sort_order)
      values (p_company_id, p_project_id, v_offer, v_ri, (s.x->>'serviceAmount')::numeric, (s.x->>'serviceValue')::numeric, (s.x->>'totalServiceValue')::numeric, v_sort);
      insert into execution_service_contract_items(company_id, project_id, contract_id, service_id, service_code, service_name, unit_snapshot,
        contracted_quantity, unit_price, total_value, planned_start, planned_finish, scope_notes, sort_order)
      values (p_company_id, p_project_id, v_ct, s.sid, s.code, s.nm, coalesce(s.x->>'symbol', 'vb'), (s.x->>'serviceAmount')::numeric,
        (s.x->>'serviceValue')::numeric, round((s.x->>'totalServiceValue')::numeric, 2), v_start, v_end, s.x->>'serviceName', v_sort)
      returning id into v_ci;
      insert into execution_service_contract_stages(company_id, project_id, contract_id, contract_item_id, service_id, stage_code, stage_name, measurement_mode,
        weight_percent, unit_snapshot, contracted_quantity, unit_price, total_value, sort_order)
      values (p_company_id, p_project_id, v_ct, v_ci, s.sid, 'ET-01', 'Execução', 'quantity', 100, coalesce(s.x->>'symbol', 'vb'),
        (s.x->>'serviceAmount')::numeric, (s.x->>'serviceValue')::numeric, round((s.x->>'totalServiceValue')::numeric, 2), 1);
      perform elos_import.map_put(p_company_id, p_project_id, 'contract_service', (c.d->>'contractId') || ':' || (s.x->>'itemMonitoringId'),
        'execution_service_contract_item', v_ci, 'imported', s.code);
      v_items := v_items + 1;
    end loop;
    perform refresh_execution_service_contract_value(v_ct);
  end loop;

  -- Medições aprovadas
  v_last_ct := null;
  for m in
    select d.payload->'data' h, i.payload->'data' it
    from koper_staging_records d
    join koper_staging_records i on i.entity = 'mirror.measurement_items' and i.koper_id = d.koper_id
    where d.entity = 'mirror.build_measurement_detail' and d.payload->>'_enterprise' = 'flow'
      and d.payload->'data'->>'measurementStatus' = 'Aprovada' and d.payload->'data'->>'contractId' is not null
    order by (d.payload->'data'->>'contractId')::int, (d.payload->'data'->>'measurementDate')::date, (d.payload->'data'->>'measurementId')::int
  loop
    if elos_import.map_get(p_company_id, p_project_id, 'build_measurement', m.h->>'measurementId') is not null then continue; end if;
    v_ct := elos_import.map_get(p_company_id, p_project_id, 'engineering_contract', m.h->>'contractId');
    if v_ct is null then
      perform elos_import.issue(v_run, p_company_id, p_project_id, 'build_measurement', m.h->>'measurementId', 'medicao_sem_contrato', '{}'::jsonb);
      continue;
    end if;
    if v_last_ct is distinct from v_ct then
      select start_date - 1 into v_prev_end from execution_service_contracts where id = v_ct;
      v_last_ct := v_ct;
    end if;
    v_start := v_prev_end + 1;
    v_end := greatest((m.h->>'measurementDate')::date, v_start);
    v_prev_end := v_end;

    v_seq_med := v_seq_med + 1;
    insert into execution_contract_measurements(company_id, project_id, contract_id, supplier_id, sequence_no, measurement_number, period_start, period_end,
      status, requester_user_id, requester_name, submitted_by, submitted_at, approved_by, approved_at, approval_notes, notes, created_by, updated_by, created_at, updated_at)
    select p_company_id, p_project_id, v_ct, ct.supplier_id, v_seq_med, 'MED-' || lpad(v_seq_med::text, 4, '0'), v_start, v_end,
      'approved', p_user_id, coalesce(m.h->>'userName', 'Equipe da obra'), p_user_id, v_end, p_user_id, v_end,
      'Medição histórica trazida na importação do Flow.', nullif(btrim(coalesce(m.h->>'comments', '')), ''), p_user_id, p_user_id, v_end, now()
    from execution_service_contracts ct where ct.id = v_ct
    returning id into v_med;
    perform elos_import.map_put(p_company_id, p_project_id, 'build_measurement', m.h->>'measurementId', 'execution_contract_measurement', v_med, 'imported',
      'MED-' || lpad(v_seq_med::text, 4, '0'));
    v_meds := v_meds + 1; v_sort := 0; v_gross := 0;

    for mi in
      select x, ci.*, st.id stage_id
      from jsonb_array_elements(m.it->'services') x
      join execution_service_contract_items ci on ci.id = elos_import.map_get(p_company_id, p_project_id, 'contract_service', (x->>'contractId') || ':' || (x->>'itemMonitoringId'))
      join execution_service_contract_stages st on st.contract_item_id = ci.id and st.stage_code = 'ET-01'
      where coalesce((x->>'measurementAmount')::numeric, 0) > 0
    loop
      select coalesce(sum(i.current_quantity), 0), coalesce(sum(i.current_amount), 0) into v_prev_q, v_prev_a
      from execution_contract_measurement_items i join execution_contract_measurements mm on mm.id = i.measurement_id
      where i.contract_item_id = mi.id and mm.status in ('approved', 'invoiced', 'paid');
      v_sort := v_sort + 1;
      insert into execution_contract_measurement_items(company_id, project_id, measurement_id, contract_id, contract_item_id, contract_stage_id, service_id,
        service_code, service_name, unit_snapshot, contracted_quantity, previous_approved_quantity, current_quantity, accumulated_quantity, unit_price,
        previous_approved_amount, current_amount, accumulated_amount, progress_percent, sort_order)
      values (p_company_id, p_project_id, v_med, v_ct, mi.id, mi.stage_id, mi.service_id, mi.service_code, mi.service_name, mi.unit_snapshot,
        mi.contracted_quantity, v_prev_q, (mi.x->>'measurementAmount')::numeric, v_prev_q + (mi.x->>'measurementAmount')::numeric,
        coalesce((mi.x->>'itemMonitContractValue')::numeric, mi.unit_price), v_prev_a,
        round((mi.x->>'measurementAmount')::numeric * coalesce((mi.x->>'itemMonitContractValue')::numeric, mi.unit_price), 2),
        v_prev_a + round((mi.x->>'measurementAmount')::numeric * coalesce((mi.x->>'itemMonitContractValue')::numeric, mi.unit_price), 2),
        round(100 * (v_prev_q + (mi.x->>'measurementAmount')::numeric) / mi.contracted_quantity, 4), v_sort)
      on conflict (measurement_id, contract_item_id) do update set
        current_quantity = execution_contract_measurement_items.current_quantity + excluded.current_quantity,
        accumulated_quantity = execution_contract_measurement_items.accumulated_quantity + excluded.current_quantity,
        current_amount = execution_contract_measurement_items.current_amount + excluded.current_amount,
        accumulated_amount = execution_contract_measurement_items.accumulated_amount + excluded.current_amount,
        updated_at = now();
      v_gross := v_gross + round((mi.x->>'measurementAmount')::numeric * coalesce((mi.x->>'itemMonitContractValue')::numeric, mi.unit_price), 2);
      v_mitems := v_mitems + 1;
    end loop;
    update execution_contract_measurements set gross_amount = v_gross, net_amount = v_gross, total_deductions = 0 where id = v_med;
    v_mvalue := v_mvalue + v_gross;
    if v_sort = 0 then
      perform elos_import.issue(v_run, p_company_id, p_project_id, 'build_measurement', m.h->>'measurementId', 'medicao_sem_itens',
        jsonb_build_object('medicao', 'MED-' || lpad(v_seq_med::text, 4, '0')));
    end if;
  end loop;

  for v_ct in select id from execution_service_contracts where project_id = p_project_id loop
    perform refresh_execution_service_contract_measurements(v_ct);
  end loop;

  update elos_import.runs set status = 'done', finished_at = now(),
    summary = jsonb_build_object('contratos', v_cts, 'itens_contrato', v_items, 'valor_contratos', v_value, 'medicoes', v_meds, 'itens_medicao', v_mitems, 'valor_medido', v_mvalue)
  where id = v_run;
  return jsonb_build_object('contratos', v_cts, 'itens_contrato', v_items, 'valor_contratos', v_value, 'medicoes', v_meds, 'itens_medicao', v_mitems, 'valor_medido', v_mvalue);
end;
$$;

revoke all on function elos_import.wave3a_contracts(uuid, uuid, uuid, uuid) from public, anon, authenticated;
