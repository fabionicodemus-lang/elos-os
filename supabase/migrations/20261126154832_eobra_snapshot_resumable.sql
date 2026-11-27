-- Resumable, bounded processing of large immutable snapshots. Each RPC performs
-- one short transaction. Previously promoted chunks survive a later failure.
begin;
-- Native finance readers use the minimized, permission-checked history RPC.
-- Full source-event details retain the migration's complete native permissions.
drop policy if exists eobra_source_settlement_read on public.eobra_source_events;
alter table public.eobra_migration_runs drop constraint eobra_migration_runs_status_check;
alter table public.eobra_migration_runs add constraint eobra_migration_runs_status_check check(status in('building','review','ready','promoting','imported','cancelled'));
alter table public.eobra_migration_runs add column stage_phase text not null default 'loading' check(stage_phase in('loading','validating','sealed')),
  add column expected_records integer not null default 0 check(expected_records between 0 and 100000),
  add column promotion_started_by uuid references auth.users(id),add column promotion_started_at timestamptz;
alter table public.eobra_migration_records add column validated boolean not null default false,add column promoted boolean not null default false;
create index eobra_migration_records_work_idx on public.eobra_migration_records(run_id,validated,promoted,source_ordinal);
-- Preserve any snapshot created by the earlier small-package implementation.
alter table public.eobra_migration_runs disable trigger eobra_snapshot_run_guard;
alter table public.eobra_migration_records disable trigger eobra_snapshot_record_guard;
update public.eobra_migration_runs b set expected_records=jsonb_array_length(s.document->'records'),stage_phase=case when b.status='building' then 'loading' else 'sealed' end from public.eobra_migration_snapshots s where s.run_id=b.id;
update public.eobra_migration_records r set validated=b.status<>'building',promoted=b.status='imported' from public.eobra_migration_runs b where b.id=r.run_id;
alter table public.eobra_migration_runs enable trigger eobra_snapshot_run_guard;
alter table public.eobra_migration_records enable trigger eobra_snapshot_record_guard;

create or replace function public.eobra_snapshot_progress(p_run_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;loaded integer;checked integer;done integer;next_action text;begin
  select * into b from public.eobra_migration_runs where id=p_run_id;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.' using errcode='42501';end if;
  select count(*),count(*) filter(where validated),count(*) filter(where promoted) into loaded,checked,done from public.eobra_migration_records where run_id=b.id;
  next_action:=case when b.status='imported' then 'complete' when b.status in('review','cancelled') then 'blocked' when b.status in('ready','promoting') then 'promote'
    when b.stage_phase='loading' and loaded<b.expected_records then 'append' when b.stage_phase='loading' then 'finish_append' when b.stage_phase='validating' and checked<b.expected_records then 'validate' else 'seal' end;
  return jsonb_build_object('run_id',b.id,'status',b.status,'stage',b.stage_phase,'expected_records',b.expected_records,'loaded_records',loaded,'validated_records',checked,'promoted_records',done,'remaining_records',b.expected_records-done,'next_step',next_action,'preview_hash',b.preview_hash,'summary',b.summary,'promotion_result',b.promotion_result);
end; $$;

create or replace function public.append_eobra_snapshot(p_run_id uuid,p_limit integer default 250)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;doc jsonb;source_records jsonb;wanted integer[];begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'Acrescente entre 1 e 500 registros por chamada.';end if;
  select * into b from public.eobra_migration_runs where id=p_run_id for update;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.';end if;
  if b.status<>'building' or b.stage_phase<>'loading' then return public.eobra_snapshot_progress(b.id);end if;
  select document into doc from public.eobra_migration_snapshots where run_id=b.id;
  source_records:=doc->'records';
  select array_agg(ord) into wanted from(select ord from generate_series(1,b.expected_records) ord where not exists(select 1 from public.eobra_migration_records rec where rec.run_id=b.id and rec.source_ordinal=ord) order by ord limit p_limit) missing;
  if wanted is null then return public.eobra_snapshot_progress(b.id);end if;
  insert into public.eobra_migration_records(run_id,company_id,project_id,source_ordinal,entity,source_id,source_project_id,archive_type,parent_source_id,links,raw_data,normalized_data,source_errors,record_hash)
  select b.id,b.company_id,public.eobra_import_uuid(b.project_map->>(case when v->>'entity'='project' then v->>'sourceId' else v->>'sourceProjectId' end)),ord,
    v->>'entity',v->>'sourceId',nullif(v->>'sourceProjectId',''),coalesce(v->>'archiveType',''),nullif(v->>'parentSourceId',''),coalesce(v->'links','[]'),v->'raw',v->'normalized',coalesce(v->'errors','[]'),'pending'
    from unnest(wanted) ord cross join lateral(select source_records->(ord-1) v) source order by ord;
  insert into public.eobra_migration_relations(run_id,record_id,company_id,project_id,ordinal,target_entity,target_source_id,target_archive_type,role,source_relation_id,is_primary,allocated_amount,ownership_percent,attributes)
  select b.id,rec.id,b.company_id,rec.project_id,ord::int,v->>'entity',v->>'sourceId',coalesce(v->>'archiveType',''),v->>'role',nullif(v->>'source_relation_id',''),
    case when v->'primary'='true'::jsonb then true when v->'primary'='false'::jsonb then false end,public.eobra_import_money(v->>'allocated_amount'),case when v->>'ownership_percent' ~ '^[0-9]{1,3}(\.[0-9]{1,4})?$' then (v->>'ownership_percent')::numeric end,v
    from public.eobra_migration_records rec cross join lateral jsonb_array_elements(rec.links) with ordinality source(v,ord) where rec.run_id=b.id and rec.source_ordinal=any(wanted);
  return public.eobra_snapshot_progress(b.id);
end; $$;

create or replace function public.finish_eobra_snapshot_append(p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;doc jsonb;begin
  select * into b from public.eobra_migration_runs where id=p_run_id for update;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.';end if;
  if b.status<>'building' or b.stage_phase<>'loading' then return public.eobra_snapshot_progress(b.id);end if;
  if (select count(*) from public.eobra_migration_records where run_id=b.id)<>b.expected_records then raise exception 'Conclua a carga de todos os registros antes de conferir.';end if;
  select document into doc from public.eobra_migration_snapshots where run_id=b.id;
  insert into public.eobra_migration_coverage(run_id,company_id,project_id,entity,source_project_id,archive_type,declared,expected_count)
    select b.id,b.company_id,public.eobra_import_uuid(b.project_map->>(v->>'sourceProjectId')),v->>'entity',nullif(v->>'sourceProjectId',''),coalesce(v->>'archiveType',''),v,
      case when v->>'expectedCount' ~ '^[0-9]{1,6}$' then (v->>'expectedCount')::int end from jsonb_array_elements(doc->'coverage') v;
  update public.eobra_migration_runs set stage_phase='validating' where id=b.id;
  return public.eobra_snapshot_progress(b.id);
end; $$;

create or replace function public.validate_eobra_snapshot_chunk(p_run_id uuid,p_limit integer default 100)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Confira entre 1 e 100 registros por chamada.';end if;
  select * into b from public.eobra_migration_runs where id=p_run_id for update;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.';end if;
  if b.status<>'building' or b.stage_phase<>'validating' then return public.eobra_snapshot_progress(b.id);end if;
  update public.eobra_migration_records set validated=true where id in(select id from public.eobra_migration_records where run_id=b.id and not validated order by source_ordinal limit p_limit);
  return public.eobra_snapshot_progress(b.id);
end; $$;

create or replace function public.seal_eobra_snapshot(p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;v_summary jsonb;begin
  select * into b from public.eobra_migration_runs where id=p_run_id for update;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.';end if;
  if b.status<>'building' then return public.review_eobra_snapshot(b.id);end if;
  if b.stage_phase<>'validating' or (select count(*) from public.eobra_migration_records where run_id=b.id and validated)<>b.expected_records then raise exception 'Ainda existem registros não conferidos.';end if;
  update public.eobra_migration_coverage set verified=true where run_id=b.id;
  v_summary:=public.eobra_snapshot_summary(b.id);
  update public.eobra_migration_runs set stage_phase='sealed',status=case when v_summary->'coverage_complete'='true'::jsonb and (v_summary->>'blocked')::int+(v_summary->>'conflicts')::int=0 then 'ready' else 'review' end where id=b.id;
  return public.review_eobra_snapshot(b.id);
end; $$;

-- Set-based membership check: the source JSON is expanded once, not once per
-- record. No business validator is called by this function.
create or replace function public.eobra_snapshot_assert_source(p_run_id uuid)
returns void language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;doc jsonb;begin
  select * into b from public.eobra_migration_runs where id=p_run_id;
  select document into doc from public.eobra_migration_snapshots where run_id=b.id;
  if b.id is null or doc is null or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) or not public.eobra_snapshot_projects_visible(b.company_id,b.project_map) then raise exception 'Snapshot indisponível ou sem permissões.';end if;
  if b.expected_records<>jsonb_array_length(doc->'records') or (select count(*) from public.eobra_migration_records where run_id=b.id)<>b.expected_records
    or (select count(*) from public.eobra_migration_coverage where run_id=b.id)<>jsonb_array_length(doc->'coverage') then raise exception 'Evidência ainda incompleta.';end if;
  if exists(select 1 from jsonb_array_elements(doc->'records') with ordinality source(v,ord) left join public.eobra_migration_records rec on rec.run_id=b.id and rec.source_ordinal=source.ord
    where rec.id is null or rec.record_hash is distinct from public.eobra_snapshot_record_hash(v->>'entity',v->>'sourceId',nullif(v->>'sourceProjectId',''),coalesce(v->>'archiveType',''),nullif(v->>'parentSourceId',''),v->'raw',v->'normalized',coalesce(v->'links','[]'))
      or rec.source_errors is distinct from coalesce(v->'errors','[]'::jsonb)) then raise exception 'Registro diverge do documento imutável de origem.';end if;
  if exists(select 1 from public.eobra_migration_records rec left join lateral(select count(*) n from public.eobra_migration_relations where record_id=rec.id) rel on true where rec.run_id=b.id and rel.n<>jsonb_array_length(rec.links)) then raise exception 'Relações capturadas incompletas.';end if;
  if exists(select 1 from jsonb_array_elements(doc->'coverage') source(v) where not exists(select 1 from public.eobra_migration_coverage cov where cov.run_id=b.id and cov.declared=source.v and cov.entity=source.v->>'entity' and cov.source_project_id is not distinct from nullif(source.v->>'sourceProjectId','') and cov.archive_type=coalesce(source.v->>'archiveType',''))) then raise exception 'Cobertura diverge do manifesto imutável.';end if;
end; $$;

-- A bounded validator returns derived state. Caller-provided flags, errors and
-- target IDs are ignored by the record UPDATE guard.
create or replace function public.eobra_snapshot_record_review(p_record_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;l public.eobra_migration_ledger%rowtype;issues jsonb;targets jsonb;state text;warnings jsonb:='[]';begin
  select * into r from public.eobra_migration_records where id=p_record_id;
  select * into b from public.eobra_migration_runs where id=r.run_id;
  issues:=public.eobra_snapshot_record_errors(r.id);targets:=public.eobra_snapshot_expected_targets(r.id);state:=case when jsonb_array_length(issues)>0 then 'blocked' else 'ready' end;
  select * into l from public.eobra_migration_ledger where company_id=b.company_id and source_host=b.source_host and entity=r.entity and archive_type=r.archive_type and source_id=r.source_id;
  if found then
    if l.record_hash<>r.record_hash then state:='conflict';issues:=issues||jsonb_build_array('Identidade já importada com conteúdo diferente; nenhum registro será sobrescrito.');
    elsif jsonb_array_length(issues)=0 then state:='duplicate';end if;
  elsif jsonb_array_length(issues)=0 and (r.entity='project' and r.project_id is null or r.entity in('raw_archive','bank_account','bank_transaction','correction_index','index_value','settlement') or r.entity='sale' and r.normalized_data->>'status'='draft' or r.entity='person' and not(r.normalized_data->'roles' ?| array['client','supplier'])) then state:='archived';end if;
  if targets<>'{}'::jsonb and r.entity='person' then warnings:=warnings||jsonb_build_array('CPF/CNPJ corresponde a cadastro existente; o vínculo será reutilizado sem alterar os dados atuais.');end if;
  if r.entity in('receivable','payable') and r.normalized_data->'correction'->>'mode' is null then warnings:=warnings||jsonb_build_array('Política histórica não informada; valores preservados e correção futura travada.');end if;
  if r.entity='settlement' and r.normalized_data->>'kind'='voided_payment' then warnings:=warnings||jsonb_build_array('Baixa anulada sem data válida do estorno: valor sem efeito e linha do tempo histórica incompleta.');end if;
  return jsonb_build_object('status',state,'errors',issues,'warnings',warnings,'expected_targets',targets);
end; $$;

create or replace function public.eobra_snapshot_guard_record()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;review jsonb;begin
  select * into b from public.eobra_migration_runs where id=new.run_id for update;
  if not found or b.company_id<>new.company_id or b.status in('cancelled','imported') then raise exception 'Registro fora de um snapshot disponível.';end if;
  if not public.eobra_snapshot_permissions(new.entity,new.normalized_data)<@b.required_permissions or not public.eobra_snapshot_authorized(new.company_id,public.eobra_snapshot_permissions(new.entity,new.normalized_data)) then raise exception 'Permissão nativa da entidade ausente.';end if;
  if new.project_id is not null and not exists(select 1 from public.projects where id=new.project_id and company_id=new.company_id) then raise exception 'Obra fora da empresa.';end if;
  if tg_op='INSERT' then
    if b.status<>'building' or b.stage_phase<>'loading' then raise exception 'Carga de origem já encerrada.';end if;
    new.record_hash:=public.eobra_snapshot_record_hash(new.entity,new.source_id,new.source_project_id,new.archive_type,new.parent_source_id,new.raw_data,new.normalized_data,new.links);
    if new.project_id is distinct from public.eobra_import_uuid(b.project_map->>(case when new.entity='project' then new.source_id else new.source_project_id end)) then raise exception 'Obra diverge do de-para declarado.';end if;
    new.status:='ready';new.review_status:='ready';new.errors:='[]';new.warnings:='[]';new.expected_targets:='{}';new.canonical_targets:='{}';new.validated:=false;new.promoted:=false;
    new.created_by:=auth.uid();new.created_at:=now();
  elsif b.status='building' then
    if b.stage_phase<>'validating' then raise exception 'Conclua a carga antes de validar registros.';end if;
    if (to_jsonb(new)-array['status','review_status','errors','warnings','expected_targets','validated','updated_at']) is distinct from (to_jsonb(old)-array['status','review_status','errors','warnings','expected_targets','validated','updated_at']) then raise exception 'Dados de origem são imutáveis.';end if;
    if old.validated then raise exception 'Registro já conferido; prepare uma nova revisão.';end if;
    review:=public.eobra_snapshot_record_review(new.id);
    new.errors:=review->'errors';new.warnings:=review->'warnings';new.expected_targets:=review->'expected_targets';new.status:=review->>'status';new.review_status:=new.status;new.validated:=true;
  else
    if (to_jsonb(new)-array['status','canonical_targets','promoted','updated_at']) is distinct from (to_jsonb(old)-array['status','canonical_targets','promoted','updated_at']) then raise exception 'Dados revisados são imutáveis.';end if;
    if old.promoted or b.status<>'promoting' or not new.promoted or new.status is distinct from (case new.review_status when 'duplicate' then 'duplicate' when 'archived' then 'archived' when 'ready' then 'imported' end)
      or not exists(select 1 from public.eobra_migration_ledger l where l.company_id=new.company_id and l.source_host=b.source_host and l.entity=new.entity and l.archive_type=new.archive_type and l.source_id=new.source_id and l.record_hash=new.record_hash and l.targets=new.canonical_targets) then raise exception 'Resultado sem identidade registrada no ledger.';end if;
  end if;
  if exists(select 1 from jsonb_array_elements(new.errors||new.warnings||new.source_errors) x where jsonb_typeof(x)<>'string') then raise exception 'Erros e avisos devem conter somente texto.';end if;
  new.updated_at:=now();return new;
end; $$;

create or replace function public.eobra_snapshot_coverage_errors(p_coverage_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare c public.eobra_migration_coverage%rowtype;d jsonb;e jsonb:='[]';n integer;expected integer;begin
  select * into c from public.eobra_migration_coverage where id=p_coverage_id;d:=c.declared;
  select count(*) into n from public.eobra_migration_records where run_id=c.run_id and entity=c.entity and source_project_id is not distinct from c.source_project_id and archive_type=c.archive_type;
  if jsonb_typeof(d->'expectedCount') is distinct from 'number' or coalesce(d->>'expectedCount','') !~ '^[0-9]{1,6}$' then e:=e||jsonb_build_array('Contagem esperada não verificada.');
  elsif (d->>'expectedCount')::int<>n then e:=e||jsonb_build_array('Quantidade capturada diverge da contagem da origem.');end if;
  if d ? 'collectedCount' and (jsonb_typeof(d->'collectedCount')<>'number' or d->>'collectedCount' is distinct from n::text) then e:=e||jsonb_build_array('Contagem de coleta diverge dos registros.');end if;
  if jsonb_typeof(d->'expectedPages') is distinct from 'number' or coalesce(d->>'expectedPages','') !~ '^[0-9]{1,6}$' or jsonb_typeof(d->'collectedPages') is distinct from 'array' then e:=e||jsonb_build_array('Paginação da coleta não verificada.');
  else
    expected:=(d->>'expectedPages')::int;
    if jsonb_array_length(d->'collectedPages')<>expected or n>0 and expected=0 or (select count(distinct value) from jsonb_array_elements(d->'collectedPages'))<>expected
      or exists(select 1 from jsonb_array_elements(d->'collectedPages') v where case when v::text ~ '^[1-9][0-9]{0,5}$' then (v::text)::int>expected else true end) then e:=e||jsonb_build_array('Páginas ausentes, repetidas ou fora do intervalo.');end if;
  end if;
  if jsonb_typeof(d->'detailsExpected') is distinct from 'number' or coalesce(d->>'detailsExpected','') !~ '^[0-9]{1,6}$' or jsonb_typeof(d->'detailsCollected') is distinct from 'array' then e:=e||jsonb_build_array('Cobertura de detalhes não verificada.');
  else
    expected:=(d->>'detailsExpected')::int;
    if expected<>jsonb_array_length(d->'detailsCollected') or (select count(distinct value) from jsonb_array_elements(d->'detailsCollected'))<>expected
      or exists(select 1 from jsonb_array_elements(d->'detailsCollected') detail(v) where jsonb_typeof(detail.v)<>'string' or not exists(select 1 from public.eobra_migration_records rec where rec.run_id=c.run_id and rec.entity=c.entity and rec.source_project_id is not distinct from c.source_project_id and rec.archive_type=c.archive_type and rec.source_id=detail.v#>>'{}')) then e:=e||jsonb_build_array('Detalhes ausentes, repetidos ou sem registro correspondente.');end if;
  end if;
  if d->'complete' is distinct from 'true'::jsonb then e:=e||jsonb_build_array('A origem ainda não declarou esta coleta concluída.');end if;
  if jsonb_typeof(d->'filters') is distinct from 'object' then e:=e||jsonb_build_array('Filtros aplicados na captura não informados.');end if;
  return e;
end; $$;

create or replace function public.eobra_snapshot_guard_coverage()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;issues jsonb;begin
  select * into b from public.eobra_migration_runs where id=new.run_id for update;
  if not found or b.status<>'building' or b.company_id<>new.company_id then raise exception 'Cobertura selada é imutável.';end if;
  if new.declared->>'entity' is distinct from new.entity or nullif(new.declared->>'sourceProjectId','') is distinct from new.source_project_id or coalesce(new.declared->>'archiveType','') is distinct from new.archive_type
    or new.project_id is distinct from public.eobra_import_uuid(b.project_map->>new.source_project_id)
    or new.expected_count is distinct from (case when new.declared->>'expectedCount' ~ '^[0-9]{1,6}$' then (new.declared->>'expectedCount')::int end) then raise exception 'Escopo ou contagem da cobertura diverge da origem.';end if;
  if tg_op='INSERT' then
    if b.stage_phase<>'loading' then raise exception 'Manifesto de carga encerrado.';end if;
    new.created_by:=auth.uid();new.created_at:=now();new.actual_count:=0;new.verified:=false;new.errors:='[]';
  else
    if b.stage_phase<>'validating' or (to_jsonb(new)-array['actual_count','verified','errors','updated_at']) is distinct from (to_jsonb(old)-array['actual_count','verified','errors','updated_at']) then raise exception 'Manifesto de cobertura é imutável.';end if;
    issues:=public.eobra_snapshot_coverage_errors(new.id);new.errors:=issues;new.verified:=jsonb_array_length(issues)=0;
    select count(*) into new.actual_count from public.eobra_migration_records where run_id=b.id and entity=new.entity and source_project_id is not distinct from new.source_project_id and archive_type=new.archive_type;
  end if;
  new.updated_at:=now();return new;
end; $$;

create or replace function public.eobra_snapshot_guard_run()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare s jsonb;begin
  if not public.eobra_snapshot_authorized(new.company_id,new.required_permissions) or not public.eobra_snapshot_projects_visible(new.company_id,new.project_map) then raise exception 'Permissões de empresa, obras e módulos são obrigatórias.';end if;
  if tg_op='INSERT' then
    if new.status<>'building' or new.stage_phase<>'loading' or new.promotion_result is not null or new.project_id is not null or new.expected_records<1 then raise exception 'Snapshot deve iniciar em carga, com contagem explícita.';end if;
    new.created_by:=auth.uid();new.created_at:=now();new.summary:='{}';new.preview_hash:=null;new.promotion_started_by:=null;new.promotion_started_at:=null;
  else
    if old.status in('imported','cancelled') then raise exception 'Snapshot encerrado é imutável.';end if;
    if (to_jsonb(new)-array['status','stage_phase','summary','preview_hash','promotion_result','promoted_by','promoted_at','promotion_started_by','promotion_started_at','cancelled_by','cancelled_at','updated_at']) is distinct from (to_jsonb(old)-array['status','stage_phase','summary','preview_hash','promotion_result','promoted_by','promoted_at','promotion_started_by','promotion_started_at','cancelled_by','cancelled_at','updated_at']) then raise exception 'A origem e o de-para revisados são imutáveis.';end if;
    if new.status='cancelled' then
      if exists(select 1 from public.eobra_migration_records where run_id=new.id and promoted) or exists(select 1 from public.eobra_migration_ledger where run_id=new.id) then raise exception 'Migração parcialmente promovida não pode ser cancelada; retome a execução ou prepare nova revisão.';end if;
      new.summary:=old.summary;new.preview_hash:=old.preview_hash;new.stage_phase:=old.stage_phase;new.cancelled_by:=auth.uid();new.cancelled_at:=now();
    elsif old.status='building' and old.stage_phase='loading' and new.status='building' and new.stage_phase='validating' then
      perform public.eobra_snapshot_assert_source(new.id);new.summary:=old.summary;new.preview_hash:=null;
    elsif old.status='building' and old.stage_phase='validating' and new.status in('review','ready') and new.stage_phase='sealed' then
      if (select count(*) from public.eobra_migration_records where run_id=new.id and validated)<>new.expected_records then raise exception 'Ainda existem registros não conferidos.';end if;
      s:=public.eobra_snapshot_summary(new.id);new.summary:=s;new.preview_hash:=public.eobra_snapshot_preview_hash(new.id);
      if new.status='ready' and (s->'coverage_complete' is distinct from 'true'::jsonb or (s->>'blocked')::int+(s->>'conflicts')::int>0) then raise exception 'Cobertura ou registros possuem pendências.';end if;
    elsif old.status='ready' and new.status='promoting' and new.stage_phase='sealed' then
      if old.preview_hash is null or old.preview_hash is distinct from public.eobra_snapshot_preview_hash(old.id) or old.summary is distinct from public.eobra_snapshot_summary(old.id) then raise exception 'A revisão mudou; confira novamente os vínculos, totais e cobertura.';end if;
      new.summary:=old.summary;new.preview_hash:=old.preview_hash;new.promotion_started_by:=auth.uid();new.promotion_started_at:=now();
    elsif old.status='promoting' and new.status='imported' and new.stage_phase='sealed' then
      if (select count(*) from public.eobra_migration_records where run_id=new.id and promoted)<>new.expected_records or exists(select 1 from public.eobra_migration_records rec where rec.run_id=new.id and not exists(select 1 from public.eobra_migration_ledger l where l.company_id=rec.company_id and l.source_host=new.source_host and l.entity=rec.entity and l.archive_type=rec.archive_type and l.source_id=rec.source_id and l.record_hash=rec.record_hash and l.targets=rec.canonical_targets)) then raise exception 'Snapshot possui registros ainda não concluídos.';end if;
      new.summary:=old.summary;new.preview_hash:=old.preview_hash;new.promoted_by:=auth.uid();new.promoted_at:=now();
      select jsonb_build_object('total',count(*),'duplicates',count(*) filter(where r.review_status='duplicate'),'archived',count(*) filter(where r.review_status='archived'),
        'created',coalesce(sum((select count(*) from jsonb_object_keys(r.canonical_targets) k where not r.expected_targets ? k)) filter(where r.review_status='ready'),0),
        'reused',coalesce(sum((select count(*) from jsonb_object_keys(r.expected_targets))) filter(where r.review_status='ready'),0)) into new.promotion_result from public.eobra_migration_records r where r.run_id=new.id;
    elsif old.status in('review','ready') and new.status=old.status and new.stage_phase=old.stage_phase then
      new.summary:=old.summary;new.preview_hash:=old.preview_hash;new.promotion_result:=old.promotion_result;
    else raise exception 'Transição de migração inválida.';end if;
  end if;
  new.updated_at:=now();return new;
end; $$;


create or replace function public.eobra_snapshot_guard_source()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare r public.eobra_migration_runs%rowtype;row_data jsonb:=to_jsonb(new);perms text[];record_row public.eobra_migration_records%rowtype;source_link jsonb;begin
  if tg_op<>'INSERT' then raise exception 'A evidência de origem é imutável; prepare outro snapshot.';end if;
  select * into r from public.eobra_migration_runs where id=(row_data->>'run_id')::uuid for update;
  if not found or (r.status<>'building' or r.stage_phase<>'loading') or r.company_id<>(row_data->>'company_id')::uuid then raise exception 'Origem fora do snapshot em preparação.';end if;
  if nullif(row_data->>'project_id','') is not null and not exists(select 1 from public.projects where id=(row_data->>'project_id')::uuid and company_id=r.company_id) then raise exception 'Obra fora da empresa do snapshot.';end if;
  if tg_table_name='eobra_migration_snapshots' then
    if public.eobra_import_hash(row_data->'document')<>r.snapshot_hash or row_data->>'snapshot_hash'<>r.snapshot_hash then raise exception 'Hash do snapshot divergente.';end if;
    if row_data->'document'->>'format' is distinct from r.format
      or coalesce(row_data->'document'->'source'->>'capturedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or lower(btrim(row_data->'document'->'source'->>'host')) is distinct from r.source_host
      or (row_data->'document'->'source'->>'capturedAt')::timestamptz is distinct from r.captured_at
      or public.eobra_import_date(row_data->'document'->'source'->>'referenceDate') is distinct from r.reference_date
      or row_data->'document'->'scope' is distinct from r.scope
      or coalesce(row_data->'document'->'archiveTypes','[]'::jsonb) is distinct from r.archive_types
      or row_data->>'project_id' is not null
      or jsonb_typeof(row_data->'document'->'coverage') is distinct from 'array'
      or jsonb_typeof(r.scope->'projectIds') is distinct from 'array' or jsonb_typeof(r.scope->'allProjects') is distinct from 'boolean'
      or jsonb_array_length(row_data->'document'->'records') not between 1 and 100000 or r.expected_records<>jsonb_array_length(row_data->'document'->'records')
      or octet_length((row_data->'document')::text)>62914560 then raise exception 'Metadados do snapshot divergem do documento de origem.';end if;
    if r.fingerprint is distinct from public.eobra_import_hash(jsonb_build_object('company',r.company_id,'host',r.source_host,'snapshot',r.snapshot_hash,'project_map',r.project_map))
      or exists(select 1 from jsonb_each(r.project_map) m where not r.scope->'projectIds' ? m.key)
      or exists(select 1 from jsonb_array_elements(r.scope->'projectIds') v where jsonb_typeof(v)<>'string' or nullif(btrim(v#>>'{}'),'') is null)
      or (select count(*) from jsonb_array_elements(r.scope->'projectIds'))<>(select count(distinct v) from jsonb_array_elements(r.scope->'projectIds') v) then raise exception 'Escopo ou identidade do snapshot inválidos.';end if;
    select coalesce(array_agg(distinct permission order by permission),array[]::text[]) into perms from jsonb_array_elements(row_data->'document'->'records') v cross join lateral unnest(public.eobra_snapshot_permissions(v->>'entity',coalesce(v->'normalized','{}'))) permission;
    if perms is distinct from r.required_permissions or not public.eobra_snapshot_authorized(r.company_id,perms) then raise exception 'Permissões do snapshot divergem das entidades capturadas.';end if;
  elsif tg_table_name='eobra_migration_relations' then
    select * into record_row from public.eobra_migration_records where id=(row_data->>'record_id')::uuid and run_id=r.id and company_id=r.company_id;
    source_link:=record_row.links->((row_data->>'ordinal')::int-1);
    if record_row.id is null or row_data->'attributes' is distinct from source_link or row_data->>'target_entity' is distinct from source_link->>'entity' or row_data->>'target_source_id' is distinct from source_link->>'sourceId' or row_data->>'role' is distinct from source_link->>'role' or row_data->>'project_id' is distinct from record_row.project_id::text then raise exception 'Relação diverge dos vínculos capturados.';end if;
    if row_data->>'is_primary' is distinct from source_link->>'primary' or row_data->>'target_archive_type' is distinct from coalesce(source_link->>'archiveType','') then raise exception 'Metadados da relação divergem da origem.';end if;
    if nullif(row_data->>'source_relation_id','') is distinct from nullif(source_link->>'source_relation_id','')
      or (row_data->>'allocated_amount')::numeric is distinct from public.eobra_import_money(source_link->>'allocated_amount')
      or (row_data->>'ownership_percent')::numeric is distinct from (case when source_link->>'ownership_percent' ~ '^[0-9]{1,3}(\.[0-9]{1,4})?$' then (source_link->>'ownership_percent')::numeric end) then raise exception 'Valores da relação divergem da origem.';end if;
  end if;
  new.created_by:=auth.uid();new.created_at:=now();new.updated_at:=now();return new;
end; $$;

create or replace function public.begin_eobra_snapshot(p_company_id uuid,p_snapshot jsonb,p_project_map jsonb)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public
as $$
declare v_run_id uuid;existing_run uuid;host text;captured timestamptz;reference_day date;perms text[];v_snapshot_hash text;v_fingerprint text;
  x jsonb;m record;item record;issues jsonb;targets jsonb;result_summary jsonb;record_state text;old_ledger public.eobra_migration_ledger%rowtype;
begin
  if not public.eobra_snapshot_authorized(p_company_id,array[]::text[]) then raise exception 'Sem permissão para preparar a migração desta empresa.' using errcode='42501';end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot->>'format'<>'elos.eobra.snapshot.v1' or jsonb_typeof(p_snapshot->'records') is distinct from 'array' or jsonb_typeof(p_snapshot->'coverage') is distinct from 'array' or jsonb_typeof(p_snapshot->'scope'->'projectIds') is distinct from 'array' or jsonb_typeof(p_project_map) is distinct from 'object' then raise exception 'Estrutura do pacote de migração inválida.';end if;
  if octet_length(p_snapshot::text)>62914560 or jsonb_array_length(p_snapshot->'records') not between 1 and 100000 then raise exception 'Pacote excede 60 MiB normalizado ou 100.000 registros.';end if;
  host:=lower(btrim(p_snapshot->'source'->>'host'));
  if host is null or host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.eobra\.com\.br$' then raise exception 'Ambiente de origem inválido.';end if;
  reference_day:=public.eobra_import_date(p_snapshot->'source'->>'referenceDate');
  begin captured:=(p_snapshot->'source'->>'capturedAt')::timestamptz;exception when others then raise exception 'Data de captura inválida.';end;
  if reference_day is null or captured is null or coalesce(p_snapshot->'source'->>'capturedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' or jsonb_typeof(p_snapshot->'scope'->'allProjects') is distinct from 'boolean' then raise exception 'Data de referência ou escopo não informado.';end if;
  if exists(select 1 from jsonb_array_elements(p_snapshot->'scope'->'projectIds') v where jsonb_typeof(v)<>'string' or nullif(btrim(v#>>'{}'),'') is null) or (select count(*) from jsonb_array_elements(p_snapshot->'scope'->'projectIds'))<>(select count(distinct v) from jsonb_array_elements(p_snapshot->'scope'->'projectIds') v) then raise exception 'Obras do escopo devem ter IDs textuais únicos.';end if;
  select coalesce(array_agg(distinct permission order by permission),array[]::text[]) into perms
    from jsonb_array_elements(p_snapshot->'records') v cross join lateral unnest(public.eobra_snapshot_permissions(v->>'entity',coalesce(v->'normalized','{}'))) permission;
  if not public.eobra_snapshot_authorized(p_company_id,perms) then raise exception 'Permissões nativas de todos os módulos do pacote são obrigatórias.' using errcode='42501';end if;
  if not public.eobra_snapshot_projects_visible(p_company_id,p_project_map) then raise exception 'De-para contém obra indisponível nesta empresa.' using errcode='42501';end if;
  v_snapshot_hash:=public.eobra_import_hash(p_snapshot);v_fingerprint:=public.eobra_import_hash(jsonb_build_object('company',p_company_id,'host',host,'snapshot',v_snapshot_hash,'project_map',p_project_map));
  perform pg_advisory_xact_lock(hashtextextended('eobra-snapshot:'||p_company_id::text,0));
  select id into existing_run from public.eobra_migration_runs b where b.company_id=p_company_id and b.fingerprint=v_fingerprint and b.status in('building','promoting','imported') and b.required_permissions=perms and exists(select 1 from public.eobra_migration_snapshots doc where doc.run_id=b.id and doc.snapshot_hash=v_snapshot_hash) order by b.created_at desc limit 1;
  if found then return existing_run;end if;
  for m in select key,value from jsonb_each(p_project_map) loop
    if not p_snapshot->'scope'->'projectIds' ? m.key then raise exception 'De-para contém obra fora do escopo declarado.';end if;
    if jsonb_typeof(m.value)='string' and exists(select 1 from public.projects p where p.id=public.eobra_import_uuid(m.value#>>'{}') and p.company_id=p_company_id)
      and not exists(select 1 from public.eobra_migration_project_links l where l.company_id=p_company_id and l.source_host=host and (l.source_id=m.key or l.project_id=public.eobra_import_uuid(m.value#>>'{}'))) then
      insert into public.eobra_migration_project_links(company_id,project_id,source_host,source_id) values(p_company_id,public.eobra_import_uuid(m.value#>>'{}'),host,m.key);
    end if;
  end loop;
  insert into public.eobra_migration_runs(company_id,source_host,format,captured_at,reference_date,scope,archive_types,project_map,required_permissions,snapshot_hash,fingerprint,expected_records)
  values(p_company_id,host,'elos.eobra.snapshot.v1',captured,reference_day,p_snapshot->'scope',coalesce(p_snapshot->'archiveTypes','[]'),p_project_map,perms,v_snapshot_hash,v_fingerprint,jsonb_array_length(p_snapshot->'records')) returning id into v_run_id;
  insert into public.eobra_migration_snapshots(run_id,company_id,document,snapshot_hash) values(v_run_id,p_company_id,p_snapshot,v_snapshot_hash);
  return v_run_id;
end; $$;

create or replace function public.eobra_snapshot_guard_result()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare j jsonb:=to_jsonb(new);r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;d jsonb;expected jsonb;native jsonb;k text;v jsonb;target uuid;ledger_id uuid;title public.eobra_migration_ledger%rowtype;allowed text[];begin
  if tg_op<>'INSERT' then raise exception 'Identidade e histórico importados são imutáveis.';end if;
  select * into r from public.eobra_migration_records where id=(j->>'record_id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('eobra-snapshot:'||r.company_id::text,0));
  select * into b from public.eobra_migration_runs where id=r.run_id for update;
  if r.id is null or b.status<>'promoting' or b.preview_hash is null or b.summary->'coverage_complete' is distinct from 'true'::jsonb
    or r.review_status not in('ready','archived') or jsonb_array_length(r.errors)>0
    or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions)
    or j->>'run_id' is distinct from b.id::text or j->>'company_id' is distinct from r.company_id::text
    or j->>'project_id' is distinct from r.project_id::text or j->>'source_host' is distinct from b.source_host or j->>'source_id' is distinct from r.source_id then raise exception 'Resultado sem prévia íntegra, autorizada e correspondente à origem.';end if;
  d:=r.normalized_data;
  perform public.eobra_snapshot_assert_dependencies(r.id);
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

create or replace function public.commercial_guard_sale_unit()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare s public.sales%rowtype;u public.units%rowtype;r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;rel public.eobra_migration_relations%rowtype;begin
  if tg_op='DELETE' then raise exception 'Vínculo de unidade deve ser preservado no histórico.';end if;
  select * into s from public.sales where id=new.sale_id and company_id=new.company_id and project_id=new.project_id for update;
  select * into u from public.units where id=new.unit_id and company_id=new.company_id and project_id=new.project_id for update;
  if s.id is null or u.id is null then raise exception 'Venda e unidade devem pertencer à mesma empresa e obra.';end if;
  if new.is_primary is distinct from (new.unit_id=s.unit_id) then raise exception 'Unidade principal deve corresponder à principal da venda.';end if;
  if new.status is distinct from (case when s.status='active' then 'active' else 'inactive' end) then raise exception 'Situação do vínculo deve acompanhar a situação da venda.';end if;
  if new.status='active' and (u.status='inactive' or exists(select 1 from public.sales other where other.company_id=new.company_id and other.unit_id=u.id and other.status='active' and other.id<>s.id)
    or exists(select 1 from public.commercial_sale_units other where other.unit_id=u.id and other.status='active' and other.sale_id<>s.id)) then raise exception 'Unidade inativa ou já vinculada a outra venda ativa.';end if;
  if tg_op='UPDATE' and old.source_system='eobra_snapshot' and (to_jsonb(new)-array['status','updated_at']) is distinct from (to_jsonb(old)-array['status','updated_at']) then raise exception 'Vínculo importado é evidência imutável; ajuste exige revisão explícita.';end if;
  if tg_op='INSERT' and new.source_system='eobra_snapshot' then
    select * into r from public.eobra_migration_records where id=new.source_record_id and company_id=new.company_id and project_id=new.project_id and entity='sale';
    select * into b from public.eobra_migration_runs where id=r.run_id;
    if r.id is null or b.status<>'promoting' or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) or s.source_system<>'eobra_snapshot' or s.source_id is distinct from b.source_host||'|sale|'||r.source_id then raise exception 'Venda não corresponde à prévia importada.';end if;
    select link.* into rel from public.eobra_migration_relations link join public.eobra_migration_ledger l on l.company_id=b.company_id and l.source_host=b.source_host and l.entity='unit' and l.source_id=link.target_source_id and l.archive_type=''
      where link.record_id=r.id and link.role='unit' and link.target_entity='unit' and public.eobra_import_uuid(l.targets->>'units')=new.unit_id;
    if rel.id is null or new.allocated_amount is distinct from rel.allocated_amount or new.source_relation_id is distinct from rel.source_relation_id
      or new.source_id is distinct from b.source_host||'|sale|'||r.source_id||'|unit|'||rel.target_source_id then raise exception 'Alocação e identidade da unidade divergem da origem.';end if;
  elsif new.source_system is distinct from 'eobra_snapshot' and (new.source_record_id is not null or new.source_relation_id is not null and new.source_system is null) then raise exception 'Proveniência da relação incompleta.';end if;
  if tg_op='INSERT' then new.created_by:=auth.uid();new.created_at:=now();end if;
  new.updated_at:=now();return new;
end; $$;

create or replace function public.eobra_snapshot_promote_sale_units(p_record_id uuid,p_sale_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;s public.sales%rowtype;link record;target uuid;begin
  select * into r from public.eobra_migration_records where id=p_record_id and entity='sale';select * into b from public.eobra_migration_runs where id=r.run_id;
  select * into s from public.sales where id=p_sale_id and company_id=r.company_id and project_id=r.project_id;
  if r.id is null or b.status<>'promoting' or r.review_status<>'ready' or s.id is null or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Venda sem prévia autorizada.';end if;
  for link in select rel.*,public.eobra_import_uuid(l.targets->>'units') target_id from public.eobra_migration_relations rel
    join public.eobra_migration_ledger l on l.company_id=b.company_id and l.source_host=b.source_host and l.entity='unit' and l.archive_type='' and l.source_id=rel.target_source_id
    where rel.record_id=r.id and rel.role='unit' and rel.target_entity='unit' order by public.eobra_import_uuid(l.targets->>'units') loop
    insert into public.commercial_sale_units(company_id,project_id,sale_id,unit_id,is_primary,allocated_amount,status,source_system,source_id,source_relation_id,source_record_id)
    values(r.company_id,r.project_id,s.id,link.target_id,link.target_id=s.unit_id,link.allocated_amount,case when s.status='active' then 'active' else 'inactive' end,'eobra_snapshot',b.source_host||'|sale|'||r.source_id||'|unit|'||link.target_source_id,link.source_relation_id,r.id);
    if s.status='active' then update public.units set status='sold',updated_at=now() where id=link.target_id and company_id=r.company_id and project_id=r.project_id;end if;
  end loop;
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
    update public.eobra_migration_records set canonical_targets=targets,promoted=true,status=case when r.review_status='archived' then 'archived' else 'imported' end where id=r.id;
  end loop;
  if not exists(select 1 from public.eobra_migration_records where run_id=b.id and not promoted) then
    update public.eobra_migration_runs set status='imported',promotion_result='{}' where id=b.id;
  end if;
  return public.eobra_snapshot_progress(b.id);
end; $$;

-- Lock native dependencies while a chunk uses them, and compare their source
-- identity/bindings before constructing a new child. Creation audit and a unit's
-- legitimate available -> sold transition are not identity changes.
create or replace function public.eobra_snapshot_assert_native_target(p_record_id uuid,p_table text,p_target_id uuid)
returns void language plpgsql volatile security invoker set search_path=pg_catalog,public
as $$ declare r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;native jsonb;expected jsonb;tax text;begin
  select * into r from public.eobra_migration_records where id=p_record_id;select * into b from public.eobra_migration_runs where id=r.run_id;
  if r.id is null or p_target_id is null or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions)
    or not(r.entity='person' and p_table in('clients','suppliers') or r.entity='unit' and p_table='units' or r.entity='sale' and p_table='sales' or r.entity='receivable' and p_table='receivables' or r.entity='payable' and p_table='payables') then raise exception 'Dependência canônica indisponível ou incompatível.';end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1 and company_id=$2 for share',p_table) into native using p_target_id,r.company_id;
  if native is null or r.entity<>'person' and native->>'project_id' is distinct from r.project_id::text then raise exception 'Dependência mudou de empresa, obra ou ficou indisponível após a revisão.';end if;
  if r.entity='person' then
    if r.expected_targets ? p_table then
      if p_target_id is distinct from public.eobra_import_uuid(r.expected_targets->>p_table) then raise exception 'Cadastro vinculado diverge da identidade revisada.';end if;
    elsif native->>'source_system' is distinct from 'eobra_snapshot' or native->>'source_id' is distinct from b.source_host||'|person|'||r.source_id then raise exception 'Identidade de origem do cadastro foi alterada.';end if;
    tax:=nullif(regexp_replace(coalesce(r.normalized_data->>'tax_id',''),'[^0-9]','','g'),'');
    if tax is not null and regexp_replace(coalesce(native->>'tax_id',''),'[^0-9]','','g') is distinct from tax then raise exception 'CPF/CNPJ da dependência foi alterado após a revisão.';end if;
  elsif r.entity='unit' then
    if native->>'source_system' is distinct from 'eobra_snapshot' or native->>'source_id' is distinct from b.source_host||'|unit|'||r.source_id or native->>'code' is distinct from r.normalized_data->>'code' then raise exception 'Identidade da unidade foi alterada após a revisão.';end if;
  else
    expected:=public.eobra_snapshot_native_payload(r.id,p_table)-'created_by';
    if not native @> expected or r.entity in('receivable','payable') and (native->>'adjusted_amount')::numeric is distinct from public.eobra_import_money(r.normalized_data->>'current_amount') then raise exception 'Vínculos ou valores da dependência % mudaram após a revisão.',r.entity;end if;
  end if;
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
    select * into source from public.eobra_migration_records where id=public.eobra_snapshot_resolve_link(r.id,'installment');
    target_table:=case source.entity when 'receivable' then 'receivables' when 'payable' then 'payables' end;
    perform public.eobra_snapshot_assert_native_target(source.id,target_table,public.eobra_snapshot_link_target(r.id,'installment',source.entity,target_table));
  end if;
end; $$;

create or replace function public.eobra_snapshot_native_payload(p_record_id uuid,p_table text)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,public
as $$ declare r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;d jsonb;p jsonb;k text;s public.sales%rowtype;paid_day date;begin
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

create or replace function public.stage_eobra_snapshot(p_company_id uuid,p_snapshot jsonb,p_project_map jsonb)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare id uuid;progress jsonb;begin
  if jsonb_typeof(p_snapshot->'records') is distinct from 'array' or jsonb_array_length(p_snapshot->'records')>500 then raise exception 'Pacotes acima de 500 registros exigem processamento retomável.';end if;
  id:=public.begin_eobra_snapshot(p_company_id,p_snapshot,p_project_map);
  loop
    progress:=public.eobra_snapshot_progress(id);
    case progress->>'next_step'
      when 'append' then perform public.append_eobra_snapshot(id,500);
      when 'finish_append' then perform public.finish_eobra_snapshot_append(id);
      when 'validate' then perform public.validate_eobra_snapshot_chunk(id,100);
      when 'seal' then perform public.seal_eobra_snapshot(id);
      else return id;
    end case;
  end loop;
end; $$;

create or replace function public.promote_eobra_snapshot(p_run_id uuid,p_preview_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;progress jsonb;begin
  select * into b from public.eobra_migration_runs where id=p_run_id;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.';end if;
  if b.status='imported' then return b.promotion_result;end if;
  if b.expected_records>100 then raise exception 'Pacotes acima de 100 registros exigem promoção retomável.';end if;
  loop
    progress:=public.promote_eobra_snapshot_chunk(b.id,p_preview_hash,50);
    if progress->>'status'='imported' then return progress->'promotion_result';end if;
  end loop;
end; $$;

create or replace function public.review_eobra_snapshot(p_run_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;begin
  select * into b from public.eobra_migration_runs where id=p_run_id;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.' using errcode='42501';end if;
  return public.eobra_snapshot_progress(b.id)||jsonb_build_object('source_host',b.source_host,'reference_date',b.reference_date,
    'coverage',coalesce((select jsonb_agg(jsonb_build_object('entity',c.entity,'source_project_id',c.source_project_id,'archive_type',c.archive_type,'expected_count',c.expected_count,'actual_count',c.actual_count,'verified',c.verified,'errors',c.errors) order by c.entity,c.source_project_id) from public.eobra_migration_coverage c where c.run_id=b.id),'[]'::jsonb));
end; $$;

create or replace function public.cancel_eobra_snapshot(p_run_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;begin
  select * into b from public.eobra_migration_runs where id=p_run_id for update;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.' using errcode='42501';end if;
  if b.status='cancelled' then return;end if;
  if b.status='imported' then raise exception 'Snapshot promovido não pode ser cancelado.';end if;
  update public.eobra_migration_runs set status='cancelled' where id=b.id;
end; $$;

do $$ declare f record;begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('eobra_snapshot_assert_native_target','eobra_snapshot_assert_dependencies','eobra_snapshot_native_payload','eobra_snapshot_progress','eobra_snapshot_assert_source','eobra_snapshot_record_review','begin_eobra_snapshot','append_eobra_snapshot','finish_eobra_snapshot_append','validate_eobra_snapshot_chunk','seal_eobra_snapshot','promote_eobra_snapshot_chunk','stage_eobra_snapshot','promote_eobra_snapshot','review_eobra_snapshot','cancel_eobra_snapshot') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end; $$;
comment on column public.eobra_migration_runs.stage_phase is 'loading accepts immutable source rows; validating computes bounded review batches; sealed freezes the approved preview.';
comment on column public.eobra_migration_records.promoted is 'Per-record durable progress. Completed chunks remain visible after a later chunk fails; immutable identity prevents duplicates.';
commit;
