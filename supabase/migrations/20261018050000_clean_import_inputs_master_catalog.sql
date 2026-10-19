-- Importação limpa — insumos a partir do catálogo mestre
--
-- O catálogo de referência (compatível com a origem) é o catálogo mestre do Elos (source_system = elos_master,
-- empresa Elos Engenharia). Cada empresa trabalha com cópias dele no próprio cadastro (source_system = elos_os),
-- mantendo o código mestre. elos_import.ensure_input passa a seguir esta ordem:
--   1. de-para confirmado;
--   2. insumo da própria empresa (elos_os) com o mesmo nome;
--   3. insumo do catálogo mestre com o mesmo nome (empate pela unidade) → copiado para a empresa com o código mestre;
--   4. nenhum → insumo novo NV.01.xxxx "Insumos cadastrados na importação".

create or replace function elos_import.ensure_input(
  p_company_id uuid, p_product_id text, p_name text, p_unit text, p_type text default 'Material')
returns uuid
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_id uuid;
  v_method text;
  v_next int;
  m record;
begin
  v_id := elos_import.map_get(p_company_id, null, 'product', p_product_id);
  if v_id is not null then return v_id; end if;

  -- 2. cadastro próprio da empresa
  select e.id into v_id
  from engineering_inputs e
  where e.company_id = p_company_id and e.source_system = 'elos_os' and e.status = 'active'
    and public.integration_normalize_key(e.description) = public.integration_normalize_key(p_name)
  order by (elos_import.unit_key(e.unit) <> elos_import.unit_key(p_unit)), e.code
  limit 1;
  v_method := 'company_catalog';

  -- 3. catálogo mestre → cópia para a empresa com o mesmo código
  if v_id is null then
    select e.* into m
    from engineering_inputs e
    where e.source_system = 'elos_master' and e.status = 'active'
      and public.integration_normalize_key(e.description) = public.integration_normalize_key(p_name)
    order by (elos_import.unit_key(e.unit) <> elos_import.unit_key(p_unit)), e.code
    limit 1;

    if m.id is not null then
      select e.id into v_id from engineering_inputs e where e.company_id = p_company_id and e.code = m.code;
      if v_id is null then
        insert into engineering_inputs(company_id, code, description, unit, category, family_code, family_label,
                                       brand_reference, technical_specification, source_system, source_code, source_id, status)
        values (p_company_id, m.code, m.description, m.unit, m.category, m.family_code, m.family_label,
                m.brand_reference, m.technical_specification, 'elos_os', m.code, 'master:' || m.id, 'active')
        on conflict (company_id, source_system, source_id) do update set updated_at = now()
        returning id into v_id;
      end if;
      v_method := 'master_catalog';
    end if;
  end if;

  -- 4. sem par: insumo novo
  if v_id is null then
    select coalesce(max(nullif(regexp_replace(code, '^NV\.01\.', ''), '')::int), 0) + 1 into v_next
    from engineering_inputs where company_id = p_company_id and code ~ '^NV\.01\.[0-9]+$';
    insert into engineering_inputs(company_id, code, description, unit, category, family_code, family_label,
                                   source_system, source_id, status)
    values (p_company_id, 'NV.01.' || lpad(v_next::text, 4, '0'), btrim(p_name), coalesce(nullif(btrim(p_unit), ''), 'un'),
            case when p_type ilike 'equip%' then 'equipment' when p_type ilike 'serv%' then 'service' else 'material' end,
            'NV.01', 'Insumos cadastrados na importação', 'elos_os', 'import:' || p_product_id, 'active')
    on conflict (company_id, source_system, source_id) do update set updated_at = now()
    returning id into v_id;
    v_method := 'created';
  end if;

  perform elos_import.map_put(p_company_id, null, 'product', p_product_id, 'engineering_input', v_id, v_method, p_name, p_unit);
  return v_id;
end;
$$;

revoke all on function elos_import.ensure_input(uuid, text, text, text, text) from public, anon, authenticated;

create index if not exists engineering_inputs_master_norm_desc_idx
  on public.engineering_inputs (public.integration_normalize_key(description)) where source_system = 'elos_master' and status = 'active';

-- wave1_inputs aceita um limite para rodadas de teste
create or replace function elos_import.wave1_inputs(p_company_id uuid, p_limit int default null)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_run uuid; r record; v_total int := 0; v_stats jsonb;
begin
  insert into elos_import.runs(company_id, wave) values (p_company_id, '1b-insumos') returning id into v_run;
  for r in
    select * from (
      select distinct on (pid) pid, nm, un, tp from (
        select payload->'data'->>'productId' pid, coalesce(payload->'data'->>'productName', payload->'data'->>'productFullName') nm,
               payload->'data'->>'symbol' un, payload->'data'->>'type' tp, 1 pri
        from koper_staging_records where entity = 'mirror.product'
        union all
        select payload->>'productId', payload->>'productFullName', payload->>'symbol', 'Material', 2
        from koper_staging_records where entity = 'product'
      ) s where pid is not null and nullif(btrim(nm), '') is not null
      order by pid, pri
    ) q order by pid limit p_limit
  loop
    perform elos_import.ensure_input(p_company_id, r.pid, r.nm, r.un, r.tp);
    v_total := v_total + 1;
  end loop;
  select jsonb_object_agg(match_method, n) into v_stats from (
    select match_method, count(*) n from integration_mappings
    where company_id = p_company_id and source_system = 'koper' and source_entity_type = 'product' group by 1) z;
  update elos_import.runs set status = 'done', finished_at = now(),
         summary = jsonb_build_object('processados', v_total, 'por_metodo', v_stats) where id = v_run;
  return jsonb_build_object('processados', v_total, 'por_metodo', v_stats);
end;
$$;

drop function if exists elos_import.wave1_inputs(uuid);
revoke all on function elos_import.wave1_inputs(uuid, int) from public, anon, authenticated;
