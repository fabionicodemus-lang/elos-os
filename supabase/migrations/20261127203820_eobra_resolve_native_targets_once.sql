-- Resolve each authorized identity once per source record, before indexed
-- native lookups. Re-evaluating nested link resolvers for every candidate
-- native row made real batches time out. Existing permissions, RLS, locks,
-- dependency checks, amounts, and immutable-ledger checks are preserved.
begin;

create or replace function public.eobra_snapshot_link_ledger(p_record_id uuid,p_role text,p_entity text default null)
returns uuid language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare target_record uuid;source_company uuid;source_host_name text;source_target record;ledger_id uuid;begin
  -- Every SELECT still runs with caller RLS. Resolve the constant source key
  -- before the ledger lookup so unrelated ledger entries are not candidates.
  target_record:=public.eobra_snapshot_resolve_link(p_record_id,p_role,p_entity);
  select r.company_id,b.source_host into source_company,source_host_name
    from public.eobra_migration_records r join public.eobra_migration_runs b on b.id=r.run_id
    where r.id=p_record_id;
  select entity,archive_type,source_id,record_hash into source_target
    from public.eobra_migration_records where id=target_record;
  if source_company is null or not found then return null;end if;
  select l.id into ledger_id from public.eobra_migration_ledger l
    where l.company_id=source_company and l.source_host=source_host_name
      and l.entity=source_target.entity and l.archive_type=source_target.archive_type
      and l.source_id=source_target.source_id and l.record_hash=source_target.record_hash;
  return ledger_id;
end; $$;

create or replace function public.eobra_snapshot_link_target(p_record_id uuid,p_role text,p_entity text,p_table text)
returns uuid language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare ledger_id uuid;native_id uuid;begin
  ledger_id:=public.eobra_snapshot_link_ledger(p_record_id,p_role,p_entity);
  select public.eobra_import_uuid(targets->>p_table) into native_id
    from public.eobra_migration_ledger where id=ledger_id;
  return native_id;
end; $$;

create or replace function public.eobra_snapshot_assert_dependencies(p_record_id uuid)
returns void language plpgsql volatile security invoker set search_path=pg_catalog,public
as $$ declare r public.eobra_migration_records%rowtype;source public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;rel record;target uuid;target_table text;begin
  select * into r from public.eobra_migration_records where id=p_record_id;select * into b from public.eobra_migration_runs where id=r.run_id;
  if r.id is null or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Registro indisponível.';end if;
  if r.entity='sale' then
    for rel in select link.*,rec.id source_record,public.eobra_import_uuid(ledger.targets->>(case when link.role='unit' then 'units' else 'clients' end)) target_id
      from public.eobra_migration_relations link join public.eobra_migration_records rec on rec.run_id=r.run_id and rec.entity=link.target_entity and rec.source_id=link.target_source_id and rec.archive_type=link.target_archive_type
      left join public.eobra_migration_ledger ledger on ledger.company_id=b.company_id and ledger.source_host=b.source_host and ledger.entity=rec.entity and ledger.source_id=rec.source_id and ledger.archive_type=rec.archive_type and ledger.record_hash=rec.record_hash
      where link.record_id=r.id and link.role in('unit','buyer') order by link.role,rec.source_id loop
      perform public.eobra_snapshot_assert_native_target(rel.source_record,case when rel.role='unit' then 'units' else 'clients' end,rel.target_id);
    end loop;
  elsif r.entity='receivable' then
    target:=public.eobra_snapshot_resolve_link(r.id,'sale','sale');
    perform public.eobra_snapshot_assert_native_target(target,'sales',public.eobra_snapshot_link_target(r.id,'sale','sale','sales'));
  elsif r.entity='payable' and exists(select 1 from public.eobra_migration_relations where record_id=r.id and role='supplier') then
    target:=public.eobra_snapshot_resolve_link(r.id,'supplier','person');
    perform public.eobra_snapshot_assert_native_target(target,'suppliers',public.eobra_snapshot_link_target(r.id,'supplier','person','suppliers'));
  elsif r.entity='settlement' then
    target:=public.eobra_snapshot_resolve_link(r.id,'installment');
    select * into source from public.eobra_migration_records where id=target;
    target_table:=case source.entity when 'receivable' then 'receivables' when 'payable' then 'payables' end;
    perform public.eobra_snapshot_assert_native_target(source.id,target_table,public.eobra_snapshot_link_target(r.id,'installment',source.entity,target_table));
  end if;
end; $$;

create or replace function public.eobra_snapshot_native_payload(p_record_id uuid,p_table text)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,public
as $$ declare r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;d jsonb;p jsonb;k text;s public.sales%rowtype;paid_day date;sale_target uuid;begin
  select * into r from public.eobra_migration_records where id=p_record_id;
  select * into b from public.eobra_migration_runs where id=r.run_id;
  if r.id is null or not public.eobra_snapshot_authorized(r.company_id,public.eobra_snapshot_permissions(r.entity,r.normalized_data)) then raise exception 'Registro indisponível ou sem permissão.';end if;
  d:=r.normalized_data;
  perform public.eobra_snapshot_assert_dependencies(r.id);
  p:=jsonb_build_object('company_id',r.company_id,'source_system','eobra_snapshot','source_id',b.source_host||'|'||r.entity||'|'||r.source_id,'created_by',auth.uid());
  if r.entity='person' and p_table in('clients','suppliers') and d->'roles' ? (case when p_table='clients' then 'client' else 'supplier' end) then
    p:=p||jsonb_build_object(case when p_table='clients' then 'name' else 'legal_name' end,d->>'name','person_type',case when p_table='clients' then d->>'person_type' else case d->>'person_type' when 'PF' then 'individual' when 'PJ' then 'company' else 'other' end end,'tax_id',nullif(regexp_replace(coalesce(d->>'tax_id',''),'[^0-9]','','g'),''),'status',d->>'status');
    foreach k in array array['email','phone','address','city','state','notes'] loop if d ? k then p:=p||jsonb_build_object(k,d->>k);end if;end loop;
  elsif r.entity='unit' and p_table='units' then
    p:=p||jsonb_build_object('project_id',r.project_id,'code',d->>'code','status',d->>'status');
    foreach k in array array['tower','type','registry','notes','position','parking_description'] loop if d ? k then p:=p||jsonb_build_object(k,d->>k);end if;end loop;
    foreach k in array array['floor','bedrooms','suites','parking_spaces'] loop if d->>k is not null then p:=p||jsonb_build_object(k,(d->>k)::int);end if;end loop;
    foreach k in array array['private_area','total_area','common_area','uncovered_private_area','fractional_share','list_price'] loop if d->>k is not null then p:=p||jsonb_build_object(k,(d->>k)::numeric);end if;end loop;
  elsif r.entity='sale' and p_table='sales' and d->>'status'<>'draft' then
    p:=p||jsonb_build_object('project_id',r.project_id,'unit_id',public.eobra_snapshot_link_target(r.id,'unit','unit','units'),'client_id',public.eobra_snapshot_link_target(r.id,'buyer','person','clients'),
      'number',d->>'number','sale_date',public.eobra_import_date(d->>'sale_date'),'total_amount',public.eobra_import_money(d->>'total_amount'),'status',d->>'status');
    foreach k in array array['source_code','contract_number','broker_name','notes'] loop if d ? k then p:=p||jsonb_build_object(k,d->>k);end if;end loop;
    foreach k in array array['commission_pct','commission_amount'] loop if d->>k is not null then p:=p||jsonb_build_object(k,(d->>k)::numeric);end if;end loop;
  elsif r.entity in('receivable','payable') and p_table=(case r.entity when 'receivable' then 'receivables' else 'payables' end) then
    select max(public.eobra_import_date(e.normalized_data->>'occurred_on')) into paid_day
      from public.eobra_migration_records e join public.eobra_migration_relations link on link.record_id=e.id and link.role='installment'
      where e.run_id=r.run_id and e.entity='settlement' and e.normalized_data->>'kind'='payment' and link.target_entity=r.entity and link.target_source_id=r.source_id;
    p:=p||jsonb_build_object('project_id',r.project_id,'due_date',public.eobra_import_date(d->>'due_date'),'amount',public.eobra_import_money(d->>'original_amount'),
      'paid_amount',public.eobra_import_money(d->>'paid_amount'),'paid_at',case when public.eobra_import_money(d->>'paid_amount')>0 then paid_day end,
      'status',case when d->>'status'='partial' then 'open' else d->>'status' end,
      'installment_interest_amount',public.eobra_import_money(d->>'interest_amount'),'correction_amount',public.eobra_snapshot_signed_money(d->>'correction_amount'),
      'late_fee_amount',public.eobra_import_money(d->>'penalty_amount'),'other_accrual_amount',public.eobra_import_money(d->>'other_accrual_amount'),'discount_amount',public.eobra_import_money(d->>'discount_amount'));
    foreach k in array array['notes','paid_account_name'] loop if d ? k then p:=p||jsonb_build_object(k,d->>k);end if;end loop;
    if r.entity='receivable' then
      sale_target:=public.eobra_snapshot_link_target(r.id,'sale','sale','sales');
      select * into s from public.sales where id=sale_target and company_id=r.company_id and project_id=r.project_id;
      if s.id is null then raise exception 'Venda da parcela ainda não promovida ou fora da obra.';end if;
      p:=p||jsonb_build_object('sale_id',s.id,'unit_id',s.unit_id,'client_id',s.client_id,'category',coalesce(d->>'category','other'),'description',coalesce(nullif(d->>'description',''),d->>'document'),
        'sequence_number',(d->>'sequence_number')::int,'sequence_total',(d->>'sequence_total')::int,'adjusted_amount',public.eobra_import_money(d->>'current_amount'),'correction_locked',true);
      if d->'correction'->>'mode'='index_number' then
        p:=p||jsonb_build_object('correction_base_month',(d->'correction'->>'base_month'||'-01')::date,'correction_base_value',(d->'correction'->>'base_value')::numeric,
          'correction_reference_month',(d->'correction'->>'reference_month'||'-01')::date,'correction_reference_value',(d->'correction'->>'reference_value')::numeric);
      end if;
    else
      p:=p||jsonb_build_object('supplier_id',public.eobra_snapshot_link_target(r.id,'supplier','person','suppliers'),'document',coalesce(nullif(d->>'document',''),d->>'description'),
        'beneficiary_name',d->>'counterparty_name','beneficiary_tax_id',d->>'counterparty_tax_id','origin','historical_import');
      foreach k in array array['installment_label','fiscal_class','payment_method','source_category'] loop if d ? k then p:=p||jsonb_build_object(k,d->>k);end if;end loop;
    end if;
  else raise exception 'Destino não implementado para esta entidade.';end if;
  return p;
end; $$;

create or replace function public.promote_eobra_snapshot_chunk(p_run_id uuid,p_preview_hash text,p_limit integer default 50)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;r public.eobra_migration_records%rowtype;prior public.eobra_migration_ledger%rowtype;
  d jsonb;targets jsonb;payload jsonb;v_result jsonb;local_issues jsonb;target uuid;child uuid;table_name text;columns_sql text;select_sql text;party record;party_count integer;primary_record uuid;ledger_id uuid;
  v_created integer:=0;v_reused integer:=0;v_duplicates integer:=0;v_archived integer:=0;total integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'Promova entre 1 e 50 registros por chamada.';end if;
  select * into b from public.eobra_migration_runs where id=p_run_id;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('eobra-snapshot:'||b.company_id::text,0));
  select * into b from public.eobra_migration_runs where id=p_run_id for update;
  if b.status='imported' then return public.eobra_snapshot_progress(b.id);end if;
  if b.unit_map_confirmed_at is null and exists(select 1 from public.eobra_migration_records where run_id=b.id and entity='unit') then raise exception 'De-para de unidades não confirmado; prepare a revisão antes de promover.';end if;
  if b.status not in('ready','promoting') then raise exception 'Snapshot possui pendências ou foi cancelado.';end if;
  if p_preview_hash is distinct from b.preview_hash then raise exception 'A revisão mudou; confira novamente os vínculos, totais e cobertura.';end if;
  if b.status='ready' then
    update public.eobra_migration_runs set status='promoting' where id=b.id;
    select * into b from public.eobra_migration_runs where id=p_run_id;
  end if;
  for r in select * from public.eobra_migration_records where run_id=b.id and not promoted order by
    case entity when 'project' then 1 when 'person' then 2 when 'bank_account' then 3 when 'correction_index' then 4 when 'index_value' then 5 when 'unit' then 6 when 'sale' then 7 when 'receivable' then 8 when 'payable' then 8 when 'settlement' then case when normalized_data->>'kind'='reversal' then 10 else 9 end when 'bank_transaction' then 11 else 12 end,source_ordinal limit p_limit
  loop
    total:=total+1;d:=r.normalized_data;targets:='{}';
    select * into prior from public.eobra_migration_ledger where company_id=b.company_id and source_host=b.source_host and entity=r.entity and archive_type=r.archive_type and source_id=r.source_id;
    if found then
      if prior.record_hash<>r.record_hash then raise exception 'Identidade já importada com conteúdo diferente; nenhum registro será sobrescrito.';end if;
      if r.review_status<>'duplicate' then raise exception 'A revisão dos registros mudou: uma identidade foi importada por outra execução; prepare nova revisão.';end if;
      update public.eobra_migration_records set status='duplicate',canonical_targets=prior.targets,promoted=true where id=r.id;
      v_duplicates:=v_duplicates+1;continue;
    end if;
    if r.review_status='duplicate' then raise exception 'Identidade previamente importada ficou indisponível.';end if;
    local_issues:=public.eobra_snapshot_record_errors(r.id);
    if jsonb_array_length(local_issues)>0 or public.eobra_snapshot_expected_targets(r.id) is distinct from r.expected_targets then raise exception 'Registro % mudou após a revisão: %',r.source_id,local_issues::text;end if;
    perform public.eobra_snapshot_assert_dependencies(r.id);
    if r.entity='project' and r.project_id is not null then targets:=jsonb_build_object('projects',r.project_id);v_reused:=v_reused+1;
    elsif r.entity='person' or r.entity in('unit','sale','receivable','payable') and not(r.entity='sale' and d->>'status'='draft') then
      foreach table_name in array (case r.entity when 'person' then array_remove(array[case when d->'roles' ? 'client' then 'clients' end,case when d->'roles' ? 'supplier' then 'suppliers' end],null) when 'unit' then array['units'] when 'sale' then array['sales'] when 'receivable' then array['receivables'] else array['payables'] end) loop
        if r.expected_targets ? table_name then target:=(r.expected_targets->>table_name)::uuid;v_reused:=v_reused+1;
        else
          payload:=public.eobra_snapshot_native_payload(r.id,table_name);
          select string_agg(format('%I',key),',' order by key),string_agg(format('x.%I',key),',' order by key) into columns_sql,select_sql from jsonb_each(payload);
          execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) x returning id',table_name,columns_sql,select_sql,table_name) into target using payload;
          v_created:=v_created+1;
        end if;
        targets:=targets||jsonb_build_object(table_name,target);
      end loop;
      if r.entity='sale' and d->>'status'<>'draft' then
        target:=(targets->>'sales')::uuid;primary_record:=public.eobra_snapshot_resolve_link(r.id,'buyer','person');
        for party in select rel.*,person.id person_record,person.normalized_data person_data,public.eobra_import_uuid(l.targets->>'clients') client_id
          from public.eobra_migration_relations rel join public.eobra_migration_records person on person.run_id=r.run_id and person.entity='person' and person.source_id=rel.target_source_id
          join public.eobra_migration_ledger l on l.company_id=b.company_id and l.source_host=b.source_host and l.entity='person' and l.source_id=person.source_id and l.archive_type=''
          where rel.record_id=r.id and rel.role='buyer' loop
          insert into public.commercial_sale_parties(company_id,project_id,sale_id,client_id,role,ownership_percent,is_primary,status,joined_at,notes,created_by)
          values(b.company_id,r.project_id,target,party.client_id,case when party.person_record=primary_record then 'buyer' else 'co_buyer' end,party.ownership_percent,party.person_record=primary_record,'active',public.eobra_import_date(d->>'sale_date'),case when party.source_relation_id is not null then 'Vínculo de origem eObra: '||party.source_relation_id end,auth.uid());
        end loop;
        perform public.eobra_snapshot_promote_sale_units(r.id,target);
        if d->>'status'='active' then
          child:=public.eobra_snapshot_link_target(r.id,'unit','unit','units');
          update public.units set status='sold',updated_at=now() where id=child and company_id=b.company_id and project_id=r.project_id and status in('available','reserved','sold');
          if not found then raise exception 'Unidade inativa ou fora da obra não pode receber uma venda ativa.';end if;
        end if;
      end if;
    elsif r.entity='bank_account' then
      insert into public.eobra_source_accounts(company_id,project_id,run_id,record_id,source_host,source_id,details) values(b.company_id,r.project_id,b.id,r.id,b.source_host,r.source_id,d) returning id into target;
      targets:=jsonb_build_object('eobra_source_accounts',target);
    elsif r.entity in('correction_index','index_value') then
      insert into public.eobra_source_indices(company_id,project_id,run_id,record_id,source_host,source_id,entity,parent_index_id,reference_month,index_value,details)
      values(b.company_id,r.project_id,b.id,r.id,b.source_host,r.source_id,r.entity,case when r.entity='index_value' then public.eobra_snapshot_link_target(r.id,'index','correction_index','eobra_source_indices') end,
        case when r.entity='index_value' then (d->>'reference_month'||'-01')::date end,case when r.entity='index_value' then (d->>'value')::numeric end,d) returning id into target;
      targets:=jsonb_build_object('eobra_source_indices',target);
    elsif r.entity in('settlement','bank_transaction') then
      ledger_id:=case when r.entity='settlement' then public.eobra_snapshot_link_ledger(r.id,'installment') end;
      select * into prior from public.eobra_migration_ledger where id=ledger_id;
      insert into public.eobra_source_events(company_id,project_id,run_id,record_id,source_host,source_id,entity,title_ledger_id,account_id,receivable_id,payable_id,reverses_event_id,settlement_event_id,kind,occurred_on,amount,medium,details)
      values(b.company_id,r.project_id,b.id,r.id,b.source_host,r.source_id,r.entity,ledger_id,public.eobra_snapshot_link_target(r.id,'account','bank_account','eobra_source_accounts'),public.eobra_import_uuid(prior.targets->>'receivables'),public.eobra_import_uuid(prior.targets->>'payables'),
        case when r.entity='settlement' and d->>'kind'='reversal' then public.eobra_snapshot_link_target(r.id,'reverses','settlement','eobra_source_events') end,
        case when r.entity='bank_transaction' then public.eobra_snapshot_link_target(r.id,'settlement','settlement','eobra_source_events') end,
        case when r.entity='settlement' then d->>'kind' else d->>'direction' end,public.eobra_import_date(d->>'occurred_on'),public.eobra_import_money(d->>'amount'),case when r.entity='settlement' then d->>'medium' end,d) returning id into target;
      targets:=jsonb_build_object('eobra_source_events',target);
    end if;
    insert into public.eobra_migration_ledger(company_id,project_id,source_host,entity,source_id,source_project_id,archive_type,record_hash,targets,disposition,run_id,record_id,required_permissions)
    values(b.company_id,r.project_id,b.source_host,r.entity,r.source_id,r.source_project_id,r.archive_type,r.record_hash,targets,case when r.review_status='archived' then 'source_archive' else 'canonical' end,b.id,r.id,public.eobra_snapshot_permissions(r.entity,d));
    if r.review_status='archived' then v_archived:=v_archived+1;end if;
    update public.eobra_migration_records set canonical_targets=targets,promoted=true,status=case when r.review_status='archived' then 'archived' else 'imported' end where id=r.id;
  end loop;
  if not exists(select 1 from public.eobra_migration_records where run_id=b.id and not promoted) then
    update public.eobra_migration_runs set status='imported',promotion_result='{}' where id=b.id;
  end if;
  return public.eobra_snapshot_progress(b.id);
end; $$;

commit;
