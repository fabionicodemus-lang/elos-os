-- Importação limpa — Onda 2a: solicitações de material do Flow
--
-- Origem: stock_request + stock_request_item (empresa Flow na origem).
-- * Canceladas, reprovadas e rascunhos não entram.
-- * Numeração no padrão Elos (SM-0001...) pela ordem da data da solicitação.
-- * Cada item é dividido pelos centros de custo informados na origem (services[].itemMonitInputId),
--   traduzidos pelo de-para (integration_mappings, cost_center) para o serviço do orçamento.
-- * Dois itens da origem com o mesmo insumo e centro de custo somam quantidade num item só.
-- * Item sem centro de custo vai para "SEM-CC" e vira pendência; itens do grupo de incorporação
--   (viabilidade) vão para "VIAB", fora do orçamento de obra.

create or replace function elos_import.cost_center_for_monitoring_input(p_project_id uuid, p_monit_input_id text)
returns table(service_id uuid, code text, name text, kref text)
language sql
stable
set search_path = public
as $$
  with mi as (
    select i->>'monitItemReference' as kref
    from koper_staging_records r, jsonb_array_elements(r.payload->'data'->'items') i
    where r.entity = 'mirror.monitoring_input_services' and r.payload->>'_enterprise' = 'flow'
      and i->>'itemMonitInputId' = p_monit_input_id
    limit 1
  )
  select s.id, s.code, s.description, mi.kref
  from mi
  left join integration_mappings m
    on m.project_id = p_project_id and m.source_system = 'koper' and m.source_entity_type = 'cost_center'
   and m.key_kind = 'code' and m.external_code = mi.kref and m.status = 'confirmed'
  left join engineering_services s on s.id = m.target_entity_id;
$$;

create or replace function elos_import.wave2a_requests(p_company_id uuid, p_project_id uuid, p_budget_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_run uuid; r record; it record; sv record; cc record;
  v_req uuid; v_seq int; v_input uuid; v_inp record; v_sort int; v_item uuid;
  v_reqs int := 0; v_items int := 0; v_nocc int := 0; v_viab int := 0;
begin
  insert into elos_import.runs(company_id, project_id, wave) values (p_company_id, p_project_id, '2a-solicitacoes') returning id into v_run;
  select coalesce(max(sequence_no), 0) into v_seq from execution_material_requests where project_id = p_project_id;

  for r in
    select payload p, koper_id
    from koper_staging_records
    where entity = 'stock_request'
      and payload->>'status' not in ('Cancelado', 'Reprovado', 'Rascunho')
      and coalesce((payload->>'isDraft')::boolean, false) = false
    order by (payload->>'requestDate')::timestamptz, (payload->>'requestId')::int
  loop
    v_req := elos_import.map_get(p_company_id, p_project_id, 'stock_request', r.p->>'requestId');
    if v_req is not null then continue; end if;

    v_seq := v_seq + 1;
    insert into execution_material_requests(company_id, project_id, budget_id, sequence_no, request_number, status, needed_date,
      requester_user_id, requester_name, notes, approved_by, approved_at, created_by, created_at, updated_at)
    values (p_company_id, p_project_id, p_budget_id, v_seq, 'SM-' || lpad(v_seq::text, 4, '0'), 'approved',
      coalesce((r.p->>'deadline')::date, (r.p->>'requestDate')::date),
      p_user_id, coalesce(nullif(btrim(r.p->>'userName'), ''), 'Equipe da obra'),
      nullif(btrim(r.p->>'commentRequest'), ''), p_user_id, (r.p->>'requestDate')::timestamptz,
      p_user_id, (r.p->>'requestDate')::timestamptz, now())
    returning id into v_req;
    perform elos_import.map_put(p_company_id, p_project_id, 'stock_request', r.p->>'requestId', 'execution_material_request', v_req, 'imported',
      'SM-' || lpad(v_seq::text, 4, '0'));
    v_reqs := v_reqs + 1;
    v_sort := 0;

    for it in
      select payload p from koper_staging_records
      where entity = 'stock_request_item' and payload->>'requestId' = r.p->>'requestId'
        and coalesce((payload->>'prodCanceled')::boolean, false) = false
      order by (payload->>'productRequestId')::int
    loop
      v_input := elos_import.ensure_input(p_company_id, it.p->>'productId',
        coalesce(nullif(it.p->>'productFullName', ''), it.p->>'productName'), it.p->>'symbol');
      select code, description, unit, category into v_inp from engineering_inputs where id = v_input;

      for sv in
        select x->>'itemMonitInputId' mi, nullif(x->>'inputAmount', '')::numeric amt
        from jsonb_array_elements(case when jsonb_array_length(coalesce(it.p->'services', '[]')) > 0 then it.p->'services'
                                       else jsonb_build_array(jsonb_build_object('itemMonitInputId', null, 'inputAmount', coalesce(it.p->>'approvedAmount', it.p->>'productAmount'))) end) x
      loop
        select * into cc from elos_import.cost_center_for_monitoring_input(p_project_id, coalesce(sv.mi, '-'));
        if coalesce(sv.amt, 0) <= 0 then continue; end if;
        v_sort := v_sort + 1;
        insert into execution_material_request_items(company_id, project_id, request_id, input_id, input_code, input_name, unit_snapshot,
          category_snapshot, cost_center_code, cost_center_name, cost_center_service_id, requested_quantity, ordered_quantity, sort_order)
        values (p_company_id, p_project_id, v_req, v_input, v_inp.code, v_inp.description, v_inp.unit, v_inp.category,
          case when cc.service_id is not null then cc.code when cc.kref like '29.%' then 'VIAB' else 'SEM-CC' end,
          case when cc.service_id is not null then cc.name when cc.kref like '29.%' then 'Custos de incorporação (viabilidade)' else 'Sem centro de custo na origem' end,
          cc.service_id, sv.amt, 0, v_sort)
        on conflict (request_id, input_id, cost_center_code) do update
          set requested_quantity = execution_material_request_items.requested_quantity + excluded.requested_quantity, updated_at = now()
        returning id into v_item;
        if cc.service_id is null then
          if cc.kref like '29.%' then v_viab := v_viab + 1; else v_nocc := v_nocc + 1;
            perform elos_import.issue(v_run, p_company_id, p_project_id, 'stock_request_item', it.p->>'productRequestId', 'sem_centro_de_custo',
              jsonb_build_object('solicitacao', 'SM-' || lpad(v_seq::text, 4, '0'), 'insumo', v_inp.description));
          end if;
        end if;
        perform elos_import.map_put(p_company_id, p_project_id, 'stock_request_item', (it.p->>'productRequestId') || ':' || coalesce(sv.mi, '-'),
          'execution_material_request_item', v_item, 'imported');
        v_items := v_items + 1;
      end loop;
    end loop;
  end loop;

  update elos_import.runs set status = 'done', finished_at = now(),
    summary = jsonb_build_object('solicitacoes', v_reqs, 'itens', v_items, 'sem_centro_de_custo', v_nocc, 'viabilidade', v_viab) where id = v_run;
  return jsonb_build_object('solicitacoes', v_reqs, 'itens', v_items, 'sem_centro_de_custo', v_nocc, 'viabilidade', v_viab);
end;
$$;

revoke all on function elos_import.wave2a_requests(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function elos_import.cost_center_for_monitoring_input(uuid, text) from public, anon, authenticated;
