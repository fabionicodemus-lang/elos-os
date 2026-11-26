-- Native unit identity must be reviewed explicitly. Source labels may differ
-- from an existing catalog; neither a prefix nor an absent exact match proves
-- that a new physical unit should be created.
begin;

alter table public.eobra_migration_runs
  add column unit_map jsonb not null default '{}' check(jsonb_typeof(unit_map)='object'),
  add column unit_target_evidence jsonb not null default '{}' check(jsonb_typeof(unit_target_evidence)='object'),
  add column unit_map_confirmed_at timestamptz,
  add column unit_map_confirmed_by uuid references auth.users(id),
  add constraint eobra_unit_map_confirmation_check check((unit_map_confirmed_at is null)=(unit_map_confirmed_by is null));

create unique index eobra_migration_ledger_unit_target_idx
  on public.eobra_migration_ledger(company_id,source_host,(targets->>'units'))
  where entity='unit' and targets ? 'units';

create or replace function public.eobra_snapshot_unit_identity(p_unit_id uuid,p_company_id uuid,p_project_id uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public
as $$ select to_jsonb(u)-array['status','created_at','updated_at','created_by']
  from public.units u join public.projects p on p.id=u.project_id and p.company_id=u.company_id
  where u.id=p_unit_id and u.company_id=p_company_id and u.project_id=p_project_id; $$;

create or replace function public.eobra_snapshot_unit_options(
  p_run_id uuid,p_project_id uuid,p_search text default null,p_limit integer default 50,p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;items jsonb;total bigint;begin
  select * into b from public.eobra_migration_runs where id=p_run_id;
  if b.id is null or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions)
    or not public.eobra_snapshot_projects_visible(b.company_id,b.project_map)
    or not exists(select 1 from jsonb_each_text(b.project_map) m where public.eobra_import_uuid(m.value)=p_project_id) then
    raise exception 'Obra e migração indisponíveis para conciliar unidades.' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 or length(coalesce(p_search,''))>200 then
    raise exception 'Paginação ou busca de unidades inválida.';
  end if;
  select count(*) into total from public.units u
    where u.company_id=b.company_id and u.project_id=p_project_id
      and (nullif(btrim(p_search),'') is null or u.code ilike '%'||btrim(p_search)||'%');
  select coalesce(jsonb_agg(item order by code,id),'[]'::jsonb) into items from (
    select u.code,u.id,jsonb_build_object('id',u.id,'project_id',u.project_id,'code',u.code,'status',u.status,
      'type',to_jsonb(u)->'type','private_area',to_jsonb(u)->'private_area','total_area',to_jsonb(u)->'total_area',
      'source_system',u.source_system,
      'identity_hash',public.eobra_import_hash(to_jsonb(u)-array['status','created_at','updated_at','created_by'])) item
    from public.units u where u.company_id=b.company_id and u.project_id=p_project_id
      and (nullif(btrim(p_search),'') is null or u.code ilike '%'||btrim(p_search)||'%')
    order by u.code,u.id limit p_limit offset p_offset
  ) selected;
  return jsonb_build_object('items',items,'total',total,'limit',p_limit,'offset',p_offset);
end; $$;

-- The hash supplied with a reuse choice binds confirmation to the physical
-- catalog version displayed by the options RPC, not a newly read silent target.
create or replace function public.eobra_snapshot_unit_map_evidence(p_run_id uuid,p_map jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;r public.eobra_migration_records%rowtype;u public.units%rowtype;
  m record;identity jsonb;result jsonb:='{}';unit_count integer;prior public.eobra_migration_ledger%rowtype;
begin
  select * into b from public.eobra_migration_runs where id=p_run_id;
  if b.id is null or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions)
    or not public.eobra_snapshot_projects_visible(b.company_id,b.project_map) then raise exception 'Migração indisponível para conciliar unidades.' using errcode='42501';end if;
  if jsonb_typeof(p_map) is distinct from 'object' or octet_length(p_map::text)>3145728 then raise exception 'De-para de unidades inválido ou superior a 3 MiB.';end if;
  select count(*) into unit_count from public.eobra_migration_records where run_id=b.id and entity='unit';
  if (select count(*) from jsonb_object_keys(p_map))<>unit_count
    or exists(select 1 from public.eobra_migration_records where run_id=b.id and entity='unit' group by source_id having count(*)>1)
    or exists(select 1 from jsonb_object_keys(p_map) key where not exists(select 1 from public.eobra_migration_records rec where rec.run_id=b.id and rec.entity='unit' and rec.source_id=key))
    or exists(select 1 from public.eobra_migration_records rec where rec.run_id=b.id and rec.entity='unit' and not p_map ? rec.source_id) then
    raise exception 'Confirme uma decisão explícita para cada unidade de origem, sem IDs extras ou repetidos.';
  end if;
  if exists(select 1 from jsonb_each(p_map) choice_entry where jsonb_typeof(choice_entry.value) is distinct from 'object'
    or coalesce(choice_entry.value->>'action','') not in('reuse','create')
    or (choice_entry.value->>'action'='create' and choice_entry.value-'action'<>'{}'::jsonb)
    or (choice_entry.value->>'action'='reuse' and (choice_entry.value-array['action','unit_id','expected_identity_hash']<>'{}'::jsonb
      or jsonb_typeof(choice_entry.value->'unit_id') is distinct from 'string'
      or jsonb_typeof(choice_entry.value->'expected_identity_hash') is distinct from 'string'
      or public.eobra_import_uuid(choice_entry.value->>'unit_id') is null or coalesce(choice_entry.value->>'expected_identity_hash','') !~ '^[0-9a-f]{64}$'))) then
    raise exception 'Escolha criar uma nova unidade ou reutilizar uma unidade com o hash exibido na revisão.';
  end if;
  if exists(select 1 from jsonb_each(p_map) choice_entry where choice_entry.value->>'action'='reuse' group by public.eobra_import_uuid(choice_entry.value->>'unit_id') having count(*)>1) then
    raise exception 'IDs distintos da origem não podem reutilizar a mesma unidade do Elos.';
  end if;
  for m in select key,value from jsonb_each(p_map) order by value->>'unit_id' nulls last,key loop
    select * into r from public.eobra_migration_records where run_id=b.id and entity='unit' and source_id=m.key;
    if r.project_id is null or not exists(select 1 from public.projects where id=r.project_id and company_id=b.company_id) then raise exception 'Unidade sem obra confirmada no de-para.';end if;
    select * into prior from public.eobra_migration_ledger where company_id=b.company_id and source_host=b.source_host and entity='unit' and archive_type='' and source_id=r.source_id;
    if m.value->>'action'='create' then
      if prior.id is not null then raise exception 'Esta unidade de origem já possui destino; reutilize a identidade importada.';end if;
      if exists(select 1 from public.units where company_id=b.company_id and project_id=r.project_id and code=r.normalized_data->>'code') then
        raise exception 'Já existe unidade com este código na obra; confira o cadastro existente antes de criar.';
      end if;
      continue;
    end if;
    select native.* into u from public.units native join public.projects p on p.id=native.project_id and p.company_id=native.company_id
      where native.id=public.eobra_import_uuid(m.value->>'unit_id') and native.company_id=b.company_id and native.project_id=r.project_id for share of native;
    if u.id is null then raise exception 'Unidade escolhida pertence a outra empresa/obra ou está indisponível.';end if;
    identity:=to_jsonb(u)-array['status','created_at','updated_at','created_by'];
    if public.eobra_import_hash(identity) is distinct from m.value->>'expected_identity_hash' then raise exception 'O cadastro da unidade mudou desde a exibição; atualize as opções e confira novamente.';end if;
    if prior.id is not null and public.eobra_import_uuid(prior.targets->>'units') is distinct from u.id then raise exception 'O destino escolhido diverge da identidade já importada.';end if;
    if exists(select 1 from public.eobra_migration_ledger l where l.company_id=b.company_id and l.source_host=b.source_host and l.entity='unit' and l.source_id<>r.source_id and l.targets->>'units'=u.id::text) then
      raise exception 'Esta unidade do Elos já representa outro ID da origem.';
    end if;
    result:=result||jsonb_build_object(r.source_id,jsonb_build_object('identity',identity,'reviewed_status',u.status));
  end loop;
  return result;
end; $$;

create or replace function public.eobra_snapshot_unit_mapping_errors(p_record_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;choice jsonb;identity jsonb;target uuid;e jsonb:='[]';begin
  select * into r from public.eobra_migration_records where id=p_record_id;
  select * into b from public.eobra_migration_runs where id=r.run_id;
  if r.id is null or r.entity<>'unit' then return jsonb_build_array('Unidade de origem indisponível.');end if;
  if b.unit_map_confirmed_at is null then return jsonb_build_array('Confirme o de-para de unidades antes de validar o pacote.');end if;
  choice:=b.unit_map->r.source_id;
  if choice->>'action'='reuse' then
    target:=public.eobra_import_uuid(choice->>'unit_id');
    identity:=public.eobra_snapshot_unit_identity(target,b.company_id,r.project_id);
    if identity is null or identity is distinct from b.unit_target_evidence->r.source_id->'identity' then
      e:=e||jsonb_build_array('Cadastro físico da unidade alterado ou indisponível após a confirmação; prepare nova revisão.');
    end if;
    if exists(select 1 from public.eobra_migration_ledger l where l.company_id=b.company_id and l.source_host=b.source_host and l.entity='unit' and l.source_id<>r.source_id and l.targets->>'units'=target::text) then
      e:=e||jsonb_build_array('Unidade do Elos já vinculada a outro ID da origem; o de-para não pode ser reutilizado.');
    end if;
    -- A prior active sale is acceptable only when it is the same already
    -- imported source sale. A new source contract must not claim that unit.
    if exists(
      select 1 from public.eobra_migration_relations rel join public.eobra_migration_records sale on sale.id=rel.record_id
      where rel.run_id=b.id and rel.role='unit' and rel.target_entity='unit' and rel.target_source_id=r.source_id
        and sale.entity='sale' and sale.normalized_data->>'status'='active'
        and exists(
          select 1 from public.sales native_sale where native_sale.company_id=b.company_id and native_sale.project_id=r.project_id and native_sale.status='active'
            and (native_sale.unit_id=target or exists(select 1 from public.commercial_sale_units su where su.sale_id=native_sale.id and su.unit_id=target and su.status='active'))
            and not exists(select 1 from public.eobra_migration_ledger sl where sl.company_id=b.company_id and sl.source_host=b.source_host and sl.entity='sale' and sl.source_id=sale.source_id and sl.targets->>'sales'=native_sale.id::text)
        )
    ) then e:=e||jsonb_build_array('Unidade já vinculada a outra venda ativa no Elos; resolva o conflito antes de promover.');end if;
  elsif choice->>'action'<>'create' or choice is null then e:=e||jsonb_build_array('Unidade sem decisão explícita válida.');end if;
  return e;
end; $$;

create or replace function public.confirm_eobra_snapshot_unit_map(p_run_id uuid,p_unit_map jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;begin
  select * into b from public.eobra_migration_runs where id=p_run_id for update;
  if b.id is null or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions)
    or not public.eobra_snapshot_projects_visible(b.company_id,b.project_map) then raise exception 'Migração indisponível ou sem permissão.' using errcode='42501';end if;
  if b.unit_map_confirmed_at is not null then
    if p_unit_map is distinct from b.unit_map then raise exception 'De-para confirmado é imutável; prepare nova revisão para alterar a decisão.';end if;
    return public.eobra_snapshot_progress(b.id);
  end if;
  if b.status<>'building' or b.stage_phase<>'validating' or exists(select 1 from public.eobra_migration_records where run_id=b.id and validated) then
    raise exception 'Confirme as unidades após carregar o pacote e antes de validar qualquer registro.';
  end if;
  update public.eobra_migration_runs set unit_map=p_unit_map,unit_map_confirmed_at=now() where id=b.id;
  return public.eobra_snapshot_progress(b.id);
end; $$;

create or replace function public.eobra_snapshot_unit_decision_gate()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;begin
  if not new.validated then return new;end if;
  select * into b from public.eobra_migration_runs where id=new.run_id;
  if b.unit_map_confirmed_at is null and (new.entity='unit' or exists(select 1 from public.eobra_migration_records where run_id=b.id and entity='unit')) then
    raise exception 'Confirme o de-para de todas as unidades antes de validar registros.';
  end if;
  if new.promoted and new.entity='unit' then
    -- Duplicate ledger entries also represent a reviewed native target. A replay
    -- must not silently approve a catalog change made after this run's preview.
    perform public.eobra_snapshot_assert_native_target(new.id,'units',public.eobra_import_uuid(new.canonical_targets->>'units'));
  end if;
  return new;
end; $$;
create trigger z_eobra_snapshot_unit_decision_gate before insert or update on public.eobra_migration_records
  for each row execute function public.eobra_snapshot_unit_decision_gate();


create or replace function public.eobra_snapshot_expected_targets(p_record_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare r public.eobra_migration_records%rowtype;b public.eobra_migration_runs%rowtype;v text;target uuid;n integer;result jsonb:='{}';begin
  select * into r from public.eobra_migration_records where id=p_record_id;
  if r.entity='project' and r.project_id is not null then return jsonb_build_object('projects',r.project_id);end if;
  if r.entity='unit' then
    select * into b from public.eobra_migration_runs where id=r.run_id;
    if b.unit_map_confirmed_at is not null and b.unit_map->r.source_id->>'action'='reuse' then
      return jsonb_build_object('units',public.eobra_import_uuid(b.unit_map->r.source_id->>'unit_id'));
    end if;
  end if;
  if r.entity<>'person' then return result;end if;
  v:=nullif(regexp_replace(coalesce(r.normalized_data->>'tax_id',''),'[^0-9]','','g'),'');
  if v is null then return result;end if;
  if r.normalized_data->'roles' ? 'client' then
    select count(*),min(id::text)::uuid into n,target from public.clients where company_id=r.company_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=v;
    if n=1 then result:=result||jsonb_build_object('clients',target);end if;
  end if;
  if r.normalized_data->'roles' ? 'supplier' then
    select count(*),min(id::text)::uuid into n,target from public.suppliers where company_id=r.company_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=v;
    if n=1 then result:=result||jsonb_build_object('suppliers',target);end if;
  end if;
  return result;
end; $$;

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
    if nullif(btrim(d->>'name'),'') is null or coalesce(d->>'status','') not in('active','inactive') or coalesce(d->>'currency','')<>'BRL' then e:=e||jsonb_build_array('Conta de origem sem identificação, moeda BRL ou situação válida.');end if;
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

create or replace function public.eobra_snapshot_guard_run()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare s jsonb;perms text[];begin
  if not public.eobra_snapshot_authorized(new.company_id,new.required_permissions) or not public.eobra_snapshot_projects_visible(new.company_id,new.project_map) then raise exception 'Permissões de empresa, obras e módulos são obrigatórias.';end if;
  if new.status in('ready','promoting','imported') and new.unit_map_confirmed_at is null
    and exists(select 1 from public.eobra_migration_records where run_id=new.id and entity='unit') then
    raise exception 'Confirme o de-para de unidades antes de concluir a revisão ou promover.';
  end if;
  if tg_op='INSERT' then
    new.unit_map:='{}';new.unit_target_evidence:='{}';new.unit_map_confirmed_at:=null;new.unit_map_confirmed_by:=null;
    if new.format='elos.eobra.snapshot.parts.v1' then
      perform public.eobra_snapshot_assert_storage_path(new.company_id,auth.uid(),new.source_storage_path);
      select array_agg(permission order by permission) into perms from unnest(public.eobra_snapshot_permissions('raw_archive','{}')) permission;
      if new.required_permissions is distinct from perms or new.expected_parts<1 or new.expected_source_bytes<1 then raise exception 'Permissões e contagens explícitas são obrigatórias para partes.';end if;
    elsif new.source_storage_path is not null or new.expected_parts<>0 or new.expected_source_bytes<>0 then raise exception 'Metadados de transporte divergentes.';end if;
    if new.status<>'building' or new.stage_phase<>'loading' or new.promotion_result is not null or new.project_id is not null or new.expected_records<1 then raise exception 'Snapshot deve iniciar em carga, com contagem explícita.';end if;
    new.created_by:=auth.uid();new.created_at:=now();new.summary:='{}';new.preview_hash:=null;new.promotion_started_by:=null;new.promotion_started_at:=null;
  else
    if old.unit_map_confirmed_at is null and new.unit_map_confirmed_at is not null then
      if old.status<>'building' or old.stage_phase<>'validating'
        or exists(select 1 from public.eobra_migration_records where run_id=old.id and validated)
        or (to_jsonb(new)-array['unit_map','unit_target_evidence','unit_map_confirmed_at','unit_map_confirmed_by','updated_at'])
          is distinct from (to_jsonb(old)-array['unit_map','unit_target_evidence','unit_map_confirmed_at','unit_map_confirmed_by','updated_at']) then
        raise exception 'O de-para só pode ser confirmado após carregar o pacote e antes da validação.';
      end if;
      new.unit_target_evidence:=public.eobra_snapshot_unit_map_evidence(old.id,new.unit_map);
      new.unit_map_confirmed_at:=now();new.unit_map_confirmed_by:=auth.uid();new.updated_at:=now();
      return new;
    end if;
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

create or replace function public.eobra_snapshot_progress(p_run_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;loaded integer;checked integer;done integer;unit_count integer;received integer:=0;received_bytes bigint:=0;next_action text;begin
  select * into b from public.eobra_migration_runs where id=p_run_id;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.' using errcode='42501';end if;
  select count(*),count(*) filter(where validated),count(*) filter(where promoted),count(*) filter(where entity='unit') into loaded,checked,done,unit_count from public.eobra_migration_records where run_id=b.id;
  if b.format='elos.eobra.snapshot.parts.v1' then select count(*),coalesce(sum(byte_length),0) into received,received_bytes from public.eobra_migration_snapshot_parts where run_id=b.id;end if;
  next_action:=case when b.status='imported' then 'complete' when b.status in('review','cancelled') then 'blocked' when b.status in('ready','promoting') then case when unit_count>0 and b.unit_map_confirmed_at is null then 'blocked' else 'promote' end
    when b.stage_phase='loading' and b.format='elos.eobra.snapshot.parts.v1' and received<b.expected_parts then 'upload_part'
    when b.stage_phase='loading' and loaded<b.expected_records then 'append' when b.stage_phase='loading' then 'finish_append' when b.stage_phase='validating' and unit_count>0 and b.unit_map_confirmed_at is null then 'map_units' when b.stage_phase='validating' and checked<b.expected_records then 'validate' else 'seal' end;
  return jsonb_build_object('run_id',b.id,'status',b.status,'stage',b.stage_phase,'transport',case b.format when 'elos.eobra.snapshot.parts.v1' then 'parts' else 'document' end,
    'expected_records',b.expected_records,'loaded_records',loaded,'validated_records',checked,'promoted_records',done,'remaining_records',b.expected_records-done,
    'expected_parts',b.expected_parts,'uploaded_parts',received,'next_part_ordinal',case when received<b.expected_parts then received+1 end,
    'expected_source_bytes',b.expected_source_bytes,'uploaded_source_bytes',received_bytes,
    'unit_records',unit_count,'units_requiring_decision',case when b.unit_map_confirmed_at is null then unit_count else 0 end,'unit_map_confirmed',b.unit_map_confirmed_at is not null,
    'next_step',next_action,'preview_hash',b.preview_hash,'summary',b.summary,'promotion_result',b.promotion_result);
end; $$;

create or replace function public.validate_eobra_snapshot_chunk(p_run_id uuid,p_limit integer default 100)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare b public.eobra_migration_runs%rowtype;begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Confira entre 1 e 100 registros por chamada.';end if;
  select * into b from public.eobra_migration_runs where id=p_run_id for update;
  if not found or not public.eobra_snapshot_authorized(b.company_id,b.required_permissions) then raise exception 'Snapshot indisponível ou sem permissão.';end if;
  if b.status<>'building' or b.stage_phase<>'validating' then return public.eobra_snapshot_progress(b.id);end if;
  if b.unit_map_confirmed_at is null and exists(select 1 from public.eobra_migration_records where run_id=b.id and entity='unit') then
    raise exception 'Confirme o de-para de todas as unidades antes de validar registros.';
  end if;
  update public.eobra_migration_records set validated=true where id in(select id from public.eobra_migration_records where run_id=b.id and not validated order by source_ordinal limit p_limit);
  return public.eobra_snapshot_progress(b.id);
end; $$;

create or replace function public.eobra_snapshot_preview_hash_for_summary(p_run_id uuid,p_summary jsonb)
returns text language sql stable security invoker set search_path=pg_catalog,public
as $$ select public.eobra_import_hash(jsonb_build_object('snapshot',b.snapshot_hash,'project_map',b.project_map,'unit_map',b.unit_map,'unit_target_evidence',b.unit_target_evidence,'summary',p_summary,
  'records',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'hash',r.record_hash,'errors',r.errors,'warnings',r.warnings,'status',r.review_status,'expected',r.expected_targets) order by r.entity,r.archive_type,r.source_id) from public.eobra_migration_records r where r.run_id=b.id),'[]'::jsonb),
  'coverage',coalesce((select jsonb_agg(jsonb_build_object('declared',c.declared,'actual',c.actual_count,'verified',c.verified,'errors',c.errors) order by c.entity,c.source_project_id,c.archive_type) from public.eobra_migration_coverage c where c.run_id=b.id),'[]'::jsonb)))
  from public.eobra_migration_runs b where b.id=p_run_id; $$;

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
  elsif r.entity='unit' and r.expected_targets ? 'units' then
    if p_target_id is distinct from public.eobra_import_uuid(r.expected_targets->>'units')
      or public.eobra_snapshot_expected_targets(r.id) is distinct from r.expected_targets
      or (native-array['status','created_at','updated_at','created_by']) is distinct from b.unit_target_evidence->r.source_id->'identity' then
      raise exception 'Cadastro físico da unidade reutilizada mudou após a confirmação; prepare nova revisão.';
    end if;
  elsif r.entity='unit' then
    expected:=public.eobra_snapshot_native_payload(r.id,'units')-array['created_by','status'];
    if not native @> expected or native->>'source_system' is distinct from 'eobra_snapshot' or native->>'source_id' is distinct from b.source_host||'|unit|'||r.source_id or native->>'code' is distinct from r.normalized_data->>'code' then raise exception 'Identidade da unidade foi alterada após a revisão.';end if;
  else
    expected:=public.eobra_snapshot_native_payload(r.id,p_table)-'created_by';
    if not native @> expected or r.entity in('receivable','payable') and (native->>'adjusted_amount')::numeric is distinct from public.eobra_import_money(r.normalized_data->>'current_amount') then raise exception 'Vínculos ou valores da dependência % mudaram após a revisão.',r.entity;end if;
  end if;
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
  if b.unit_map_confirmed_at is null and exists(select 1 from public.eobra_migration_records where run_id=b.id and entity='unit') then raise exception 'De-para de unidades não confirmado.';end if;
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
      elsif k='units' and r.expected_targets ? 'units' then
        perform public.eobra_snapshot_assert_native_target(r.id,'units',target);
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
-- The capability flag only returns a constant and has no object lookup.
-- Pin its path as well so the release does not add a mutable-path advisory.
create or replace function public.eobra_snapshot_multi_unit_supported()
returns boolean language sql immutable security invoker set search_path='' as $$ select true; $$;

do $$ declare f record;begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in('eobra_snapshot_unit_identity','eobra_snapshot_unit_options','eobra_snapshot_unit_map_evidence','eobra_snapshot_unit_mapping_errors','confirm_eobra_snapshot_unit_map','eobra_snapshot_unit_decision_gate') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end; $$;
comment on column public.eobra_migration_runs.unit_map is 'Explicit create/reuse decisions by stable source unit ID, immutable before validation. Never inferred from a label or prefix.';
comment on column public.eobra_migration_runs.unit_target_evidence is 'Database-derived native physical identity as reviewed. Reuse never overwrites the existing unit catalog.';
commit;
