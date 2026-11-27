-- A historical source account can have an explicitly unknown status.
-- It remains in eobra_source_accounts; no operational bank account is created.
-- All tenant, relationship, amount and promotion validations remain intact.
begin;
create or replace function public.eobra_snapshot_record_errors(p_record_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$
declare r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;t public.eobra_migration_records%rowtype;l record;
  d jsonb;e jsonb:='[]';v text;k text;n integer;n_primary integer;original numeric;current_value numeric;paid numeric;balance numeric;adjustment numeric:=0;net_events numeric;target uuid;
  index_record public.eobra_migration_records%rowtype;point_count integer;point_value numeric;effective_value numeric;base_month date;reference_month date;months_expected integer;
begin
  select * into r from public.eobra_migration_records where id=p_record_id;
  if not found then return jsonb_build_array('Registro indisponível.');end if;
  select * into b from public.eobra_migration_runs where id=r.run_id;d:=r.normalized_data;e:=r.source_errors;
  if exists(select 1 from public.eobra_migration_records q where q.run_id=r.run_id and q.entity=r.entity and q.archive_type=r.archive_type and q.source_id=r.source_id and q.id<>r.id) then e:=e||jsonb_build_array('Identidade repetida no pacote; todas as versões foram preservadas e exigem conferência.');end if;
  if not public.eobra_snapshot_authorized(r.company_id,public.eobra_snapshot_permissions(r.entity,d)) then raise exception 'Sem permissão nativa para esta entidade.';end if;
  if r.entity in('unit','sale','receivable','payable','settlement') and r.source_project_id is null then e:=e||jsonb_build_array('Obra de origem obrigatória para esta entidade.');end if;
  if r.source_project_id is not null then
    if not b.scope->'projectIds' ? r.source_project_id then e:=e||jsonb_build_array('Obra de origem fora do escopo declarado.');end if;
    if r.project_id is null or not exists(select 1 from public.eobra_migration_project_links m where m.company_id=r.company_id and m.source_host=b.source_host and m.source_id=r.source_project_id and m.project_id=r.project_id) then e:=e||jsonb_build_array('Confirme o de-para desta obra com uma obra real da empresa.');end if;
  end if;
  for l in select * from public.eobra_migration_relations where record_id=r.id loop
    select * into t from public.eobra_migration_records where run_id=r.run_id and entity=l.target_entity and source_id=l.target_source_id and archive_type=l.target_archive_type;
    if not found then e:=e||jsonb_build_array('Referência ausente no pacote: '||l.role||' / '||l.target_entity||' / '||l.target_source_id);continue;end if;
    if r.source_project_id is not null and t.source_project_id is not null and r.source_project_id<>t.source_project_id then e:=e||jsonb_build_array('Referência pertence a outra obra: '||l.role);end if;
    if t.entity='project' and r.source_project_id is not null and t.source_id<>r.source_project_id then e:=e||jsonb_build_array('Link de obra diverge da obra de origem do registro.');end if;
    if l.allocated_amount is not null and l.allocated_amount<0 or l.ownership_percent is not null and (l.ownership_percent<0 or l.ownership_percent>100) then e:=e||jsonb_build_array('Alocação ou participação da relação é inválida.');end if;
    if l.attributes->>'allocated_amount' is not null and l.allocated_amount is null or l.attributes->>'ownership_percent' is not null and l.ownership_percent is null then e:=e||jsonb_build_array('Valor da relação não pôde ser interpretado sem arredondamento.');end if;
  end loop;
  if r.parent_source_id is not null and (select count(*) from public.eobra_migration_relations where record_id=r.id and role='parent' and target_source_id=r.parent_source_id)<>1 then e:=e||jsonb_build_array('Pai informado exige uma única relação parent correspondente.');end if;
  if r.entity='raw_archive' then
    if not exists(select 1 from jsonb_array_elements(b.archive_types) a where a->>'key'=r.archive_type) then e:=e||jsonb_build_array('Tipo de arquivo complementar não declarado.');end if;
    return e;
  end if;
  if r.entity='project' then
    if jsonb_typeof(d->'name') is distinct from 'string' or nullif(btrim(d->>'name'),'') is null then e:=e||jsonb_build_array('Nome da obra obrigatório.');end if;
    if b.scope->'projectIds' ? r.source_id and (r.project_id is null or not exists(select 1 from public.eobra_migration_project_links m where m.company_id=r.company_id and m.source_host=b.source_host and m.source_id=r.source_id and m.project_id=r.project_id)) then e:=e||jsonb_build_array('Obra do escopo sem de-para confirmado.');end if;
  elsif r.entity='person' then
    if jsonb_typeof(d->'name') is distinct from 'string' or nullif(btrim(d->>'name'),'') is null then e:=e||jsonb_build_array('Nome da pessoa obrigatório.');end if;
    if coalesce(d->>'person_type','') not in('PF','PJ','OTHER') or coalesce(d->>'status','') not in('active','inactive') then e:=e||jsonb_build_array('Tipo de pessoa ou situação inválidos.');end if;
    if jsonb_typeof(d->'roles') is distinct from 'array' or not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(d->'roles')='array' then d->'roles' else '[]'::jsonb end) role where role in('client','supplier','broker','other')) then e:=e||jsonb_build_array('Papéis da pessoa devem ser explícitos.');end if;
    if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(d->'roles')='array' then d->'roles' else '[]'::jsonb end) role where jsonb_typeof(role)<>'string' or role#>>'{}' not in('client','supplier','broker','other')) then e:=e||jsonb_build_array('Papel de pessoa não reconhecido.');end if;
    if not public.eobra_import_tax_id_valid(d->>'tax_id') then e:=e||jsonb_build_array('CPF/CNPJ inválido.');end if;
    v:=nullif(regexp_replace(coalesce(d->>'tax_id',''),'[^0-9]','','g'),'');
    if v is not null then
      if (length(v)=11 and d->>'person_type'='PJ') or (length(v)=14 and d->>'person_type'='PF') then e:=e||jsonb_build_array('Tipo de pessoa diverge do CPF/CNPJ.');end if;
      if d->'roles' ? 'client' and (select count(*) from public.clients where company_id=r.company_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=v)>1 then e:=e||jsonb_build_array('CPF/CNPJ corresponde a mais de um cliente no Elos.');end if;
      if d->'roles' ? 'supplier' and (select count(*) from public.suppliers where company_id=r.company_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=v)>1 then e:=e||jsonb_build_array('CPF/CNPJ corresponde a mais de um fornecedor no Elos.');end if;
      if exists(select 1 from public.eobra_migration_records p where p.run_id=r.run_id and p.entity='person' and p.id<>r.id and regexp_replace(coalesce(p.normalized_data->>'tax_id',''),'[^0-9]','','g')=v and ((p.normalized_data->'roles' ? 'client' and d->'roles' ? 'client') or (p.normalized_data->'roles' ? 'supplier' and d->'roles' ? 'supplier'))) then e:=e||jsonb_build_array('Pessoas distintas na origem compartilham CPF/CNPJ e papel; confirme a identidade antes de promover.');end if;
    end if;
    if b.status<>'building' and public.eobra_snapshot_expected_targets(r.id) is distinct from r.expected_targets then e:=e||jsonb_build_array('O cadastro correspondente mudou após a revisão; prepare outro snapshot.');end if;
  elsif r.entity='unit' then
    e:=e||public.eobra_snapshot_unit_mapping_errors(r.id);
    if nullif(btrim(d->>'code'),'') is null or coalesce(d->>'status','') not in('available','reserved','sold','inactive') then e:=e||jsonb_build_array('Código ou situação da unidade inválidos.');end if;
    if (select count(*) from public.eobra_migration_relations where record_id=r.id and role='project' and target_entity='project')<>1 then e:=e||jsonb_build_array('Unidade exige uma relação explícita com a obra.');end if;
    if exists(select 1 from public.eobra_migration_records u where u.run_id=r.run_id and u.entity='unit' and u.id<>r.id and u.source_project_id=r.source_project_id and u.normalized_data->>'code'=d->>'code') then e:=e||jsonb_build_array('Código de unidade repetido na mesma obra.');end if;
    if exists(select 1 from public.units u where u.company_id=r.company_id and u.project_id=r.project_id and u.code=d->>'code' and u.id is distinct from public.eobra_import_uuid(public.eobra_snapshot_expected_targets(r.id)->>'units') and (u.source_system is distinct from 'eobra_snapshot' or u.source_id is distinct from b.source_host||'|unit|'||r.source_id)) then e:=e||jsonb_build_array('Unidade já existe no Elos sem identidade desta importação; não será sobrescrita.');end if;
    foreach k in array array['private_area','total_area','common_area','uncovered_private_area','fractional_share','list_price'] loop
      if d->>k is not null and (case when k='fractional_share' then d->>k !~ '^[0-9]{1,4}(\.[0-9]{1,10})?$' when k='list_price' then public.eobra_import_money(d->>k) is null else d->>k !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' end) then e:=e||jsonb_build_array('Detalhe numérico de unidade inválido ou excede a precisão do destino: '||k);end if;
    end loop;
    foreach k in array array['floor','bedrooms','suites','parking_spaces'] loop
      if d->>k is not null and (case when d->>k ~ '^-?[0-9]{1,6}$' then k<>'floor' and (d->>k)::numeric<0 else true end) then e:=e||jsonb_build_array('Detalhe inteiro de unidade inválido: '||k);end if;
    end loop;
  elsif r.entity='sale' then
    if d->>'status'='draft' then return e;end if;
    if nullif(btrim(d->>'number'),'') is null or coalesce(d->>'status','') not in('active','cancelled') or public.eobra_import_date(d->>'sale_date') is null or public.eobra_import_money(d->>'total_amount') is null then e:=e||jsonb_build_array('Número, data, valor ou situação da venda inválidos.');end if;
    foreach k in array array['unit','buyer'] loop
      select count(*),count(*) filter(where is_primary) into n,n_primary from public.eobra_migration_relations where record_id=r.id and role=k and target_entity=case when k='unit' then 'unit' else 'person' end;
      if n=0 or (n>1 and n_primary<>1) or n_primary>1 then e:=e||jsonb_build_array('Venda exige '||k||' principal observado; nenhuma relação será escolhida por posição.');end if;
      if n=1 and exists(select 1 from public.eobra_migration_relations where record_id=r.id and role=k and is_primary=false) then e:=e||jsonb_build_array('Único vínculo capturado está explicitamente marcado como secundário: '||k);end if;
      if k='unit' and n>1 and not public.eobra_snapshot_multi_unit_supported() then e:=e||jsonb_build_array('Venda com múltiplas unidades preservada; promoção depende do suporte relacional do destino.');end if;
      if exists(select 1 from public.eobra_migration_relations where record_id=r.id and role=k and target_entity<>case when k='unit' then 'unit' else 'person' end) then e:=e||jsonb_build_array('Tipo de vínculo de venda inválido: '||k);end if;
      if exists(select 1 from public.eobra_migration_relations where record_id=r.id and role=k group by target_entity,target_source_id,target_archive_type having count(*)>1) then e:=e||jsonb_build_array('Vínculo de venda repetido: '||k);end if;
      if exists(select 1 from public.eobra_migration_relations where record_id=r.id and role=k and allocated_amount is not null)
        and ((select count(*) from public.eobra_migration_relations where record_id=r.id and role=k and allocated_amount is not null)<>n or (select sum(allocated_amount) from public.eobra_migration_relations where record_id=r.id and role=k) is distinct from public.eobra_import_money(d->>'total_amount')) then e:=e||jsonb_build_array('Alocações da venda precisam cobrir todos os vínculos e reconciliar o valor total: '||k);end if;
      if exists(select 1 from public.eobra_migration_relations where record_id=r.id and role=k and ownership_percent is not null)
        and ((select count(*) from public.eobra_migration_relations where record_id=r.id and role=k and ownership_percent is not null)<>n or (select sum(ownership_percent) from public.eobra_migration_relations where record_id=r.id and role=k)<>100) then e:=e||jsonb_build_array('Participações da venda devem ser completas e somar 100%: '||k);end if;
    end loop;
    if d->>'status'='active' and exists(select 1 from public.eobra_migration_relations own join public.eobra_migration_relations other on other.run_id=own.run_id and other.role='unit' and other.target_entity='unit' and other.target_source_id=own.target_source_id and other.record_id<>r.id join public.eobra_migration_records sr on sr.id=other.record_id and sr.entity='sale' and sr.normalized_data->>'status'='active' where own.record_id=r.id and own.role='unit') then e:=e||jsonb_build_array('A mesma unidade aparece em mais de uma venda ativa no pacote.');end if;
    if d->>'commission_pct' is not null and (d->>'commission_pct' !~ '^[0-9]{1,4}(\.[0-9]{1,4})?$') or d->>'commission_amount' is not null and public.eobra_import_money(d->>'commission_amount') is null then e:=e||jsonb_build_array('Comissão da venda inválida.');end if;
    for l in select * from public.eobra_migration_relations where record_id=r.id and role='buyer' loop
      select * into t from public.eobra_migration_records where run_id=r.run_id and entity='person' and source_id=l.target_source_id;
      if not coalesce(t.normalized_data->'roles','[]'::jsonb) ? 'client' then e:=e||jsonb_build_array('Comprador precisa ter papel de cliente explícito.');end if;
    end loop;
  elsif r.entity in('receivable','payable') then
    if nullif(btrim(d->>'description'),'') is null and nullif(btrim(d->>'document'),'') is null then e:=e||jsonb_build_array('Descrição ou documento obrigatório.');end if;
    if public.eobra_import_date(d->>'due_date') is null then e:=e||jsonb_build_array('Vencimento inválido.');end if;
    foreach k in array array['original_amount','current_amount','paid_amount','balance_amount','interest_amount','penalty_amount','correction_amount','other_accrual_amount','discount_amount'] loop
      if jsonb_typeof(d->k) is distinct from 'string' or (case when k='correction_amount' then public.eobra_snapshot_signed_money(d->>k) else public.eobra_import_money(d->>k) end) is null then e:=e||jsonb_build_array('Valor explícito inválido ou ausente: '||k);end if;
    end loop;
    original:=public.eobra_import_money(d->>'original_amount');current_value:=public.eobra_import_money(d->>'current_amount');paid:=public.eobra_import_money(d->>'paid_amount');balance:=public.eobra_import_money(d->>'balance_amount');
    adjustment:=coalesce(public.eobra_import_money(d->>'interest_amount'),0)+coalesce(public.eobra_import_money(d->>'penalty_amount'),0)+coalesce(public.eobra_snapshot_signed_money(d->>'correction_amount'),0)+coalesce(public.eobra_import_money(d->>'other_accrual_amount'),0)-coalesce(public.eobra_import_money(d->>'discount_amount'),0);
    if current_value is distinct from original+adjustment then e:=e||jsonb_build_array('Valor atual não reconcilia original e componentes.');end if;
    if coalesce(d->>'status','') not in('open','paid','partial','cancelled') then e:=e||jsonb_build_array('Situação financeira não reconhecida.');end if;
    if current_value is distinct from paid+balance then e:=e||jsonb_build_array('Valor atual não reconcilia baixa e saldo.');end if;
    if d->>'status'='paid' and (paid is null or paid<=0 or paid<>current_value or balance<>0) then e:=e||jsonb_build_array('Parcela quitada sem reconciliação integral.');end if;
    if d->>'status'='partial' and (paid is null or paid<=0 or balance is null or balance<=0) then e:=e||jsonb_build_array('Parcela parcial exige baixa e saldo positivos.');end if;
    if d->>'status'='open' and balance=0 and current_value>0 then e:=e||jsonb_build_array('Parcela aberta com valor positivo exige saldo pendente.');end if;
    if d->>'status'='open' and paid>0 then e:=e||jsonb_build_array('Pagamento líquido positivo com saldo deve estar explicitamente parcial na origem.');end if;
    if d->>'status'='partial' then
      if not public.eobra_snapshot_partial_supported() then e:=e||jsonb_build_array('Pagamento parcial preservado; promoção aguarda suporte nas leituras e baixas nativas.');end if;
    end if;
    if r.entity='payable' and current_value<>original and not public.eobra_snapshot_payable_adjustments_supported() then e:=e||jsonb_build_array('Ajustes do contas a pagar preservados; promoção aguarda suporte nativo aos componentes.');end if;
    select coalesce(sum(case when s.normalized_data->>'kind'='reversal' then -public.eobra_import_money(s.normalized_data->>'amount') when s.normalized_data->>'kind'='payment' then public.eobra_import_money(s.normalized_data->>'amount') else 0 end),0) into net_events
      from public.eobra_migration_records s join public.eobra_migration_relations sl on sl.record_id=s.id and sl.role='installment'
      where s.run_id=r.run_id and s.entity='settlement' and sl.target_entity=r.entity and sl.target_source_id=r.source_id;
    if net_events is distinct from paid then e:=e||jsonb_build_array('Baixa líquida não reconcilia com os eventos individuais capturados.');end if;
    if r.entity='receivable' then
      if (select count(*) from public.eobra_migration_relations where record_id=r.id and role='sale' and target_entity='sale')<>1 then e:=e||jsonb_build_array('Recebível exige uma venda real na origem.');end if;
      target:=public.eobra_snapshot_resolve_link(r.id,'sale','sale');
      if exists(select 1 from public.eobra_migration_records where id=target and normalized_data->>'status'='draft') then e:=e||jsonb_build_array('Recebível não pode ser promovido sobre rascunho de venda.');end if;
      if coalesce(d->>'sequence_number','') !~ '^[1-9][0-9]{0,5}$' or coalesce(d->>'sequence_total','') !~ '^[1-9][0-9]{0,5}$' then e:=e||jsonb_build_array('Sequência e quantidade de parcelas obrigatórias.');
      elsif (d->>'sequence_number')::int>(d->>'sequence_total')::int then e:=e||jsonb_build_array('Sequência ultrapassa quantidade de parcelas.');end if;
      if coalesce(d->>'category','other') not in('entry','monthly','reinforcement','keys','post_keys','other') then e:=e||jsonb_build_array('Categoria financeira inválida.');end if;
    else
      select count(*) into n from public.eobra_migration_relations where record_id=r.id and role='supplier' and target_entity='person';
      if n>1 or n=0 and nullif(btrim(d->>'counterparty_name'),'') is null then e:=e||jsonb_build_array('Fornecedor ou favorecido explícito obrigatório.');end if;
      if n=1 then
        target:=public.eobra_snapshot_resolve_link(r.id,'supplier','person');
        if not exists(select 1 from public.eobra_migration_records where id=target and normalized_data->'roles' ? 'supplier') then e:=e||jsonb_build_array('Pessoa vinculada precisa ter papel de fornecedor.');end if;
      end if;
    end if;
    if jsonb_typeof(d->'correction_locked') is distinct from 'boolean' then e:=e||jsonb_build_array('Travamento de correção precisa ser explícito.');end if;
    if coalesce(d->'correction'->>'mode','') not in('none','index_number') and not(d->'correction'->>'mode' is null and (d->'correction_locked'='true'::jsonb or d->>'status' in('paid','cancelled'))) then e:=e||jsonb_build_array('Política de correção ausente ou não suportada para promoção.');end if;
    if d->'correction'->>'mode'='none' and exists(select 1 from public.eobra_migration_relations where record_id=r.id and role='correction_index') then e:=e||jsonb_build_array('Política sem correção contradiz vínculo de índice aplicável.');end if;
    if d->'correction'->>'mode'='none' and d->'correction_locked'='false'::jsonb and d->>'status' in('open','partial') and public.eobra_snapshot_signed_money(d->>'correction_amount')<>0 then e:=e||jsonb_build_array('Parcela sem correção futura possui componente de correção não reconciliado.');end if;
    if d->'correction'->>'mode'='index_number' then
      if coalesce(d->'correction'->>'base_month','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or coalesce(d->'correction'->>'reference_month','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then e:=e||jsonb_build_array('Base e referência do índice devem ser explícitas.');end if;
      if (select count(*) from public.eobra_migration_relations where record_id=r.id and role='correction_index' and target_entity='correction_index')<>1 then e:=e||jsonb_build_array('Índice da parcela sem referência explícita.');end if;
      foreach k in array array['base_value','reference_value'] loop
        if coalesce(d->'correction'->>k,'') !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then e:=e||jsonb_build_array('Valor de índice explícito inválido: '||k);
        elsif (d->'correction'->>k)::numeric<=0 then e:=e||jsonb_build_array('Índice numérico precisa ser positivo: '||k);end if;
      end loop;
      select * into index_record from public.eobra_migration_records where id=public.eobra_snapshot_resolve_link(r.id,'correction_index','correction_index');
      if index_record.id is null or index_record.normalized_data->>'value_type'<>'index_number' then e:=e||jsonb_build_array('Política index_number exige um índice numérico explícito.');end if;
      foreach k in array array['base','reference'] loop
        select count(*),min(case when iv.normalized_data->>'value' ~ '^[0-9]{1,14}(\.[0-9]{1,6})?$' then (iv.normalized_data->>'value')::numeric end) into point_count,point_value
          from public.eobra_migration_records iv join public.eobra_migration_relations il on il.record_id=iv.id and il.role='index' and il.target_entity='correction_index'
          where iv.run_id=r.run_id and iv.entity='index_value' and il.target_source_id=index_record.source_id and iv.normalized_data->>'reference_month'=d->'correction'->>(k||'_month');
        if point_count<>1 or point_value is null or point_value<=0 or d->'correction'->>(k||'_value') !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then e:=e||jsonb_build_array('Valor mensal do índice não está conferido: '||k);
        elsif point_value is distinct from (d->'correction'->>(k||'_value'))::numeric then e:=e||jsonb_build_array('Valor declarado diverge do cadastro mensal do índice: '||k);end if;
      end loop;
      base_month:=public.eobra_import_date(d->'correction'->>'base_month'||'-01');reference_month:=public.eobra_import_date(d->'correction'->>'reference_month'||'-01');
      if base_month>reference_month then e:=e||jsonb_build_array('Competência de correção anterior à base.');end if;
      if d->'correction_locked'='false'::jsonb and d->>'status' in('open','partial') and d->'correction'->>'base_value' ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' and d->'correction'->>'reference_value' ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' and (d->'correction'->>'base_value')::numeric>0 then
        effective_value:=(d->'correction'->>'reference_value')::numeric;
        if d->'correction'->>'negative_variation_policy'='maximum_of_period' and base_month is not null and reference_month>=base_month then
          months_expected:=(extract(year from reference_month)::int-extract(year from base_month)::int)*12+extract(month from reference_month)::int-extract(month from base_month)::int+1;
          select count(distinct iv.normalized_data->>'reference_month'),max(case when iv.normalized_data->>'value' ~ '^[0-9]{1,14}(\.[0-9]{1,6})?$' then (iv.normalized_data->>'value')::numeric end) into point_count,effective_value
            from public.eobra_migration_records iv join public.eobra_migration_relations il on il.record_id=iv.id and il.role='index' and il.target_entity='correction_index'
            where iv.run_id=r.run_id and iv.entity='index_value' and il.target_source_id=index_record.source_id and public.eobra_import_date(iv.normalized_data->>'reference_month'||'-01') between base_month and reference_month;
          if point_count<>months_expected then e:=e||jsonb_build_array('Política de máximo do período exige série mensal completa.');end if;
        elsif coalesce(d->'correction'->>'negative_variation_policy','use_negative')<>'use_negative' then e:=e||jsonb_build_array('Política de variação negativa não suportada.');end if;
        if public.eobra_snapshot_signed_money(d->>'correction_amount') is distinct from round(original*effective_value/(d->'correction'->>'base_value')::numeric,2)-original then e:=e||jsonb_build_array('Correção informada diverge da regra e dos valores de índice capturados.');end if;
      end if;
    end if;
  elsif r.entity='settlement' then
    if coalesce(d->>'kind','') not in('payment','reversal','voided_payment') or public.eobra_import_money(d->>'amount') is null or public.eobra_import_money(d->>'amount')<=0 or public.eobra_import_date(d->>'occurred_on') is null then e:=e||jsonb_build_array('Evento de baixa inválido.');end if;
    if public.eobra_import_date(d->>'occurred_on')>b.reference_date then e:=e||jsonb_build_array('Evento de baixa posterior à data de referência.');end if;
    if (select count(*) from public.eobra_migration_relations where record_id=r.id and role='installment' and target_entity in('receivable','payable'))<>1 then e:=e||jsonb_build_array('Baixa exige exatamente uma parcela de origem.');end if;
    if coalesce(d->>'medium','') not in('bank','cash','non_cash') and not(d->>'kind'='voided_payment' and d->>'medium'='unknown') then e:=e||jsonb_build_array('Meio da baixa ainda não identificado.');end if;
    if d->>'kind'='voided_payment' then
      if d->'voided_date_unknown' is distinct from 'true'::jsonb or nullif(btrim(d->>'voided_by_source_id'),'') is null
        or (select count(*) from public.eobra_migration_relations where record_id=r.id and role='voided_by' and target_entity='raw_archive' and target_source_id=d->>'voided_by_source_id')<>1 then e:=e||jsonb_build_array('Baixa anulada exige evidência explícita do estorno sem data, arquivado e vinculado.');end if;
    elsif d ? 'voided_by_source_id' or d ? 'voided_date_unknown' then e:=e||jsonb_build_array('Baixa efetiva não pode carregar sinalização de anulação.');end if;
    if d->>'medium' in('bank','cash') and (select count(*) from public.eobra_migration_relations where record_id=r.id and role='account' and target_entity='bank_account')<>1 then e:=e||jsonb_build_array('Baixa bancária/caixa exige a conta efetiva.');end if;
    if d->>'kind'='reversal' then
      if (select count(*) from public.eobra_migration_relations where record_id=r.id and role='reverses' and target_entity='settlement')<>1 then e:=e||jsonb_build_array('Estorno exige exatamente um pagamento original.');end if;
      target:=public.eobra_snapshot_resolve_link(r.id,'reverses','settlement');select * into t from public.eobra_migration_records where id=target;
      if t.id is null or t.normalized_data->>'kind'<>'payment' or public.eobra_snapshot_resolve_link(t.id,'installment') is distinct from public.eobra_snapshot_resolve_link(r.id,'installment') then e:=e||jsonb_build_array('Estorno precisa referenciar pagamento da mesma parcela.');
      else
        if public.eobra_import_date(d->>'occurred_on')<public.eobra_import_date(t.normalized_data->>'occurred_on') then e:=e||jsonb_build_array('Estorno anterior ao pagamento.');end if;
        select coalesce(sum(public.eobra_import_money(s.normalized_data->>'amount')),0) into net_events from public.eobra_migration_records s join public.eobra_migration_relations sl on sl.record_id=s.id where s.run_id=r.run_id and s.entity='settlement' and s.normalized_data->>'kind'='reversal' and sl.role='reverses' and sl.target_source_id=t.source_id and sl.target_entity='settlement';
        if net_events>public.eobra_import_money(t.normalized_data->>'amount') then e:=e||jsonb_build_array('Estornos excedem o pagamento original.');end if;
      end if;
    end if;
  elsif r.entity='bank_account' then
    if nullif(btrim(d->>'name'),'') is null or coalesce(d->>'status','') not in('active','inactive','unknown') or coalesce(d->>'currency','')<>'BRL' then e:=e||jsonb_build_array('Conta de origem sem identificação, moeda BRL ou situação válida.');end if;
    if d->>'status'='unknown' and d->>'status_provenance' is distinct from 'not_exposed_by_source' then e:=e||jsonb_build_array('Conta histórica sem situação exige proveniência explícita da ausência na origem.');end if;
  elsif r.entity='bank_transaction' then
    if public.eobra_import_date(d->>'occurred_on') is null or public.eobra_import_money(d->>'amount') is null or public.eobra_import_money(d->>'amount')<=0 or coalesce(d->>'direction','') not in('credit','debit') or coalesce(d->>'status','') not in('posted','cancelled') then e:=e||jsonb_build_array('Movimento bancário de origem inválido.');end if;
    if (select count(*) from public.eobra_migration_relations where record_id=r.id and role='account' and target_entity='bank_account')<>1 then e:=e||jsonb_build_array('Movimento sem conta de origem explícita.');end if;
  elsif r.entity='correction_index' then
    if nullif(btrim(d->>'code'),'') is null or nullif(btrim(d->>'name'),'') is null or coalesce(d->>'value_type','') not in('index_number','percentage') then e:=e||jsonb_build_array('Cadastro de índice inválido.');end if;
  elsif r.entity='index_value' then
    if coalesce(d->>'reference_month','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or coalesce(d->>'value','') !~ '^-?[0-9]{1,14}(\.[0-9]{1,6})?$' then e:=e||jsonb_build_array('Mês ou valor do índice inválidos.');end if;
    if (select count(*) from public.eobra_migration_relations where record_id=r.id and role='index' and target_entity='correction_index')<>1 then e:=e||jsonb_build_array('Valor mensal sem índice explícito.');end if;
  end if;
  return (select coalesce(jsonb_agg(distinct x),'[]'::jsonb) from jsonb_array_elements(e) x);
end; $$;
commit;
