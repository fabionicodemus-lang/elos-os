-- Promotion of a reviewed package. The original source package remains intact.
-- Historical events are audit evidence; this RPC never posts a bank movement.
begin;

create or replace function public.eobra_snapshot_link_ledger(p_record_id uuid,p_role text,p_entity text default null)
returns uuid language sql stable security invoker set search_path=pg_catalog,public
as $$ select l.id from public.eobra_migration_records r
  join public.eobra_migration_runs b on b.id=r.run_id
  join public.eobra_migration_records target on target.id=public.eobra_snapshot_resolve_link(r.id,p_role,p_entity)
  join public.eobra_migration_ledger l on l.company_id=r.company_id and l.source_host=b.source_host and l.entity=target.entity and l.archive_type=target.archive_type and l.source_id=target.source_id and l.record_hash=target.record_hash
  where r.id=p_record_id; $$;

create or replace function public.eobra_snapshot_link_target(p_record_id uuid,p_role text,p_entity text,p_table text)
returns uuid language sql stable security invoker set search_path=pg_catalog,public
as $$ select public.eobra_import_uuid(targets->>p_table) from public.eobra_migration_ledger where id=public.eobra_snapshot_link_ledger(p_record_id,p_role,p_entity); $$;

-- Replaced by the optional relational commercial migration. Single-unit core
-- remains complete and does not pretend to support a multi-unit contract.
create or replace function public.eobra_snapshot_promote_sale_units(p_record_id uuid,p_sale_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,public
as $$ begin
  if (select count(*) from public.eobra_migration_relations where record_id=p_record_id and role='unit')<>1 then raise exception 'Vínculos de múltiplas unidades ainda não instalados.';end if;
end; $$;
create or replace function public.eobra_snapshot_sale_units_match(p_record_id uuid,p_sale_id uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog,public
as $$ select (select count(*) from public.eobra_migration_relations where record_id=p_record_id and role='unit')=1; $$;

-- Whitelisted, typed projection used both to INSERT and independently verify
-- the ledger target. Missing optional values retain their native defaults.
create or replace function public.eobra_snapshot_native_payload(p_record_id uuid,p_table text)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;d jsonb;p jsonb;k text;s public.sales%rowtype;paid_day date;begin
  select * into r from public.eobra_migration_records where id=p_record_id;
  select * into b from public.eobra_migration_runs where id=r.run_id;
  if r.id is null or not public.eobra_snapshot_authorized(r.company_id,public.eobra_snapshot_permissions(r.entity,r.normalized_data)) then raise exception 'Registro indisponível ou sem permissão.';end if;
  d:=r.normalized_data;
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
      select * into s from public.sales where id=public.eobra_snapshot_link_target(r.id,'sale','sale','sales') and company_id=r.company_id and project_id=r.project_id;
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

create or replace function public.eobra_snapshot_guard_result()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare j jsonb:=to_jsonb(new);r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;d jsonb;expected jsonb;native jsonb;k text;v jsonb;target uuid;ledger_id uuid;title public.eobra_migration_ledger%rowtype;allowed text[];begin
  if tg_op<>'INSERT' then raise exception 'Identidade e histórico importados são imutáveis.';end if;
  select * into r from public.eobra_migration_records where id=(j->>'record_id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('eobra-snapshot:'||r.company_id::text,0));
  select * into b from public.eobra_migration_runs where id=r.run_id for update;
  if r.id is null or b.status<>'ready' or b.preview_hash is null or b.summary->'coverage_complete' is distinct from 'true'::jsonb
    or r.review_status not in('ready','archived') or jsonb_array_length(r.errors)>0
    or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions)
    or j->>'run_id' is distinct from b.id::text or j->>'company_id' is distinct from r.company_id::text
    or j->>'project_id' is distinct from r.project_id::text or j->>'source_host' is distinct from b.source_host or j->>'source_id' is distinct from r.source_id then raise exception 'Resultado sem prévia íntegra, autorizada e correspondente à origem.';end if;
  d:=r.normalized_data;
  if tg_table_name='eobra_migration_ledger' then
    if j->>'entity' is distinct from r.entity or j->>'source_project_id' is distinct from r.source_project_id or j->>'archive_type' is distinct from r.archive_type or j->>'record_hash' is distinct from r.record_hash
      or j->'required_permissions' is distinct from to_jsonb(public.eobra_snapshot_permissions(r.entity,d)) then raise exception 'Identidade ou permissões do ledger divergem da origem.';end if;
    expected:='{}';
    if r.entity='project' and r.project_id is not null then expected:=jsonb_build_object('projects',r.project_id);
    elsif r.entity='person' then
      if d->'roles' ? 'client' then expected:=expected||jsonb_build_object('clients',j->'targets'->'clients');end if;
      if d->'roles' ? 'supplier' then expected:=expected||jsonb_build_object('suppliers',j->'targets'->'suppliers');end if;
    elsif r.entity='unit' then expected:=jsonb_build_object('units',j->'targets'->'units');
    elsif r.entity='sale' and d->>'status'<>'draft' then expected:=jsonb_build_object('sales',j->'targets'->'sales');
    elsif r.entity in('receivable','payable') then k:=case r.entity when 'receivable' then 'receivables' else 'payables' end;expected:=jsonb_build_object(k,j->'targets'->k);
    elsif r.entity='bank_account' then expected:=jsonb_build_object('eobra_source_accounts',j->'targets'->'eobra_source_accounts');
    elsif r.entity in('correction_index','index_value') then expected:=jsonb_build_object('eobra_source_indices',j->'targets'->'eobra_source_indices');
    elsif r.entity in('settlement','bank_transaction') then expected:=jsonb_build_object('eobra_source_events',j->'targets'->'eobra_source_events');end if;
    if j->'targets' is distinct from expected or j->>'disposition' is distinct from (case when r.review_status='archived' then 'source_archive' else 'canonical' end) then raise exception 'Destinos do ledger não correspondem à entidade revisada.';end if;
    for k,v in select key,value from jsonb_each(expected) loop
      target:=public.eobra_import_uuid(v#>>'{}');
      if target is null then raise exception 'Destino real obrigatório para %.',k;end if;
      if k='projects' then
        if target is distinct from r.project_id or not exists(select 1 from public.projects where id=target and company_id=r.company_id) then raise exception 'Obra do ledger não corresponde ao de-para.';end if;
      elsif k in('eobra_source_accounts','eobra_source_indices','eobra_source_events') then
        execute format('select to_jsonb(t) from public.%I t where id=$1 and record_id=$2 and company_id=$3',k) into native using target,r.id,r.company_id;
        if native is null then raise exception 'Histórico de origem não corresponde ao ledger.';end if;
      elsif k in('clients','suppliers') and r.expected_targets ? k then
        if target is distinct from public.eobra_import_uuid(r.expected_targets->>k) or public.eobra_snapshot_expected_targets(r.id)->>k is distinct from target::text then raise exception 'Cadastro reutilizado mudou após a revisão.';end if;
      else
        execute format('select to_jsonb(t) from public.%I t where id=$1 and company_id=$2',k) into native using target,r.company_id;
        expected:=public.eobra_snapshot_native_payload(r.id,k);
        if native is null or not native @> expected then raise exception 'Destino canônico diverge dos valores e vínculos revisados: %.',k;end if;
        if k='sales' and (
          not public.eobra_snapshot_sale_units_match(r.id,target)
          or
          (select count(*) from public.commercial_sale_parties where sale_id=target and company_id=r.company_id and project_id=r.project_id and status='active')<>(select count(*) from public.eobra_migration_relations where record_id=r.id and role='buyer')
          or exists(select 1 from public.eobra_migration_relations rel join public.eobra_migration_records person on person.run_id=r.run_id and person.entity='person' and person.source_id=rel.target_source_id
            join public.eobra_migration_ledger pl on pl.company_id=b.company_id and pl.source_host=b.source_host and pl.entity='person' and pl.source_id=person.source_id and pl.archive_type=''
            where rel.record_id=r.id and rel.role='buyer' and not exists(select 1 from public.commercial_sale_parties party where party.sale_id=target and party.company_id=r.company_id and party.project_id=r.project_id and party.client_id=public.eobra_import_uuid(pl.targets->>'clients') and party.status='active' and party.is_primary=(person.id=public.eobra_snapshot_resolve_link(r.id,'buyer','person')) and party.ownership_percent is not distinct from rel.ownership_percent))
          ) then raise exception 'Compradores da venda não correspondem a todos os vínculos revisados.';end if;
      end if;
    end loop;
  else
    if j->'details' is distinct from d then raise exception 'Histórico de origem diverge do registro revisado.';end if;
    if tg_table_name='eobra_source_accounts' then
      if r.entity<>'bank_account' then raise exception 'Conta exige cadastro bancário de origem.';end if;
    elsif tg_table_name='eobra_source_indices' then
      if r.entity not in('correction_index','index_value') or j->>'entity' is distinct from r.entity then raise exception 'Índice de origem inválido.';end if;
      target:=case when r.entity='index_value' then public.eobra_snapshot_link_target(r.id,'index','correction_index','eobra_source_indices') end;
      if j->>'parent_index_id' is distinct from target::text or j->>'reference_month' is distinct from (case when r.entity='index_value' then d->>'reference_month'||'-01' end)
        or (j->>'index_value')::numeric is distinct from (case when r.entity='index_value' then (d->>'value')::numeric end) then raise exception 'Valor mensal não corresponde ao índice e mês capturados.';end if;
    elsif tg_table_name='eobra_source_events' then
      if r.entity not in('settlement','bank_transaction') or j->>'entity' is distinct from r.entity or (j->>'amount')::numeric is distinct from public.eobra_import_money(d->>'amount')
        or j->>'occurred_on' is distinct from d->>'occurred_on' or j->>'kind' is distinct from (case when r.entity='settlement' then d->>'kind' else d->>'direction' end)
        or j->>'medium' is distinct from (case when r.entity='settlement' then d->>'medium' end) or j->>'posting_policy'<>'historical_source_only' or j->>'bank_transaction_id' is not null then raise exception 'Evento difere da evidência de origem ou tenta movimentar caixa.';end if;
      target:=public.eobra_snapshot_link_target(r.id,'account','bank_account','eobra_source_accounts');
      if j->>'account_id' is distinct from target::text then raise exception 'Conta do evento não corresponde à conta capturada.';end if;
      ledger_id:=case when r.entity='settlement' then public.eobra_snapshot_link_ledger(r.id,'installment') end;
      select * into title from public.eobra_migration_ledger where id=ledger_id;
      if j->>'title_ledger_id' is distinct from ledger_id::text or j->>'receivable_id' is distinct from title.targets->>'receivables' or j->>'payable_id' is distinct from title.targets->>'payables'
        or r.entity='settlement' and (title.id is null or title.project_id is distinct from r.project_id or title.company_id is distinct from r.company_id) then raise exception 'Parcela do evento diverge do vínculo revisado.';end if;
      target:=case when r.entity='settlement' and d->>'kind'='reversal' then public.eobra_snapshot_link_target(r.id,'reverses','settlement','eobra_source_events') end;
      if j->>'reverses_event_id' is distinct from target::text then raise exception 'Estorno sem pagamento de origem correspondente.';end if;
      target:=case when r.entity='bank_transaction' then public.eobra_snapshot_link_target(r.id,'settlement','settlement','eobra_source_events') end;
      if j->>'settlement_event_id' is distinct from target::text then raise exception 'Movimento difere do evento de origem vinculado.';end if;
    end if;
  end if;
  new.created_by:=auth.uid();new.created_at:=now();new.updated_at:=now();return new;
end; $$;

create or replace function public.promote_eobra_snapshot(p_run_id uuid,p_preview_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;r public.eobra_migration_records%rowtype;prior public.eobra_migration_ledger%rowtype;
  d jsonb;targets jsonb;payload jsonb;v_result jsonb;target uuid;child uuid;table_name text;columns_sql text;select_sql text;party record;party_count integer;primary_record uuid;ledger_id uuid;
  v_created integer:=0;v_reused integer:=0;v_duplicates integer:=0;v_archived integer:=0;total integer:=0;
begin
  select * into b from public.eobra_migration_runs where id=p_run_id;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('eobra-snapshot:'||b.company_id::text,0));
  select * into b from public.eobra_migration_runs where id=p_run_id for update;
  if b.status='imported' then return b.promotion_result;end if;
  if b.status<>'ready' then raise exception 'Snapshot possui pendências ou foi cancelado.';end if;
  perform public.eobra_snapshot_assert_review(b.id);
  if p_preview_hash is distinct from b.preview_hash or b.preview_hash is distinct from public.eobra_snapshot_preview_hash(b.id) or b.summary is distinct from public.eobra_snapshot_summary(b.id) then raise exception 'A revisão mudou; confira novamente os vínculos, totais e cobertura.';end if;
  if b.summary->'coverage_complete' is distinct from 'true'::jsonb or (b.summary->>'blocked')::int+(b.summary->>'conflicts')::int>0 then raise exception 'Cobertura e registros precisam estar conferidos antes da promoção.';end if;
  for r in select * from public.eobra_migration_records where run_id=b.id order by
    case entity when 'project' then 1 when 'person' then 2 when 'bank_account' then 3 when 'correction_index' then 4 when 'index_value' then 5 when 'unit' then 6 when 'sale' then 7 when 'receivable' then 8 when 'payable' then 8 when 'settlement' then case when normalized_data->>'kind'='reversal' then 10 else 9 end when 'bank_transaction' then 11 else 12 end,source_ordinal
  loop
    total:=total+1;d:=r.normalized_data;targets:='{}';
    select * into prior from public.eobra_migration_ledger where company_id=b.company_id and source_host=b.source_host and entity=r.entity and archive_type=r.archive_type and source_id=r.source_id;
    if found then
      if prior.record_hash<>r.record_hash then raise exception 'Identidade já importada com conteúdo diferente; nenhum registro será sobrescrito.';end if;
      update public.eobra_migration_records set status='duplicate',canonical_targets=prior.targets where id=r.id;
      v_duplicates:=v_duplicates+1;continue;
    end if;
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
          update public.units set status='sold',updated_at=now() where id=public.eobra_snapshot_link_target(r.id,'unit','unit','units') and company_id=b.company_id and project_id=r.project_id and status in('available','reserved','sold');
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
    update public.eobra_migration_records set canonical_targets=targets,status=case when r.review_status='archived' then 'archived' else 'imported' end where id=r.id;
  end loop;
  v_result:=jsonb_build_object('total',total,'created',v_created,'reused',v_reused,'duplicates',v_duplicates,'archived',v_archived);
  update public.eobra_migration_runs set status='imported',promotion_result=v_result where id=b.id returning promotion_result into v_result;
  return v_result;
end; $$;

do $$ declare f record;begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname in('eobra_snapshot_link_ledger','eobra_snapshot_link_target','eobra_snapshot_native_payload','eobra_snapshot_promote_sale_units','eobra_snapshot_sale_units_match','promote_eobra_snapshot')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end; $$;
commit;
