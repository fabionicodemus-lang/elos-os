-- Importação limpa — Onda 1a: fornecedores
--
-- Para cada fornecedor da origem (staging mirror.supplier), na ordem:
--   1. de-para já confirmado → mantém;
--   2. fornecedor do Elos com o mesmo CPF/CNPJ (preferindo cadastro nativo, ativo e mais antigo) → vincula;
--   3. nenhum → cria o fornecedor no Elos com os dados da origem, sem o nome do sistema de origem.
-- Fornecedores criados em importações antigas que tenham o mesmo documento são reaproveitados e têm
-- as notas técnicas antigas apagadas.

create or replace function elos_import.wave1_suppliers(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_run uuid;
  r record;
  v_target uuid;
  v_method text;
  v_doc text;
  v_linked int := 0;
  v_created int := 0;
  v_kept int := 0;
  v_cleaned int := 0;
begin
  insert into elos_import.runs(company_id, wave) values (p_company_id, '1a-fornecedores') returning id into v_run;

  for r in
    select distinct on (d->>'supplierId')
      d->>'supplierId' as sid,
      nullif(btrim(d->>'companyName'), '') as legal_name,
      nullif(btrim(d->>'supplierName'), '') as trade_name,
      regexp_replace(coalesce(d->>'cnpj', ''), '\D', '', 'g') as cnpj,
      regexp_replace(coalesce(d->>'cpf', ''), '\D', '', 'g') as cpf,
      nullif(btrim(d->'address'->>'city'), '') as city,
      nullif(btrim(d->'address'->>'state'), '') as state,
      nullif(concat_ws(', ', nullif(btrim(d->'address'->>'addressName'), ''), nullif(btrim(d->'address'->>'number'), ''),
                       nullif(btrim(d->'address'->>'neighborhood'), '')), '') as address,
      (d->>'isService')::boolean as is_service,
      (d->>'isProvider')::boolean as is_provider
    from (select payload->'data' as d from koper_staging_records where entity = 'mirror.supplier') s
    order by d->>'supplierId'
  loop
    v_doc := nullif(coalesce(nullif(r.cnpj, ''), nullif(r.cpf, '')), '');
    v_target := elos_import.map_get(p_company_id, null, 'supplier', r.sid);
    v_method := null;

    if v_target is not null then
      v_kept := v_kept + 1;
    else
      if v_doc is not null then
        select s.id into v_target
        from suppliers s
        where s.company_id = p_company_id
          and regexp_replace(coalesce(s.tax_id, ''), '\D', '', 'g') = v_doc
        order by (coalesce(s.source_system, '') ilike 'koper%'), (s.status <> 'active'), s.created_at
        limit 1;
        if v_target is not null then v_method := 'tax_id'; end if;
      end if;

      if v_target is null then
        insert into suppliers(company_id, person_type, legal_name, trade_name, tax_id, city, state, address,
                              category, status, source_system, source_id)
        values (p_company_id,
                case when nullif(r.cnpj, '') is not null then 'company' when nullif(r.cpf, '') is not null then 'individual' else 'other' end,
                coalesce(r.legal_name, r.trade_name, 'Fornecedor sem nome'),
                nullif(r.trade_name, r.legal_name),
                v_doc, r.city, r.state, r.address,
                case when r.is_service and not coalesce(r.is_provider, false) then 'Serviços' when r.is_provider and not coalesce(r.is_service, false) then 'Materiais' else 'Serviços / materiais' end,
                'active', 'koper', r.sid)
        on conflict (company_id, source_system, source_id) do update set source_id = excluded.source_id
        returning id into v_target;
        v_method := 'created';
        v_created := v_created + 1;
      else
        v_linked := v_linked + 1;
      end if;

      perform elos_import.map_put(p_company_id, null, 'supplier', r.sid, 'supplier', v_target, v_method,
                                  coalesce(r.trade_name, r.legal_name), v_doc);
    end if;

    -- limpeza de textos herdados de importações antigas no fornecedor vinculado
    update suppliers s
       set notes = case when s.notes ilike '%koper%' then null else s.notes end,
           legal_name = case when s.legal_name ilike '%koper%' then coalesce(r.legal_name, r.trade_name, s.legal_name) else s.legal_name end,
           trade_name = case when s.trade_name ilike '%koper%' then nullif(r.trade_name, coalesce(r.legal_name, '')) else s.trade_name end,
           updated_at = now()
     where s.id = v_target
       and (s.notes ilike '%koper%' or s.legal_name ilike '%koper%' or s.trade_name ilike '%koper%');
    if found then v_cleaned := v_cleaned + 1; end if;
  end loop;

  update elos_import.runs
     set status = 'done', finished_at = now(),
         summary = jsonb_build_object('mantidos', v_kept, 'vinculados', v_linked, 'criados', v_created, 'limpos', v_cleaned)
   where id = v_run;
  return jsonb_build_object('mantidos', v_kept, 'vinculados', v_linked, 'criados', v_created, 'limpos', v_cleaned);
end;
$$;

revoke all on function elos_import.wave1_suppliers(uuid) from public, anon, authenticated;
