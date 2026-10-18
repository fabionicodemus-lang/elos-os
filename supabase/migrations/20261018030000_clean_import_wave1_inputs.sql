-- Importação limpa — Onda 1b: insumos
--
-- elos_import.ensure_input devolve o insumo do Elos para um produto da origem:
--   1. de-para confirmado;
--   2. insumo do catálogo corporativo (elos_master / elos_os) com o mesmo nome — empate resolvido pela unidade;
--   3. nenhum → cria o insumo com código no padrão Elos (família NV.01 "Insumos cadastrados na importação"),
--      sem o nome do sistema de origem. A família pode ser reclassificada depois pela engenharia.
-- O nome curto do produto (productName) é o que casa com o catálogo; o nome completo só é usado na falta dele.
-- É usada pela onda 1b (catálogo) e pelas ondas de documentos (produto que só aparece num pedido ou nota).

create or replace function elos_import.unit_key(p_unit text)
returns text
language sql
immutable
as $$
  select case public.integration_normalize_key(p_unit)
    when 'unidade' then 'un' when 'unid' then 'un' when 'und' then 'un' when 'un.' then 'un'
    when 'metro' then 'm' when 'metro quadrado' then 'm²' when 'm2' then 'm²'
    when 'metro cúbico' then 'm³' when 'm3' then 'm³'
    when 'verba' then 'vb' when 'conjunto' then 'cj' when 'litro' then 'l'
    when 'ms' then 'mês' when 'mes' then 'mês'
    else coalesce(public.integration_normalize_key(p_unit), 'un') end;
$$;

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
begin
  v_id := elos_import.map_get(p_company_id, null, 'product', p_product_id);
  if v_id is not null then return v_id; end if;

  select e.id into v_id
  from engineering_inputs e
  where e.company_id = p_company_id
    and e.source_system in ('elos_master', 'elos_os')
    and e.status = 'active'
    and public.integration_normalize_key(e.description) = public.integration_normalize_key(p_name)
  order by (elos_import.unit_key(e.unit) <> elos_import.unit_key(p_unit)), (e.source_system <> 'elos_master'), e.code
  limit 1;
  v_method := 'name_unit';

  if v_id is null then
    select coalesce(max(nullif(regexp_replace(code, '^NV\.01\.', ''), '')::int), 0) + 1 into v_next
    from engineering_inputs
    where company_id = p_company_id and code ~ '^NV\.01\.[0-9]+$';

    insert into engineering_inputs(company_id, code, description, unit, category, family_code, family_label,
                                   source_system, source_id, status)
    values (p_company_id, 'NV.01.' || lpad(v_next::text, 4, '0'), btrim(p_name),
            coalesce(nullif(btrim(p_unit), ''), 'un'),
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

create or replace function elos_import.wave1_inputs(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_run uuid;
  r record;
  v_before int;
  v_after int;
  v_total int := 0;
begin
  insert into elos_import.runs(company_id, wave) values (p_company_id, '1b-insumos') returning id into v_run;
  select count(*) into v_before from engineering_inputs where company_id = p_company_id and code ~ '^NV\.01\.';

  for r in
    select distinct on (pid) pid, nm, un, tp from (
      select payload->'data'->>'productId' pid, coalesce(payload->'data'->>'productName', payload->'data'->>'productFullName') nm,
             payload->'data'->>'symbol' un, payload->'data'->>'type' tp, 1 pri
      from koper_staging_records where entity = 'mirror.product'
      union all
      select payload->>'productId', payload->>'productFullName', payload->>'symbol', 'Material', 2
      from koper_staging_records where entity = 'product'
    ) s
    where pid is not null and nullif(btrim(nm), '') is not null
    order by pid, pri
  loop
    perform elos_import.ensure_input(p_company_id, r.pid, r.nm, r.un, r.tp);
    v_total := v_total + 1;
  end loop;

  select count(*) into v_after from engineering_inputs where company_id = p_company_id and code ~ '^NV\.01\.';
  update elos_import.runs set status = 'done', finished_at = now(),
         summary = jsonb_build_object('produtos', v_total, 'criados', v_after - v_before, 'vinculados', v_total - (v_after - v_before))
   where id = v_run;
  return jsonb_build_object('produtos', v_total, 'criados', v_after - v_before, 'vinculados', v_total - (v_after - v_before));
end;
$$;

revoke all on function elos_import.ensure_input(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function elos_import.wave1_inputs(uuid) from public, anon, authenticated;

-- Busca por nome normalizado (usada no casamento de insumos)
create index if not exists engineering_inputs_norm_desc_idx
  on public.engineering_inputs (company_id, public.integration_normalize_key(description)) where status = 'active';
