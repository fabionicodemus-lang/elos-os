-- Large packages travel as a small immutable manifest and bounded source parts.
-- The database never concatenates the source parts into a large JSON document.
begin;

alter table public.eobra_migration_runs drop constraint eobra_migration_runs_format_check;
alter table public.eobra_migration_runs add constraint eobra_migration_runs_format_check
  check(format in('elos.eobra.snapshot.v1','elos.eobra.snapshot.parts.v1'));
alter table public.eobra_migration_runs add column source_storage_path text,
  add column expected_parts integer not null default 0 check(expected_parts between 0 and 1000),
  add column expected_source_bytes bigint not null default 0 check(expected_source_bytes between 0 and 209715200);

create table public.eobra_migration_snapshot_parts(
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.eobra_migration_runs(id),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id) check(project_id is null),
  part_ordinal integer not null check(part_ordinal between 1 and 1000),
  first_record integer not null check(first_record between 1 and 100000),
  record_count integer not null check(record_count between 1 and 500),
  byte_length integer not null check(byte_length between 1 and 2097152),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  json_text text not null,
  record_hashes text[] not null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(run_id,part_ordinal),unique(run_id,first_record),
  check(first_record+record_count-1<=100000),check(cardinality(record_hashes)=record_count)
);
alter table public.eobra_migration_snapshot_parts enable row level security;
revoke all on public.eobra_migration_snapshot_parts from public,anon,authenticated;
grant select,insert on public.eobra_migration_snapshot_parts to authenticated;
create policy eobra_migration_snapshot_parts_access on public.eobra_migration_snapshot_parts for all to authenticated
using(exists(select 1 from public.eobra_migration_runs r where r.id=eobra_migration_snapshot_parts.run_id and r.company_id=eobra_migration_snapshot_parts.company_id))
with check(exists(select 1 from public.eobra_migration_runs r where r.id=eobra_migration_snapshot_parts.run_id and r.company_id=eobra_migration_snapshot_parts.company_id));

create or replace function public.eobra_snapshot_assert_storage_path(p_company_id uuid,p_user_id uuid,p_path text)
returns void language plpgsql immutable security invoker set search_path=pg_catalog,public
as $$ declare pieces text[]:=string_to_array(p_path,'/');begin
  if p_company_id is null or p_user_id is null or p_path is null or cardinality(pieces)<>4
    or pieces[1] is distinct from p_company_id::text or pieces[2] is distinct from p_user_id::text
    or pieces[3] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or public.eobra_import_uuid(pieces[3]) is null or pieces[4]<>'manifest.json' then
    raise exception 'Caminho do manifesto deve pertencer à empresa, ao usuário e a um pacote identificado.';
  end if;
end; $$;

create or replace function public.eobra_snapshot_assert_parts_manifest(p_manifest jsonb,p_project_map jsonb)
returns void language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare part jsonb;ordinal integer:=0;next_record integer:=1;total_bytes bigint:=0;count_records integer;captured timestamptz;begin
  if jsonb_typeof(p_manifest) is distinct from 'object' or p_manifest->>'format' is distinct from 'elos.eobra.snapshot.parts.v1'
    or p_manifest ? 'records' or octet_length(p_manifest::text)>2097152
    or jsonb_typeof(p_manifest->'parts') is distinct from 'array' or jsonb_typeof(p_manifest->'coverage') is distinct from 'array'
    or jsonb_typeof(p_manifest->'scope'->'projectIds') is distinct from 'array' or jsonb_typeof(p_manifest->'scope'->'allProjects') is distinct from 'boolean'
    or jsonb_typeof(p_manifest->'archiveTypes') is distinct from 'array' or jsonb_typeof(p_project_map) is distinct from 'object'
    or jsonb_typeof(p_manifest->'recordCount') is distinct from 'number' or coalesce(p_manifest->>'recordCount','') !~ '^[1-9][0-9]{0,5}$' then
    raise exception 'Manifesto multipart inválido ou maior que 2 MiB.';
  end if;
  count_records:=(p_manifest->>'recordCount')::int;
  if count_records>100000 or jsonb_array_length(p_manifest->'parts') not between 1 and 1000 then raise exception 'Pacote excede 100.000 registros ou 1.000 partes.';end if;
  if coalesce(lower(btrim(p_manifest->'source'->>'host')),'') !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.eobra\.com\.br$'
    or public.eobra_import_date(p_manifest->'source'->>'referenceDate') is null
    or coalesce(p_manifest->'source'->>'capturedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Origem ou data do manifesto inválida.';end if;
  begin captured:=(p_manifest->'source'->>'capturedAt')::timestamptz;exception when others then raise exception 'Data de captura inválida.';end;
  if captured is null or exists(select 1 from jsonb_array_elements(p_manifest->'scope'->'projectIds') v where jsonb_typeof(v)<>'string' or nullif(btrim(v#>>'{}'),'') is null)
    or (select count(*) from jsonb_array_elements(p_manifest->'scope'->'projectIds'))<>(select count(distinct v) from jsonb_array_elements(p_manifest->'scope'->'projectIds') v)
    or exists(select 1 from jsonb_each(p_project_map) m where not p_manifest->'scope'->'projectIds' ? m.key) then raise exception 'Obras do escopo ou de-para inválidas.';end if;
  for part in select value from jsonb_array_elements(p_manifest->'parts') loop
    ordinal:=ordinal+1;
    if jsonb_typeof(part) is distinct from 'object' or jsonb_typeof(part->'ordinal') is distinct from 'number' or part->>'ordinal' is distinct from ordinal::text
      or jsonb_typeof(part->'firstRecord') is distinct from 'number' or part->>'firstRecord' is distinct from next_record::text
      or jsonb_typeof(part->'recordCount') is distinct from 'number' or coalesce(part->>'recordCount','') !~ '^[1-9][0-9]{0,2}$'
      or jsonb_typeof(part->'byteLength') is distinct from 'number' or coalesce(part->>'byteLength','') !~ '^[1-9][0-9]{0,6}$'
      or jsonb_typeof(part->'sha256') is distinct from 'string' or coalesce(part->>'sha256','') !~ '^[0-9a-f]{64}$'
      or part->>'name' is distinct from ('part-'||lpad(ordinal::text,6,'0')||'.json') then raise exception 'Descritor de parte inválido, fora de ordem ou sem hash e contagem exatos.';end if;
    if (part->>'recordCount')::int>500 or (part->>'byteLength')::int>2097152 then raise exception 'Cada parte aceita até 500 registros e 2 MiB.';end if;
    next_record:=next_record+(part->>'recordCount')::int;total_bytes:=total_bytes+(part->>'byteLength')::int;
  end loop;
  if next_record-1<>count_records or total_bytes>209715200 then raise exception 'Contagem total divergente ou pacote maior que 200 MiB.';end if;
end; $$;

create or replace function public.eobra_snapshot_evidence_hash(p_record_hash text,p_source_errors jsonb)
returns text language sql immutable security invoker set search_path=pg_catalog,public
as $$ select public.eobra_import_hash(jsonb_build_object('record',p_record_hash,'source_errors',coalesce(p_source_errors,'[]'::jsonb))); $$;

create or replace function public.eobra_snapshot_guard_part()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;manifest jsonb;descriptor jsonb;data jsonb;body_hash text;begin
  if tg_op<>'INSERT' then raise exception 'Partes de origem são imutáveis.';end if;
  select * into b from public.eobra_migration_runs where id=new.run_id for update;
  if not found or b.company_id<>new.company_id or b.format<>'elos.eobra.snapshot.parts.v1' or b.status<>'building' or b.stage_phase<>'loading'
    or new.project_id is not null or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Parte fora de um pacote autorizado em carga.';end if;
  select document into manifest from public.eobra_migration_snapshots where run_id=b.id;
  descriptor:=manifest->'parts'->(new.part_ordinal-1);
  if new.part_ordinal is null or new.part_ordinal not between 1 and b.expected_parts or descriptor is null
    or (select count(*)+1 from public.eobra_migration_snapshot_parts where run_id=b.id)<>new.part_ordinal then raise exception 'Envie a próxima parte na ordem declarada no manifesto.';end if;
  if new.json_text is null or octet_length(new.json_text)>2097152 or octet_length(new.json_text)<>(descriptor->>'byteLength')::int then raise exception 'Tamanho da parte diverge do manifesto ou excede 2 MiB.';end if;
  body_hash:=encode(sha256(convert_to(new.json_text,'UTF8')),'hex');
  if body_hash is distinct from descriptor->>'sha256' then raise exception 'Hash da parte diverge do manifesto; nenhum dado foi acrescentado.';end if;
  begin data:=new.json_text::jsonb;exception when others then raise exception 'A parte não contém um array JSON válido.';end;
  if jsonb_typeof(data) is distinct from 'array' or jsonb_array_length(data)<>(descriptor->>'recordCount')::int then raise exception 'A contagem de registros da parte diverge do manifesto.';end if;
  new.first_record:=(descriptor->>'firstRecord')::int;new.record_count:=(descriptor->>'recordCount')::int;
  new.byte_length:=(descriptor->>'byteLength')::int;new.sha256:=body_hash;
  select array_agg(public.eobra_snapshot_evidence_hash(public.eobra_snapshot_record_hash(v->>'entity',v->>'sourceId',nullif(v->>'sourceProjectId',''),coalesce(v->>'archiveType',''),nullif(v->>'parentSourceId',''),v->'raw',v->'normalized',coalesce(v->'links','[]')),coalesce(v->'errors','[]')) order by ord)
    into new.record_hashes from jsonb_array_elements(data) with ordinality source(v,ord);
  new.created_by:=auth.uid();new.created_at:=now();new.updated_at:=now();return new;
end; $$;
create trigger eobra_snapshot_part_guard before insert or update or delete on public.eobra_migration_snapshot_parts for each row execute function public.eobra_snapshot_guard_part();

-- Small per-record receipts bind every staging INSERT to its immutable part.
-- This guard also runs for writes made directly through PostgREST tables.
create or replace function public.eobra_snapshot_guard_part_record()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;expected text;actual text;begin
  select * into b from public.eobra_migration_runs where id=new.run_id;
  if b.format='elos.eobra.snapshot.parts.v1' then
    select part.record_hashes[new.source_ordinal-part.first_record+1] into expected from public.eobra_migration_snapshot_parts part
      where part.run_id=b.id and new.source_ordinal between part.first_record and part.first_record+part.record_count-1;
    actual:=public.eobra_snapshot_evidence_hash(public.eobra_snapshot_record_hash(new.entity,new.source_id,new.source_project_id,new.archive_type,new.parent_source_id,new.raw_data,new.normalized_data,new.links),new.source_errors);
    if expected is null or expected is distinct from actual then raise exception 'Registro diverge da parte imutável ou a parte ainda não foi recebida.';end if;
  end if;
  return new;
end; $$;
create trigger eobra_snapshot_part_record_guard before insert on public.eobra_migration_records for each row execute function public.eobra_snapshot_guard_part_record();

create or replace function public.eobra_snapshot_materialize_part()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;data jsonb:=new.json_text::jsonb;begin
  select * into b from public.eobra_migration_runs where id=new.run_id;
  insert into public.eobra_migration_records(run_id,company_id,project_id,source_ordinal,entity,source_id,source_project_id,archive_type,parent_source_id,links,raw_data,normalized_data,source_errors,record_hash)
  select b.id,b.company_id,public.eobra_import_uuid(b.project_map->>(case when v->>'entity'='project' then v->>'sourceId' else v->>'sourceProjectId' end)),new.first_record+ord::int-1,
    v->>'entity',v->>'sourceId',nullif(v->>'sourceProjectId',''),coalesce(v->>'archiveType',''),nullif(v->>'parentSourceId',''),coalesce(v->'links','[]'),v->'raw',v->'normalized',coalesce(v->'errors','[]'),'pending'
    from jsonb_array_elements(data) with ordinality source(v,ord);
  insert into public.eobra_migration_relations(run_id,record_id,company_id,project_id,ordinal,target_entity,target_source_id,target_archive_type,role,source_relation_id,is_primary,allocated_amount,ownership_percent,attributes)
  select b.id,rec.id,b.company_id,rec.project_id,ord::int,v->>'entity',v->>'sourceId',coalesce(v->>'archiveType',''),v->>'role',nullif(v->>'source_relation_id',''),
    case when v->'primary'='true'::jsonb then true when v->'primary'='false'::jsonb then false end,public.eobra_import_money(v->>'allocated_amount'),case when v->>'ownership_percent' ~ '^[0-9]{1,3}(\.[0-9]{1,4})?$' then (v->>'ownership_percent')::numeric end,v
    from public.eobra_migration_records rec cross join lateral jsonb_array_elements(rec.links) with ordinality source(v,ord)
    where rec.run_id=b.id and rec.source_ordinal between new.first_record and new.first_record+new.record_count-1;
  return new;
end; $$;
create trigger eobra_snapshot_part_materialize after insert on public.eobra_migration_snapshot_parts for each row execute function public.eobra_snapshot_materialize_part();

create or replace function public.begin_eobra_snapshot_parts(p_company_id uuid,p_manifest jsonb,p_project_map jsonb,p_storage_path text)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare id uuid;existing uuid;host text;perms text[];v_snapshot_hash text;v_fingerprint text;source_bytes bigint;m record;begin
  select array_agg(permission order by permission) into perms from unnest(public.eobra_snapshot_permissions('raw_archive','{}')) permission;
  if not public.eobra_snapshot_authorized(p_company_id,perms) then raise exception 'O pacote completo exige as permissões de empresa e dos módulos nativos.' using errcode='42501';end if;
  perform public.eobra_snapshot_assert_storage_path(p_company_id,auth.uid(),p_storage_path);
  perform public.eobra_snapshot_assert_parts_manifest(p_manifest,p_project_map);
  if not public.eobra_snapshot_projects_visible(p_company_id,p_project_map) then raise exception 'De-para contém obra indisponível nesta empresa.' using errcode='42501';end if;
  host:=lower(btrim(p_manifest->'source'->>'host'));v_snapshot_hash:=public.eobra_import_hash(p_manifest);
  v_fingerprint:=public.eobra_import_hash(jsonb_build_object('company',p_company_id,'host',host,'snapshot',v_snapshot_hash,'project_map',p_project_map));
  perform pg_advisory_xact_lock(hashtextextended('eobra-snapshot:'||p_company_id::text,0));
  select b.id into existing from public.eobra_migration_runs b where b.company_id=p_company_id and b.fingerprint=v_fingerprint and b.source_storage_path=p_storage_path
    and b.format='elos.eobra.snapshot.parts.v1' and b.status in('building','promoting','imported') and b.required_permissions=perms
    and exists(select 1 from public.eobra_migration_snapshots s where s.run_id=b.id and s.snapshot_hash=v_snapshot_hash) order by b.created_at desc limit 1;
  if found then return existing;end if;
  for m in select key,value from jsonb_each(p_project_map) loop
    if not exists(select 1 from public.eobra_migration_project_links l where l.company_id=p_company_id and l.source_host=host and (l.source_id=m.key or l.project_id=public.eobra_import_uuid(m.value#>>'{}'))) then
      insert into public.eobra_migration_project_links(company_id,project_id,source_host,source_id) values(p_company_id,public.eobra_import_uuid(m.value#>>'{}'),host,m.key);
    end if;
  end loop;
  select sum((part->>'byteLength')::bigint) into source_bytes from jsonb_array_elements(p_manifest->'parts') part;
  insert into public.eobra_migration_runs(company_id,source_host,format,captured_at,reference_date,scope,archive_types,project_map,required_permissions,snapshot_hash,fingerprint,expected_records,source_storage_path,expected_parts,expected_source_bytes)
    values(p_company_id,host,'elos.eobra.snapshot.parts.v1',(p_manifest->'source'->>'capturedAt')::timestamptz,public.eobra_import_date(p_manifest->'source'->>'referenceDate'),p_manifest->'scope',p_manifest->'archiveTypes',p_project_map,perms,v_snapshot_hash,v_fingerprint,(p_manifest->>'recordCount')::int,p_storage_path,jsonb_array_length(p_manifest->'parts'),source_bytes) returning eobra_migration_runs.id into id;
  insert into public.eobra_migration_snapshots(run_id,company_id,document,snapshot_hash) values(id,p_company_id,p_manifest,v_snapshot_hash);
  return id;
end; $$;

create or replace function public.append_eobra_snapshot_part(p_run_id uuid,p_part_ordinal integer,p_json_text text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;part public.eobra_migration_snapshot_parts%rowtype;descriptor jsonb;body_hash text;begin
  if p_part_ordinal is null or p_json_text is null or octet_length(p_json_text)>2097152 then raise exception 'Parte inválida ou maior que 2 MiB.';end if;
  select * into b from public.eobra_migration_runs where id=p_run_id for update;
  if not found or b.format<>'elos.eobra.snapshot.parts.v1' or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Pacote indisponível ou sem permissão.' using errcode='42501';end if;
  if p_part_ordinal not between 1 and b.expected_parts then raise exception 'Ordinal de parte fora do manifesto.';end if;
  select document->'parts'->(p_part_ordinal-1) into descriptor from public.eobra_migration_snapshots where run_id=b.id;
  body_hash:=encode(sha256(convert_to(p_json_text,'UTF8')),'hex');
  if descriptor is null or descriptor->>'sha256' is distinct from body_hash or (descriptor->>'byteLength')::int<>octet_length(p_json_text) then raise exception 'Hash ou tamanho da parte diverge do manifesto.';end if;
  select * into part from public.eobra_migration_snapshot_parts where run_id=b.id and part_ordinal=p_part_ordinal;
  if found then
    if part.sha256<>body_hash or part.json_text is distinct from p_json_text then raise exception 'Esta parte já existe com conteúdo diferente.';end if;
    return public.eobra_snapshot_progress(b.id);
  end if;
  insert into public.eobra_migration_snapshot_parts(run_id,company_id,part_ordinal,first_record,record_count,byte_length,sha256,json_text,record_hashes)
    values(b.id,b.company_id,p_part_ordinal,1,1,1,body_hash,p_json_text,array[]::text[]);
  return public.eobra_snapshot_progress(b.id);
end; $$;


create or replace function public.eobra_snapshot_guard_source()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare r public.eobra_migration_runs%rowtype;row_data jsonb:=to_jsonb(new);perms text[];record_row public.eobra_migration_records%rowtype;source_link jsonb;begin
  if tg_op<>'INSERT' then raise exception 'A evidência de origem é imutável; prepare outro snapshot.';end if;
  select * into r from public.eobra_migration_runs where id=(row_data->>'run_id')::uuid for update;
  if not found or (r.status<>'building' or r.stage_phase<>'loading') or r.company_id<>(row_data->>'company_id')::uuid then raise exception 'Origem fora do snapshot em preparação.';end if;
  if nullif(row_data->>'project_id','') is not null and not exists(select 1 from public.projects where id=(row_data->>'project_id')::uuid and company_id=r.company_id) then raise exception 'Obra fora da empresa do snapshot.';end if;
  if tg_table_name='eobra_migration_snapshots' and r.format='elos.eobra.snapshot.parts.v1' then
    perform public.eobra_snapshot_assert_parts_manifest(row_data->'document',r.project_map);
    perform public.eobra_snapshot_assert_storage_path(r.company_id,r.created_by,r.source_storage_path);
    select array_agg(permission order by permission) into perms from unnest(public.eobra_snapshot_permissions('raw_archive','{}')) permission;
    if public.eobra_import_hash(row_data->'document') is distinct from r.snapshot_hash or row_data->>'snapshot_hash' is distinct from r.snapshot_hash
      or row_data->'document'->>'format' is distinct from r.format or lower(btrim(row_data->'document'->'source'->>'host')) is distinct from r.source_host
      or (row_data->'document'->'source'->>'capturedAt')::timestamptz is distinct from r.captured_at
      or public.eobra_import_date(row_data->'document'->'source'->>'referenceDate') is distinct from r.reference_date
      or row_data->'document'->'scope' is distinct from r.scope or row_data->'document'->'archiveTypes' is distinct from r.archive_types
      or row_data->>'project_id' is not null or (row_data->'document'->>'recordCount')::int<>r.expected_records
      or jsonb_array_length(row_data->'document'->'parts')<>r.expected_parts
      or (select sum((part->>'byteLength')::bigint) from jsonb_array_elements(row_data->'document'->'parts') part)<>r.expected_source_bytes
      or r.fingerprint is distinct from public.eobra_import_hash(jsonb_build_object('company',r.company_id,'host',r.source_host,'snapshot',r.snapshot_hash,'project_map',r.project_map))
      or r.required_permissions is distinct from perms or not public.eobra_snapshot_authorized(r.company_id,perms) then raise exception 'Manifesto, permissões ou metadados divergem do pacote imutável.';end if;
    new.created_by:=auth.uid();new.created_at:=now();new.updated_at:=now();return new;
  end if;
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

create or replace function public.eobra_snapshot_assert_source(p_run_id uuid)
returns void language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;doc jsonb;begin
  select * into b from public.eobra_migration_runs where id=p_run_id;
  select document into doc from public.eobra_migration_snapshots where run_id=b.id;
  if b.id is null or doc is null or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) or not public.eobra_snapshot_projects_visible(b.company_id,b.project_map) then raise exception 'Snapshot indisponível ou sem permissões.';end if;
  if b.format='elos.eobra.snapshot.parts.v1' then
    if (select count(*) from public.eobra_migration_snapshot_parts where run_id=b.id)<>b.expected_parts
      or (select coalesce(sum(byte_length),0) from public.eobra_migration_snapshot_parts where run_id=b.id)<>b.expected_source_bytes
      or (select coalesce(sum(record_count),0) from public.eobra_migration_snapshot_parts where run_id=b.id)<>b.expected_records
      or (select count(*) from public.eobra_migration_records where run_id=b.id)<>b.expected_records
      or (select count(*) from public.eobra_migration_coverage where run_id=b.id)<>jsonb_array_length(doc->'coverage') then raise exception 'Partes, registros ou cobertura ainda incompletos.';end if;
    -- Each INSERT was already bound to its immutable part receipt. Parts create
    -- all rows/relations atomically; source fields cannot change, source ordinals
    -- and relation ordinals are unique, and DELETE is not granted. Re-expanding
    -- every receipt here adds an expensive redundant join at large volume.
    if (select count(*) from public.eobra_migration_relations where run_id=b.id)
      <> (select coalesce(sum(jsonb_array_length(links)),0) from public.eobra_migration_records where run_id=b.id) then raise exception 'Relações capturadas incompletas.';end if;
    if exists(select 1 from jsonb_array_elements(doc->'coverage') source(v) where not exists(select 1 from public.eobra_migration_coverage cov where cov.run_id=b.id and cov.declared=source.v and cov.entity=source.v->>'entity' and cov.source_project_id is not distinct from nullif(source.v->>'sourceProjectId','') and cov.archive_type=coalesce(source.v->>'archiveType',''))) then raise exception 'Cobertura diverge do manifesto imutável.';end if;
    return;
  end if;
  if b.expected_records<>jsonb_array_length(doc->'records') or (select count(*) from public.eobra_migration_records where run_id=b.id)<>b.expected_records
    or (select count(*) from public.eobra_migration_coverage where run_id=b.id)<>jsonb_array_length(doc->'coverage') then raise exception 'Evidência ainda incompleta.';end if;
  if exists(select 1 from jsonb_array_elements(doc->'records') with ordinality source(v,ord) left join public.eobra_migration_records rec on rec.run_id=b.id and rec.source_ordinal=source.ord
    where rec.id is null or rec.record_hash is distinct from public.eobra_snapshot_record_hash(v->>'entity',v->>'sourceId',nullif(v->>'sourceProjectId',''),coalesce(v->>'archiveType',''),nullif(v->>'parentSourceId',''),v->'raw',v->'normalized',coalesce(v->'links','[]'))
      or rec.source_errors is distinct from coalesce(v->'errors','[]'::jsonb)) then raise exception 'Registro diverge do documento imutável de origem.';end if;
  if exists(select 1 from public.eobra_migration_records rec left join lateral(select count(*) n from public.eobra_migration_relations where record_id=rec.id) rel on true where rec.run_id=b.id and rel.n<>jsonb_array_length(rec.links)) then raise exception 'Relações capturadas incompletas.';end if;
  if exists(select 1 from jsonb_array_elements(doc->'coverage') source(v) where not exists(select 1 from public.eobra_migration_coverage cov where cov.run_id=b.id and cov.declared=source.v and cov.entity=source.v->>'entity' and cov.source_project_id is not distinct from nullif(source.v->>'sourceProjectId','') and cov.archive_type=coalesce(source.v->>'archiveType',''))) then raise exception 'Cobertura diverge do manifesto imutável.';end if;
end; $$;

create or replace function public.append_eobra_snapshot(p_run_id uuid,p_limit integer default 250)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;doc jsonb;source_records jsonb;wanted integer[];begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'Acrescente entre 1 e 500 registros por chamada.';end if;
  select * into b from public.eobra_migration_runs where id=p_run_id for update;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.';end if;
  if b.format='elos.eobra.snapshot.parts.v1' then raise exception 'Este pacote exige append_eobra_snapshot_part com a próxima parte do manifesto.';end if;
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

create or replace function public.eobra_snapshot_progress(p_run_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;loaded integer;checked integer;done integer;received integer:=0;received_bytes bigint:=0;next_action text;begin
  select * into b from public.eobra_migration_runs where id=p_run_id;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.' using errcode='42501';end if;
  select count(*),count(*) filter(where validated),count(*) filter(where promoted) into loaded,checked,done from public.eobra_migration_records where run_id=b.id;
  if b.format='elos.eobra.snapshot.parts.v1' then select count(*),coalesce(sum(byte_length),0) into received,received_bytes from public.eobra_migration_snapshot_parts where run_id=b.id;end if;
  next_action:=case when b.status='imported' then 'complete' when b.status in('review','cancelled') then 'blocked' when b.status in('ready','promoting') then 'promote'
    when b.stage_phase='loading' and b.format='elos.eobra.snapshot.parts.v1' and received<b.expected_parts then 'upload_part'
    when b.stage_phase='loading' and loaded<b.expected_records then 'append' when b.stage_phase='loading' then 'finish_append' when b.stage_phase='validating' and checked<b.expected_records then 'validate' else 'seal' end;
  return jsonb_build_object('run_id',b.id,'status',b.status,'stage',b.stage_phase,'transport',case b.format when 'elos.eobra.snapshot.parts.v1' then 'parts' else 'document' end,
    'expected_records',b.expected_records,'loaded_records',loaded,'validated_records',checked,'promoted_records',done,'remaining_records',b.expected_records-done,
    'expected_parts',b.expected_parts,'uploaded_parts',received,'next_part_ordinal',case when received<b.expected_parts then received+1 end,
    'expected_source_bytes',b.expected_source_bytes,'uploaded_source_bytes',received_bytes,
    'next_step',next_action,'preview_hash',b.preview_hash,'summary',b.summary,'promotion_result',b.promotion_result);
end; $$;

-- The guarded transition derives the summary once and feeds that exact value
-- into the preview hash. A caller-supplied summary is never persisted.
create or replace function public.eobra_snapshot_preview_hash_for_summary(p_run_id uuid,p_summary jsonb)
returns text language sql stable security invoker set search_path=pg_catalog,public
as $$ select public.eobra_import_hash(jsonb_build_object('snapshot',b.snapshot_hash,'project_map',b.project_map,'summary',p_summary,
  'records',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'hash',r.record_hash,'errors',r.errors,'warnings',r.warnings,'status',r.review_status,'expected',r.expected_targets) order by r.entity,r.archive_type,r.source_id) from public.eobra_migration_records r where r.run_id=b.id),'[]'::jsonb),
  'coverage',coalesce((select jsonb_agg(jsonb_build_object('declared',c.declared,'actual',c.actual_count,'verified',c.verified,'errors',c.errors) order by c.entity,c.source_project_id,c.archive_type) from public.eobra_migration_coverage c where c.run_id=b.id),'[]'::jsonb)))
  from public.eobra_migration_runs b where b.id=p_run_id; $$;

create or replace function public.eobra_snapshot_preview_hash(p_run_id uuid)
returns text language sql stable security invoker set search_path=pg_catalog,public
as $$ select public.eobra_snapshot_preview_hash_for_summary(p_run_id,public.eobra_snapshot_summary(p_run_id)); $$;

create or replace function public.eobra_snapshot_guard_run()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare s jsonb;perms text[];begin
  if not public.eobra_snapshot_authorized(new.company_id,new.required_permissions) or not public.eobra_snapshot_projects_visible(new.company_id,new.project_map) then raise exception 'Permissões de empresa, obras e módulos são obrigatórias.';end if;
  if tg_op='INSERT' then
    if new.format='elos.eobra.snapshot.parts.v1' then
      perform public.eobra_snapshot_assert_storage_path(new.company_id,auth.uid(),new.source_storage_path);
      select array_agg(permission order by permission) into perms from unnest(public.eobra_snapshot_permissions('raw_archive','{}')) permission;
      if new.required_permissions is distinct from perms or new.expected_parts<1 or new.expected_source_bytes<1 then raise exception 'Permissões e contagens explícitas são obrigatórias para partes.';end if;
    elsif new.source_storage_path is not null or new.expected_parts<>0 or new.expected_source_bytes<>0 then raise exception 'Metadados de transporte divergentes.';end if;
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
      s:=public.eobra_snapshot_summary(new.id);new.summary:=s;new.preview_hash:=public.eobra_snapshot_preview_hash_for_summary(new.id,s);
      new.status:=case when s->'coverage_complete'='true'::jsonb and (s->>'blocked')::int+(s->>'conflicts')::int=0 then 'ready' else 'review' end;
    elsif old.status='ready' and new.status='promoting' and new.stage_phase='sealed' then
      s:=public.eobra_snapshot_summary(old.id);
      if old.preview_hash is null or old.preview_hash is distinct from public.eobra_snapshot_preview_hash_for_summary(old.id,s) or old.summary is distinct from s then raise exception 'A revisão mudou; confira novamente os vínculos, totais e cobertura.';end if;
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

create or replace function public.seal_eobra_snapshot(p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;begin
  select * into b from public.eobra_migration_runs where id=p_run_id for update;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.';end if;
  if b.status<>'building' then return public.review_eobra_snapshot(b.id);end if;
  if b.stage_phase<>'validating' or (select count(*) from public.eobra_migration_records where run_id=b.id and validated)<>b.expected_records then raise exception 'Ainda existem registros não conferidos.';end if;
  update public.eobra_migration_coverage set verified=true where run_id=b.id;
  update public.eobra_migration_runs set stage_phase='sealed',status='ready' where id=b.id;
  return public.review_eobra_snapshot(b.id);
end; $$;

do $$ declare f record;begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in(
    'eobra_snapshot_assert_storage_path','eobra_snapshot_assert_parts_manifest','eobra_snapshot_evidence_hash','eobra_snapshot_guard_part','eobra_snapshot_guard_part_record',
    'eobra_snapshot_materialize_part','begin_eobra_snapshot_parts','append_eobra_snapshot_part','eobra_snapshot_preview_hash_for_summary') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end; $$;
comment on table public.eobra_migration_snapshot_parts is 'Immutable bounded source text with exact UTF-8 SHA-256 and database-derived per-record receipts. Parts are never concatenated in PostgreSQL.';
comment on column public.eobra_migration_snapshots.document is 'Immutable semantic snapshot document for legacy transport, or the bounded manifest for multipart transport; raw parts remain in eobra_migration_snapshot_parts.';
comment on column public.eobra_migration_runs.source_storage_path is 'Immutable manifest path in the private eobra-migration-bundles bucket; continuation is authorized by company and native permissions, not by original operator.';
commit;
