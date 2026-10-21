-- Etapa 6. Candidata: aplicar só em desenvolvimento/teste após a fundação.
-- Não executa ondas antigas, não altera dados legados e não cria movimento bancário.
begin;
create table elos_import.financial_batches (
 run_id uuid primary key references elos_import.runs(id),
 company_id uuid not null references public.companies(id),
 command_id uuid not null, enterprise_id text not null,
 content_hash text not null, content jsonb not null, report jsonb,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(), unique(company_id,command_id)
);
create table elos_import.financial_objects (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 enterprise_id text not null, external_id text not null, installment text not null,
 project_id uuid references public.projects(id), legal_entity_id uuid references public.legal_entities(id),
 target_id uuid references public.payables(id),
 snapshot jsonb not null, applied_snapshot jsonb, version bigint not null,
 extracted_at timestamptz not null, run_id uuid not null references elos_import.runs(id),
 pending text[] not null default '{}', created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(company_id,enterprise_id,external_id,installment), unique(company_id,target_id)
);
create table elos_import.financial_revisions (
 id bigint generated always as identity primary key, company_id uuid not null references public.companies(id),
 project_id uuid references public.projects(id),
 object_id uuid not null references elos_import.financial_objects(id), version bigint not null,
 run_id uuid not null references elos_import.runs(id), previous_value jsonb, new_value jsonb not null,
 reason text not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(), unique(object_id,version)
);
create trigger financial_batches_immutable before delete on elos_import.financial_batches for each row execute function finance_private.immutable_audit();
create trigger financial_revisions_immutable before update or delete on elos_import.financial_revisions for each row execute function finance_private.immutable_audit();
alter table elos_import.financial_batches enable row level security;
alter table elos_import.financial_objects enable row level security;
alter table elos_import.financial_revisions enable row level security;
revoke all on elos_import.financial_batches,elos_import.financial_objects,elos_import.financial_revisions from public,anon,authenticated;

create function elos_import.seal_financial_batch() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'report') is distinct from (to_jsonb(old)-'report') or old.report is not null
 then raise exception 'Manifesto e original imutáveis.';end if;
 return new;
end $$;
create trigger financial_batches_seal before update on elos_import.financial_batches for each row execute function elos_import.seal_financial_batch();

-- Um snapshot de baixa não é um evento bancário. Valores declarados ficam nesta
-- reconciliação, separados do saldo operacional e do caixa (não certificado).
create function elos_import.financial_position(p_company uuid,p_enterprise text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'objects',count(*),'principal_cents',coalesce(sum((snapshot->>'principal_cents')::bigint),0),
 'reported_paid_cents',case when count(*) filter(where snapshot->>'reported_paid_cents' is null)>0 then null else coalesce(sum((snapshot->>'reported_paid_cents')::bigint),0) end,
 'principal_minus_declared_paid_cents',case when count(*) filter(where snapshot->>'reported_paid_cents' is null)>0 then null else coalesce(sum(greatest(0,(snapshot->>'principal_cents')::bigint-(snapshot->>'reported_paid_cents')::bigint)) filter(where not(snapshot->>'source_status'='Cancelada' and coalesce((snapshot->>'obligation_extinguished')::boolean,false) and snapshot->>'cancellation_evidence' is not null)),0) end,
 'without_entity_cents',coalesce(sum((snapshot->>'principal_cents')::bigint) filter(where legal_entity_id is null),0),
 'without_project_cents',coalesce(sum((snapshot->>'principal_cents')::bigint) filter(where legal_entity_id is not null and project_id is null),0),
 'unallocated_cents',coalesce(sum((snapshot->>'unallocated_cents')::bigint),0),
 'pending_objects',count(*) filter(where cardinality(pending)>0),
 'operational_count',count(target_id),
 'operational_principal_cents',coalesce((select sum(p.amount*100) from public.payables p join elos_import.financial_objects f on f.target_id=p.id where f.company_id=p_company and f.enterprise_id=p_enterprise),0),
 'confirmed_cash_cents',null,'financial_position_certified',false)
 from elos_import.financial_objects where company_id=p_company and enterprise_id=p_enterprise
$$;

create function elos_import.apply_financial_batch(p_company uuid,p_command uuid,p_batch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
<<batch_apply>>
declare
 prior elos_import.financial_batches; obj elos_import.financial_objects; title public.payables;
 r jsonb; a jsonb; pending text[]; run uuid; oid uuid; target uuid; entity uuid; project uuid; supplier uuid;
 ext text; inst text; enterprise text:=p_batch->>'enterprise_id';
 n bigint; paid bigint; allocated bigint; version bigint; before_position jsonb; after_position jsonb; report jsonb;
 complete boolean; problems jsonb:='[]'; accepted int:=0; unchanged int:=0; rejected int:=0; raw_count int; distinct_count int;
 extracted timestamptz; closed date; actual_hash text; expected bigint; promotion_allowed boolean; part_index int;
begin
 if auth.uid() is null or not coalesce(public.has_company_permission(p_company,'payables.manage'),false)
 then raise exception 'Sem permissão financeira.'; end if;
 if exists(select 1 from public.legal_entities where company_id=p_company and not public.finance_entity_scope(p_company,id,true)) then raise exception 'Importação organizacional exige escopo de todas as entidades.';end if;
 if p_command is null or nullif(btrim(enterprise),'') is null or jsonb_typeof(p_batch->'records') is distinct from 'array'
   or jsonb_typeof(p_batch->'pages') is distinct from 'array' or nullif(btrim(p_batch->>'reason'),'') is null
   or p_batch->>'currency' is distinct from 'BRL' or p_batch->>'monetary_basis' is distinct from 'principal'
   or p_batch->>'period_start' is null or p_batch->>'period_end' is null or p_batch->>'cutoff' is null
 then raise exception 'Manifesto financeiro incompleto.'; end if;
 if (p_batch->>'period_start')::date>(p_batch->>'period_end')::date then raise exception 'Período inválido.'; end if;
 if elos_import.map_get(p_company,null,'enterprise',enterprise) is distinct from p_company then raise exception 'Empresa de origem sem de-para organizacional confirmado.';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in('payables','payable_cost_allocations','integration_mappings','koper_staging_records') and not c.relrowsecurity)
 then raise exception 'RLS obrigatório antes da importação.';end if;
 extracted:=(p_batch->>'extracted_at')::timestamptz;
 if extracted is null then raise exception 'Extração ausente.'; end if;
 -- Serializa snapshots por organização/origem, inclusive comandos diferentes.
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||enterprise,0));
 actual_hash:=encode(sha256(convert_to(p_batch::text,'UTF8')),'hex');
 select * into prior from elos_import.financial_batches where company_id=p_company and command_id=p_command;
 if found then
   if prior.content_hash<>actual_hash then raise exception 'Comando reutilizado com conteúdo diferente.'; end if;
   return prior.report;
 end if;
 for a in select value from jsonb_array_elements(p_batch->'pages') loop
   if jsonb_typeof(a->'raw') is distinct from 'string' or nullif(a->>'sha256','') is null then raise exception 'Original e hash da página ausentes.';end if;
   if a->>'sha256' is distinct from encode(sha256(convert_to(a->>'raw','UTF8')),'hex') then raise exception 'Hash de página divergente.'; end if;
 end loop;
 select count(*),count(distinct jsonb_build_array(value->>'external_id',value->>'installment')) filter(where nullif(value->>'external_id','') is not null)
 into raw_count,distinct_count from jsonb_array_elements(p_batch->'records');
 expected:=nullif(p_batch->'manifest'->>'expected_count','')::bigint;
 complete:=coalesce((p_batch->'manifest'->>'complete')::boolean,false) and expected=distinct_count and raw_count=distinct_count;
 if expected is null then complete:=false; end if;
 if coalesce((p_batch->'manifest'->>'unique_count')::bigint,-1)<>distinct_count then complete:=false;end if;
 if exists(select 1 from jsonb_array_elements(p_batch->'pages') x group by x->'request_cursor' having count(*)>1) then complete:=false;end if;
 if jsonb_array_length(p_batch->'pages')=0 then complete:=false;end if;
 if exists(select 1 from jsonb_array_elements(p_batch->'pages') with ordinality x(p,i)
  where (i=1 and p->'request_cursor' is distinct from 'null'::jsonb)
   or (i=jsonb_array_length(p_batch->'pages') and p->'next_cursor' is distinct from 'null'::jsonb)
   or (i>1 and p->'request_cursor' is distinct from (p_batch->'pages'->((i-2)::int)->'next_cursor'))
   or (p->'next_cursor'<>'null'::jsonb and p->'next_cursor'=p->'request_cursor'))
 then complete:=false;end if;
 if exists(select 1 from jsonb_array_elements(p_batch->'records') x where not coalesce(x->>'principal_cents' ~ '^\d+$',false)) then complete:=false;
 else
  select sum((x->>'principal_cents')::numeric) into expected from jsonb_array_elements(p_batch->'records') x;
  if coalesce(expected,0) is distinct from (p_batch->'manifest'->>'subtotal_cents')::numeric
   or (p_batch->'manifest'->>'expected_total_cents' is not null and expected is distinct from (p_batch->'manifest'->>'expected_total_cents')::numeric)
  then complete:=false;end if;
 end if;
 before_position:=elos_import.financial_position(p_company,enterprise);
 insert into elos_import.runs(company_id,wave) values(p_company,'etapa6-koper-financeiro') returning id into run;
 insert into elos_import.financial_batches(run_id,company_id,command_id,enterprise_id,content_hash,content,created_by)
 values(run,p_company,p_command,enterprise,actual_hash,p_batch,auth.uid());
 for r in select value from jsonb_array_elements(p_batch->'records') loop
  begin
   ext:=nullif(btrim(r->>'external_id'),'');inst:=nullif(btrim(r->>'installment'),'');pending:='{}';target:=null;
   if ext is null or inst is null then raise exception 'missing_identity';end if;
   if not coalesce(r->>'principal_cents' ~ '^\d+$',false) or (r->>'principal_cents')::numeric>9007199254740991 then raise exception 'invalid_principal';end if;
   n:=(r->>'principal_cents')::bigint; paid:=(r->>'reported_paid_cents')::bigint;
   if paid<0 or paid>n then pending:=array_append(pending,'settlement_components_review');end if;
   entity:=nullif(r->>'legal_entity_id','')::uuid;project:=nullif(r->>'project_id','')::uuid;supplier:=nullif(r->>'supplier_id','')::uuid;
   if entity is null then pending:=array_append(pending,'without_entity');
   elsif not exists(select 1 from public.legal_entities where id=entity and company_id=p_company) then raise exception 'entity_cross_company';
   elsif not public.finance_entity_scope(p_company,entity,true) then raise exception 'entity_permission';end if;
   if project is null then pending:=array_append(pending,'without_project');
   elsif not exists(select 1 from public.projects where id=project and company_id=p_company and legal_entity_id=entity) then raise exception 'project_cross_company_or_entity';end if;
   if supplier is not null and not exists(select 1 from public.suppliers where id=supplier and company_id=p_company) then raise exception 'supplier_cross_company';end if;
   if nullif(btrim(r->>'obligation_evidence'),'') is null then pending:=array_append(pending,'obligation_not_proven');end if;
   if coalesce((r->>'is_grouping_parent')::boolean,false) or r->>'grouped_into_id' is not null then pending:=array_append(pending,'grouping_requires_value_links');end if;
   if r->>'source_status' not in('Pendente','Em atraso','Paga','Cancelada','Estornada') or r->>'source_status' is null then pending:=array_append(pending,'unsupported_status');end if;
   if r->>'due_date' is null then pending:=array_append(pending,'without_due_date');else perform (r->>'due_date')::date;end if;
   if r->>'effective_date' is null then pending:=array_append(pending,'without_effective_date');else perform (r->>'effective_date')::date;end if;
   -- Check every explicit allocation; never normalize known rows to 100%.
   allocated:=0;
   for a in select value from jsonb_array_elements(coalesce(r->'allocations','[]')) loop
    if not coalesce(a->>'amount_cents' ~ '^\d+$',false) then raise exception 'invalid_allocation';end if;
    if not exists(select 1 from public.projects where id=(a->>'project_id')::uuid and company_id=p_company and legal_entity_id=entity) then raise exception 'allocation_cross_company_or_entity';end if;
    if a->>'service_id' is null then pending:=array_append(pending,'without_service');
    elsif not exists(select 1 from public.engineering_services where id=(a->>'service_id')::uuid and company_id=p_company) then raise exception 'allocation_service_cross_company';end if;
    if (a->>'project_id')::uuid is distinct from project then pending:=array_append(pending,'multi_project_requires_ledger');end if;
    allocated:=allocated+(a->>'amount_cents')::bigint;
   end loop;
   if allocated>n then raise exception 'overallocated';end if;
   r:=r||jsonb_build_object('unallocated_cents',n-allocated+coalesce((select sum((x->>'amount_cents')::bigint) from jsonb_array_elements(coalesce(r->'allocations','[]')) x where x->>'service_id' is null),0));
   select * into obj from elos_import.financial_objects where company_id=p_company and enterprise_id=enterprise and external_id=ext and installment=inst for update;
   if obj.id is null and project is not null and elos_import.map_get(p_company,project,'bill_to_pay',jsonb_build_array(enterprise,'AP',ext,inst)::text) is not null then raise exception 'identity_normalization_collision';end if;
   if obj.id is not null and extracted<obj.extracted_at then raise exception 'stale_snapshot';end if;
   if obj.id is not null and r=obj.snapshot then
    update public.koper_staging_records s set last_seen_at=clock_timestamp() where s.company_id=p_company and s.entity='finance.ap.snapshot' and s.koper_id=jsonb_build_array(enterprise,ext,inst)::text;
    unchanged:=unchanged+1;continue;end if;
   if obj.id is not null and extracted=obj.extracted_at then raise exception 'conflicting_snapshot_same_time';end if;
   if obj.id is not null and (obj.project_id is distinct from project or obj.legal_entity_id is distinct from entity) then pending:=array_append(pending,'scope_change_review');end if;
   target:=coalesce(obj.target_id,nullif(r->>'target_id','')::uuid);
   if obj.target_id is not null and r->>'target_id' is not null and obj.target_id<>(r->>'target_id')::uuid then raise exception 'target_rebinding_forbidden';end if;
   -- Legacy linkage requires explicit, confirmed target and evidence, never name/amount.
   if obj.id is null and target is null and project is not null and elos_import.map_get(p_company,project,'bill_to_pay',ext) is not null then pending:=array_append(pending,'legacy_mapping_requires_binding');end if;
   if target is not null then
    select * into title from public.payables where id=target and company_id=p_company for update;
    if title.id is null or title.project_id is distinct from project then raise exception 'target_cross_company_or_project';end if;
    if obj.id is null and nullif(btrim(r->>'binding_evidence'),'') is null then raise exception 'binding_evidence_required';end if;
    if coalesce(title.paid_amount,0)<>0 or title.status='paid' then pending:=array_append(pending,'local_settlement_preserved');end if;
    if exists(select 1 from public.payable_cost_allocations where payable_id=target and source_system is distinct from 'koper_finance') then pending:=array_append(pending,'local_allocation_preserved');end if;
    if title.bank_transaction_id is not null or exists(select 1 from public.finance_bank_transactions where payable_id=target) then pending:=array_append(pending,'local_bank_events_preserved');end if;
    if obj.id is not null and obj.applied_snapshot is not null and
     (title.amount*100 is distinct from (obj.applied_snapshot->>'principal_cents')::numeric or title.due_date is distinct from (obj.applied_snapshot->>'due_date')::date)
    then pending:=array_append(pending,'local_edit_conflict');end if;
   end if;
   select max(closed_through) into closed from public.finance_bank_accounts where company_id=p_company and legal_entity_id=entity;
   if closed is not null and (r->>'effective_date')::date<=closed then pending:=array_append(pending,'closed_period');end if;
   if paid is null then pending:=array_append(pending,'unknown_settlement');
   elsif paid<>0 or r->>'source_status'='Paga' then pending:=array_append(pending,'declared_settlement_requires_ledger');end if;
   if r->>'source_status'='Estornada' then pending:=array_append(pending,'reversal_requires_original_and_ledger');end if;
   if r->>'source_status'='Cancelada' and (coalesce((r->>'obligation_extinguished')::boolean,false)=false or nullif(btrim(r->>'cancellation_evidence'),'') is null or coalesce(paid,0)<>0)
   then pending:=array_append(pending,'cancellation_requires_obligation_evidence');end if;
   if obj.id is not null and nullif(btrim(r->>'change_evidence'),'') is null and obj.snapshot is distinct from r then pending:=array_append(pending,'change_requires_evidence');end if;
   perform set_config('finance.reason',p_batch->>'reason',true);
   perform set_config('finance.effective_date',coalesce(r->>'effective_date',''),true);
   promotion_allowed:=pending<@array['without_service']::text[];
   if promotion_allowed then
    if target is null then
     insert into public.payables(company_id,project_id,supplier_id,document,due_date,amount,status,source_system,source_id,created_by)
     values(p_company,project,supplier,r->>'document',(r->>'due_date')::date,n::numeric/100,
       case when r->>'source_status'='Cancelada' then 'cancelled' else 'open' end,'koper_finance',jsonb_build_array(enterprise,'AP',ext,inst)::text,auth.uid()) returning id into target;
    else
     if title.status='paid' then pending:=array_append(pending,'local_settlement_preserved');
     else update public.payables set amount=n::numeric/100,due_date=(r->>'due_date')::date,supplier_id=coalesce(supplier,title.supplier_id),
       status=case when r->>'source_status'='Cancelada' then 'cancelled' else 'open' end,updated_at=clock_timestamp() where id=target;end if;
    end if;
   end if;
   if promotion_allowed and not ('local_settlement_preserved'=any(pending)) then
    -- Current projection only. Every previous monetary allocation remains in the
    -- immutable financial_revisions snapshot. Never delete native/manual rows.
    delete from public.payable_cost_allocations where payable_id=target and source_system='koper_finance';
    part_index:=0;
    for a in select value from jsonb_array_elements(coalesce(r->'allocations','[]')||
      case when allocated<n then jsonb_build_array(jsonb_build_object('amount_cents',n-allocated,'project_id',project,'service_id',null)) else '[]'::jsonb end)
    loop
     part_index:=part_index+1;
     if (a->>'amount_cents')::bigint=0 then continue;end if;
     insert into public.payable_cost_allocations(company_id,project_id,payable_id,service_id,wbs_code_snapshot,service_name_snapshot,
      allocation_amount,allocation_percent,resolution_method,source_system,source_id,evidence,created_by)
     values(p_company,project,target,(a->>'service_id')::uuid,
      case when a->>'service_id' is null then 'SEM-CC' else a->>'code' end,
      case when a->>'service_id' is null then 'A Apropriar' else a->>'name' end,
      (a->>'amount_cents')::numeric/100,least(100,greatest(0.0001,round((a->>'amount_cents')::numeric*100/nullif(n,0),4))),
      case when a->>'service_id' is null then 'import_other' else 'origin_title_allocation' end,
      'koper_finance',target::text||':'||part_index,jsonb_build_object('run_id',run,'external_id',ext,'document_id',r->>'document_id'),auth.uid());
    end loop;
   end if;
   version:=coalesce(obj.version,0)+1;oid:=coalesce(obj.id,gen_random_uuid());
   insert into elos_import.financial_objects(id,company_id,enterprise_id,external_id,installment,project_id,legal_entity_id,target_id,snapshot,applied_snapshot,version,extracted_at,run_id,pending,created_by)
   values(oid,p_company,enterprise,ext,inst,project,entity,target,r,case when promotion_allowed and not ('local_settlement_preserved'=any(pending)) then r else null end,version,extracted,run,pending,auth.uid())
   on conflict(id) do update set snapshot=excluded.snapshot,applied_snapshot=coalesce(excluded.applied_snapshot,financial_objects.applied_snapshot),
    version=excluded.version,extracted_at=excluded.extracted_at,run_id=excluded.run_id,pending=excluded.pending,target_id=excluded.target_id,updated_at=clock_timestamp();
   insert into elos_import.financial_revisions(company_id,project_id,object_id,version,run_id,previous_value,new_value,reason,created_by)
   values(p_company,coalesce(obj.project_id,project),oid,version,run,obj.snapshot,r,p_batch->>'reason',auth.uid());
   insert into public.koper_staging_records(company_id,entity,koper_id,payload,payload_hash,mapping_version,processing_status,processing_error,elos_id,created_by)
   values(p_company,'finance.ap.snapshot',jsonb_build_array(enterprise,ext,inst)::text,
    jsonb_build_object('enterprise_id',enterprise,'data',r,'run_id',run),encode(sha256(convert_to(r::text,'UTF8')),'hex'),2,
    case when cardinality(pending)=0 then 'processed' else 'pending' end,array_to_string(pending,','),target,auth.uid())
   on conflict on constraint koper_staging_records_company_id_source_entity_koper_id_key do update set payload=excluded.payload,payload_hash=excluded.payload_hash,
    processing_status=excluded.processing_status,processing_error=excluded.processing_error,elos_id=excluded.elos_id,last_seen_at=clock_timestamp(),updated_at=clock_timestamp();
   if cardinality(pending)=0 then
    perform elos_import.map_put(p_company,project,'bill_to_pay',jsonb_build_array(enterprise,'AP',ext,inst)::text,'payable',target,'imported',null,null,jsonb_build_object('run_id',run,'document_id',r->>'document_id'));
    accepted:=accepted+1;
   else
    perform elos_import.issue(run,p_company,project,'bill_to_pay',jsonb_build_array(enterprise,'AP',ext,inst)::text,'financial_review',jsonb_build_object('pending',pending,'principal_cents',n));
   end if;
  exception when others then
   rejected:=rejected+1;
   problems:=problems||jsonb_build_array(jsonb_build_object('external_id',ext,'installment',inst,'sqlstate',sqlstate,'reason',case when sqlstate='P0001' then sqlerrm else 'invalid_record_or_constraint' end,'principal_cents',r->'principal_cents'));
   perform elos_import.issue(run,p_company,null,'bill_to_pay',coalesce(ext,'row:'||rejected::text),'rejected_record',jsonb_build_object('sqlstate',sqlstate));
  end;
 end loop;
 after_position:=elos_import.financial_position(p_company,enterprise);
 report:=jsonb_build_object('run_id',run,'complete',coalesce(complete,false) and rejected=0,'accepted',accepted,'unchanged',unchanged,'rejected',rejected,'errors',problems,
  'source_manifest',p_batch->'manifest','period_start',p_batch->>'period_start','period_end',p_batch->>'period_end','cutoff',p_batch->>'cutoff',
  'before',before_position,'after',after_position,'pending_rows', (select count(*) from elos_import.financial_objects f where f.company_id=p_company and f.enterprise_id=enterprise and cardinality(f.pending)>0));
 report:=report||jsonb_build_object('reconciliation',jsonb_build_object(
  'source_count',distinct_count,'source_subtotal_cents',p_batch->'manifest'->'subtotal_cents',
  'rows',(select coalesce(jsonb_agg(jsonb_build_object(
    'external_id',x.r->>'external_id','installment',x.r->>'installment','source_principal_cents',x.r->'principal_cents',
    'object_id',f.id,'target_id',f.target_id,'destination_principal_cents',p.amount*100,'destination_status',p.status,'destination_paid_cents',p.paid_amount*100,'source_status',x.r->>'source_status','declared_paid_cents',x.r->'reported_paid_cents',
    'pending',f.pending,'delta_cents',case when p.id is not null then case when x.r->>'principal_cents' ~ '^\d+$' then (x.r->>'principal_cents')::numeric-p.amount*100 else null end else null end
   ) order by x.ord),'[]') from jsonb_array_elements(p_batch->'records') with ordinality x(r,ord)
   left join elos_import.financial_objects f on f.company_id=p_company and f.enterprise_id=enterprise and f.external_id=x.r->>'external_id' and f.installment=x.r->>'installment'
   left join public.payables p on p.id=f.target_id),
  'absent_in_snapshot',(select coalesce(jsonb_agg(jsonb_build_object('external_id',f.external_id,'installment',f.installment,'action','preserved')),'[]')
   from elos_import.financial_objects f where f.company_id=p_company and f.enterprise_id=enterprise and not exists(
    select 1 from jsonb_array_elements(p_batch->'records') x where x->>'external_id'=f.external_id and x->>'installment'=f.installment))));
 report:=report||jsonb_build_object('extraction_complete',coalesce(complete,false),'complete',coalesce(complete,false) and rejected=0 and (report->>'pending_rows')::int=0);
 report:=report||jsonb_build_object('last_complete_run_id',case when (report->>'complete')::boolean then run else
  (select b.run_id from elos_import.financial_batches b where b.company_id=p_company and b.enterprise_id=enterprise and (b.report->>'complete')::boolean order by b.created_at desc limit 1) end);
 update elos_import.financial_batches b set report=batch_apply.report where b.run_id=run;
 update elos_import.runs set status=case when (report->>'complete')::boolean then 'done' else 'failed' end,summary=report,finished_at=clock_timestamp() where id=run;
 return report;
end $$;
revoke all on function elos_import.apply_financial_batch(uuid,uuid,jsonb),elos_import.financial_position(uuid,text) from public,anon,authenticated;
-- No public REST endpoint. Delegated actor + payables.manage + entity ACL required.
grant usage on schema elos_import to service_role;
grant execute on function elos_import.apply_financial_batch(uuid,uuid,jsonb) to service_role;
revoke all on function elos_import.seal_financial_batch() from public,anon,authenticated;
commit;
