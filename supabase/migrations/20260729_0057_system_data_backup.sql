-- Elos OS — Sistema · Dados & Backup
-- Inventário, exportação lógica privada, integridade e solicitações controladas de restauração.

begin;

insert into public.permissions(key,module,action,description) values
  ('admin.data.view','admin_data','view_data','Visualizar inventário, histórico de exportações e auditoria de dados'),
  ('admin.data.export','admin_data','export_data','Gerar e baixar pacotes de exportação lógica da empresa'),
  ('admin.data.restore','admin_data','restore_data','Solicitar e revisar procedimentos controlados de restauração'),
  ('admin.data.manage','admin_data','manage_data','Gerenciar retenção e excluir pacotes de backup')
on conflict(key) do update set
  module=excluded.module,
  action=excluded.action,
  description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true
from public.roles r
cross join (values
  ('admin.data.view'),('admin.data.export'),('admin.data.restore'),('admin.data.manage')
) p(permission_key)
where r.key in ('owner','admin')
on conflict(role_id,permission_key) do update set allowed=true;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true
from public.roles r
cross join (values ('admin.data.view'),('admin.data.export')) p(permission_key)
where r.key='director'
on conflict(role_id,permission_key) do update set allowed=true;

create table if not exists public.system_data_exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete restrict,
  scope_type text not null default 'company' check (scope_type in ('company','project')),
  modules text[] not null default '{}',
  format text not null default 'json' check (format in ('json','xlsx')),
  status text not null default 'processing' check (status in ('processing','ready','failed','expired','deleted')),
  storage_path text,
  file_name text,
  mime_type text,
  file_size bigint,
  checksum_sha256 text,
  table_count integer not null default 0,
  row_count bigint not null default 0,
  download_count integer not null default 0,
  last_downloaded_at timestamptz,
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now()+interval '30 days'),
  deleted_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  check ((scope_type='company' and project_id is null) or (scope_type='project' and project_id is not null)),
  check (file_size is null or file_size>=0),
  check (table_count>=0 and row_count>=0 and download_count>=0)
);

create index if not exists system_data_exports_company_idx
  on public.system_data_exports(company_id,requested_at desc);
create index if not exists system_data_exports_project_idx
  on public.system_data_exports(project_id,requested_at desc) where project_id is not null;
create index if not exists system_data_exports_status_idx
  on public.system_data_exports(company_id,status,expires_at);

create table if not exists public.system_data_restore_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete restrict,
  export_id uuid not null references public.system_data_exports(id) on delete restrict,
  status text not null default 'pending_review' check (status in ('pending_review','approved_for_manual_restore','rejected','cancelled','completed')),
  reason text not null,
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_notes text,
  completed_at timestamptz,
  completion_notes text,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists system_data_restore_requests_open_uidx
  on public.system_data_restore_requests(export_id)
  where status in ('pending_review','approved_for_manual_restore');
create index if not exists system_data_restore_requests_company_idx
  on public.system_data_restore_requests(company_id,requested_at desc);

create table if not exists public.system_data_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  export_id uuid references public.system_data_exports(id) on delete set null,
  restore_request_id uuid references public.system_data_restore_requests(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists system_data_audit_company_idx
  on public.system_data_audit(company_id,created_at desc);
create index if not exists system_data_audit_export_idx
  on public.system_data_audit(export_id,created_at desc) where export_id is not null;

create or replace function public.system_data_module_for_table(p_table_name text)
returns text
language sql immutable set search_path=public as $$
  select case
    when p_table_name in ('companies','roles','company_memberships','profiles','permissions','role_permissions','project_memberships','system_role_permission_audit')
      or p_table_name like 'system_%' then 'system'
    when p_table_name in ('suppliers','clients') or p_table_name like 'supplier_%' or p_table_name like 'client_%' then 'registries'
    when p_table_name='projects' or p_table_name='units' or p_table_name like 'project_%' or p_table_name like 'legal_%' then 'projects'
    when p_table_name like 'engineering_%' or p_table_name like 'schedule_%' or p_table_name like 'supply_plan_%' then 'engineering'
    when p_table_name like 'execution_%' then 'execution'
    when p_table_name like 'procurement_%' then 'procurement'
    when p_table_name like 'finance_%'
      or p_table_name in ('accounts_payable','accounts_receivable','payables','receivables','correction_indices','correction_index_values','cashflow_entries')
      or p_table_name like 'bank_%' or p_table_name like 'tax_%' then 'finance'
    when p_table_name like 'commercial_%' or p_table_name='sales' or p_table_name like 'sale_%' then 'commercial'
    when p_table_name like 'postwork_%' then 'postwork'
    when p_table_name like 'document_%' or p_table_name like '%_documents' or p_table_name like '%_attachments' then 'documents'
    else 'other'
  end;
$$;

create or replace function public.system_company_data_inventory(
  p_company_id uuid,
  p_project_id uuid default null
)
returns table(table_name text,module_key text,row_count bigint,project_scoped boolean)
language plpgsql stable security definer set search_path=public as $$
declare
  v_record record;
  v_count bigint;
begin
  if not (
    public.has_company_permission(p_company_id,'admin.data.view')
    or public.has_company_permission(p_company_id,'admin.data.export')
    or public.has_company_permission(p_company_id,'admin.data.manage')
    or public.has_company_permission(p_company_id,'admin.data.restore')
  ) then
    raise exception 'Você não possui permissão para visualizar os dados da empresa.';
  end if;

  if p_project_id is not null and not exists(
    select 1 from public.projects p where p.id=p_project_id and p.company_id=p_company_id
  ) then
    raise exception 'Empreendimento inválido.';
  end if;

  for v_record in
    select t.table_name,
      exists(
        select 1 from information_schema.columns c
        where c.table_schema='public' and c.table_name=t.table_name and c.column_name='project_id'
      ) as has_project_id
    from information_schema.tables t
    where t.table_schema='public'
      and t.table_type='BASE TABLE'
      and exists(
        select 1 from information_schema.columns c
        where c.table_schema='public' and c.table_name=t.table_name and c.column_name='company_id'
      )
      and t.table_name not in ('system_data_exports','system_data_restore_requests','system_data_audit')
      and t.table_name not like 'engineering_catalog_cleanup_%'
    order by t.table_name
  loop
    if p_project_id is not null and v_record.has_project_id then
      execute format('select count(*) from public.%I where company_id=$1 and project_id=$2',v_record.table_name)
      into v_count using p_company_id,p_project_id;
    elsif p_project_id is not null and v_record.table_name='projects' then
      execute 'select count(*) from public.projects where company_id=$1 and id=$2'
      into v_count using p_company_id,p_project_id;
    else
      execute format('select count(*) from public.%I where company_id=$1',v_record.table_name)
      into v_count using p_company_id;
    end if;

    table_name:=v_record.table_name;
    module_key:=public.system_data_module_for_table(v_record.table_name);
    row_count:=coalesce(v_count,0);
    project_scoped:=v_record.has_project_id;
    return next;
  end loop;
end;
$$;

create or replace function public.system_build_data_export(
  p_company_id uuid,
  p_project_id uuid default null,
  p_modules text[] default '{}'
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_record record;
  v_company jsonb;
  v_project jsonb;
  v_tables jsonb:='{}'::jsonb;
  v_rows jsonb;
  v_module text;
  v_table_count integer:=0;
  v_row_count bigint:=0;
  v_all_modules boolean:=cardinality(coalesce(p_modules,'{}'::text[]))=0;
  v_special_count integer;
  v_allowed_modules constant text[]:=array['system','registries','projects','engineering','execution','procurement','finance','commercial','postwork','documents','other'];
begin
  if not public.has_company_permission(p_company_id,'admin.data.export') then
    raise exception 'Você não possui permissão para exportar os dados da empresa.';
  end if;

  if exists(
    select 1 from unnest(coalesce(p_modules,'{}'::text[])) m
    where m<>all(v_allowed_modules)
  ) then
    raise exception 'A seleção contém um módulo inválido.';
  end if;

  select to_jsonb(c) into v_company from public.companies c where c.id=p_company_id;
  if v_company is null then raise exception 'Empresa não localizada.'; end if;

  if p_project_id is not null then
    select to_jsonb(p) into v_project from public.projects p where p.id=p_project_id and p.company_id=p_company_id;
    if v_project is null then raise exception 'Empreendimento inválido.'; end if;
  end if;

  for v_record in
    select t.table_name,
      exists(
        select 1 from information_schema.columns c
        where c.table_schema='public' and c.table_name=t.table_name and c.column_name='project_id'
      ) as has_project_id
    from information_schema.tables t
    where t.table_schema='public'
      and t.table_type='BASE TABLE'
      and exists(
        select 1 from information_schema.columns c
        where c.table_schema='public' and c.table_name=t.table_name and c.column_name='company_id'
      )
      and t.table_name not in ('system_data_exports','system_data_restore_requests','system_data_audit')
      and t.table_name not like 'engineering_catalog_cleanup_%'
    order by t.table_name
  loop
    v_module:=public.system_data_module_for_table(v_record.table_name);
    if not v_all_modules and not (v_module=any(p_modules)) then continue; end if;

    if p_project_id is not null and v_record.has_project_id then
      execute format(
        'select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from (select * from public.%I where company_id=$1 and project_id=$2) x',
        v_record.table_name
      ) into v_rows using p_company_id,p_project_id;
    elsif p_project_id is not null and v_record.table_name='projects' then
      execute 'select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from (select * from public.projects where company_id=$1 and id=$2) x'
      into v_rows using p_company_id,p_project_id;
    else
      execute format(
        'select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from (select * from public.%I where company_id=$1) x',
        v_record.table_name
      ) into v_rows using p_company_id;
    end if;

    v_tables:=v_tables||jsonb_build_object(v_record.table_name,coalesce(v_rows,'[]'::jsonb));
    v_table_count:=v_table_count+1;
    v_row_count:=v_row_count+jsonb_array_length(coalesce(v_rows,'[]'::jsonb));
  end loop;

  if v_all_modules or 'system'=any(p_modules) then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
    into v_rows
    from (
      select rp.* from public.role_permissions rp
      join public.roles r on r.id=rp.role_id
      where r.company_id=p_company_id
    ) x;
    v_tables:=v_tables||jsonb_build_object('role_permissions',v_rows);
    v_table_count:=v_table_count+1;
    v_row_count:=v_row_count+jsonb_array_length(v_rows);

    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
    into v_rows
    from (
      select distinct pr.* from public.profiles pr
      join public.company_memberships cm on cm.user_id=pr.id
      where cm.company_id=p_company_id
    ) x;
    v_tables:=v_tables||jsonb_build_object('profiles',v_rows);
    v_table_count:=v_table_count+1;
    v_row_count:=v_row_count+jsonb_array_length(v_rows);

    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
    into v_rows
    from (
      select pm.* from public.project_memberships pm
      join public.projects p on p.id=pm.project_id
      where p.company_id=p_company_id
        and (p_project_id is null or p.id=p_project_id)
    ) x;
    v_tables:=v_tables||jsonb_build_object('project_memberships',v_rows);
    v_table_count:=v_table_count+1;
    v_row_count:=v_row_count+jsonb_array_length(v_rows);

    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
    into v_rows
    from (select * from public.permissions order by key) x;
    v_tables:=v_tables||jsonb_build_object('permissions',v_rows);
    v_table_count:=v_table_count+1;
    v_row_count:=v_row_count+jsonb_array_length(v_rows);
  end if;

  return jsonb_build_object(
    'schema_version','elos-os-logical-backup-v1',
    'generated_at',now(),
    'company',v_company,
    'project',v_project,
    'scope',case when p_project_id is null then 'company' else 'project' end,
    'modules',coalesce(p_modules,'{}'::text[]),
    'table_count',v_table_count,
    'row_count',v_row_count,
    'tables',v_tables,
    'warnings',jsonb_build_array(
      'Este pacote contém os registros lógicos do banco de dados.',
      'Arquivos binários armazenados em buckets privados não são incorporados ao arquivo; seus metadados e caminhos permanecem nas tabelas exportadas.',
      'A restauração deve ser validada e executada por procedimento controlado.'
    )
  );
end;
$$;

create or replace function public.system_create_data_export(
  p_company_id uuid,
  p_project_id uuid,
  p_scope_type text,
  p_modules text[],
  p_format text,
  p_retention_days integer default 30
)
returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_id uuid;
  v_allowed_modules constant text[]:=array['system','registries','projects','engineering','execution','procurement','finance','commercial','postwork','documents','other'];
begin
  if not public.has_company_permission(p_company_id,'admin.data.export') then
    raise exception 'Você não possui permissão para gerar exportações.';
  end if;
  if p_scope_type not in ('company','project') then raise exception 'Escopo inválido.'; end if;
  if p_scope_type='company' and p_project_id is not null then raise exception 'O backup da empresa não deve selecionar um empreendimento.'; end if;
  if p_scope_type='project' and p_project_id is null then raise exception 'Selecione o empreendimento.'; end if;
  if p_project_id is not null and not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id) then
    raise exception 'Empreendimento inválido.';
  end if;
  if p_format not in ('json','xlsx') then raise exception 'Formato inválido.'; end if;
  if coalesce(p_retention_days,0) not between 1 and 365 then raise exception 'A retenção deve ficar entre 1 e 365 dias.'; end if;
  if exists(select 1 from unnest(coalesce(p_modules,'{}'::text[])) m where m<>all(v_allowed_modules)) then
    raise exception 'A seleção contém um módulo inválido.';
  end if;

  insert into public.system_data_exports(
    company_id,project_id,scope_type,modules,format,status,requested_by,expires_at
  ) values(
    p_company_id,p_project_id,p_scope_type,coalesce(p_modules,'{}'::text[]),p_format,'processing',auth.uid(),now()+make_interval(days=>p_retention_days)
  ) returning id into v_id;

  insert into public.system_data_audit(company_id,project_id,export_id,action,details,actor_id)
  values(p_company_id,p_project_id,v_id,'export_requested',jsonb_build_object('scope',p_scope_type,'format',p_format,'modules',coalesce(p_modules,'{}'::text[]),'retention_days',p_retention_days),auth.uid());

  return v_id;
end;
$$;

create or replace function public.system_complete_data_export(
  p_export_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_checksum_sha256 text,
  p_table_count integer,
  p_row_count bigint,
  p_metadata jsonb default '{}'
)
returns void
language plpgsql security definer set search_path=public as $$
declare
  v_export public.system_data_exports%rowtype;
begin
  select * into v_export from public.system_data_exports where id=p_export_id for update;
  if v_export.id is null then raise exception 'Exportação não localizada.'; end if;
  if not public.has_company_permission(v_export.company_id,'admin.data.export') then raise exception 'Sem permissão para concluir a exportação.'; end if;
  if v_export.status<>'processing' then raise exception 'A exportação não está em processamento.'; end if;
  if nullif(trim(coalesce(p_storage_path,'')),'') is null or nullif(trim(coalesce(p_file_name,'')),'') is null then raise exception 'Arquivo inválido.'; end if;

  update public.system_data_exports
  set status='ready',storage_path=p_storage_path,file_name=p_file_name,mime_type=p_mime_type,
      file_size=p_file_size,checksum_sha256=p_checksum_sha256,table_count=p_table_count,row_count=p_row_count,
      metadata=coalesce(p_metadata,'{}'::jsonb),completed_at=now(),error_message=null
  where id=p_export_id;

  insert into public.system_data_audit(company_id,project_id,export_id,action,details,actor_id)
  values(v_export.company_id,v_export.project_id,p_export_id,'export_completed',
    jsonb_build_object('file_name',p_file_name,'file_size',p_file_size,'checksum_sha256',p_checksum_sha256,'table_count',p_table_count,'row_count',p_row_count),auth.uid());
end;
$$;

create or replace function public.system_fail_data_export(p_export_id uuid,p_error_message text)
returns void
language plpgsql security definer set search_path=public as $$
declare
  v_export public.system_data_exports%rowtype;
begin
  select * into v_export from public.system_data_exports where id=p_export_id for update;
  if v_export.id is null then return; end if;
  if not public.has_company_permission(v_export.company_id,'admin.data.export') then raise exception 'Sem permissão para atualizar a exportação.'; end if;
  update public.system_data_exports set status='failed',error_message=left(coalesce(p_error_message,'Falha desconhecida.'),2000),completed_at=now() where id=p_export_id;
  insert into public.system_data_audit(company_id,project_id,export_id,action,details,actor_id)
  values(v_export.company_id,v_export.project_id,p_export_id,'export_failed',jsonb_build_object('error',left(coalesce(p_error_message,'Falha desconhecida.'),2000)),auth.uid());
end;
$$;

create or replace function public.system_log_data_export_download(p_export_id uuid)
returns void
language plpgsql security definer set search_path=public as $$
declare
  v_export public.system_data_exports%rowtype;
begin
  select * into v_export from public.system_data_exports where id=p_export_id for update;
  if v_export.id is null then raise exception 'Exportação não localizada.'; end if;
  if not (
    public.has_company_permission(v_export.company_id,'admin.data.view')
    or public.has_company_permission(v_export.company_id,'admin.data.export')
    or public.has_company_permission(v_export.company_id,'admin.data.manage')
  ) then raise exception 'Sem permissão para baixar a exportação.'; end if;
  if v_export.status<>'ready' or v_export.expires_at<=now() then raise exception 'O arquivo não está disponível.'; end if;
  update public.system_data_exports set download_count=download_count+1,last_downloaded_at=now() where id=p_export_id;
  insert into public.system_data_audit(company_id,project_id,export_id,action,details,actor_id)
  values(v_export.company_id,v_export.project_id,p_export_id,'export_downloaded',jsonb_build_object('file_name',v_export.file_name),auth.uid());
end;
$$;

create or replace function public.system_mark_data_export_deleted(p_export_id uuid)
returns void
language plpgsql security definer set search_path=public as $$
declare
  v_export public.system_data_exports%rowtype;
begin
  select * into v_export from public.system_data_exports where id=p_export_id for update;
  if v_export.id is null then raise exception 'Exportação não localizada.'; end if;
  if not public.has_company_permission(v_export.company_id,'admin.data.manage') then raise exception 'Sem permissão para excluir pacotes.'; end if;
  if exists(select 1 from public.system_data_restore_requests where export_id=p_export_id and status in ('pending_review','approved_for_manual_restore')) then
    raise exception 'Cancele a solicitação de restauração antes de excluir o pacote.';
  end if;
  update public.system_data_exports set status='deleted',deleted_at=now() where id=p_export_id;
  insert into public.system_data_audit(company_id,project_id,export_id,action,details,actor_id)
  values(v_export.company_id,v_export.project_id,p_export_id,'export_deleted',jsonb_build_object('file_name',v_export.file_name),auth.uid());
end;
$$;

create or replace function public.system_request_data_restore(p_export_id uuid,p_reason text)
returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_export public.system_data_exports%rowtype;
  v_id uuid;
begin
  select * into v_export from public.system_data_exports where id=p_export_id for update;
  if v_export.id is null then raise exception 'Exportação não localizada.'; end if;
  if not public.has_company_permission(v_export.company_id,'admin.data.restore') then raise exception 'Sem permissão para solicitar restauração.'; end if;
  if v_export.status<>'ready' or v_export.expires_at<=now() then raise exception 'O pacote não está disponível para restauração.'; end if;
  if length(trim(coalesce(p_reason,'')))<20 then raise exception 'Descreva o motivo da restauração com pelo menos 20 caracteres.'; end if;
  if exists(select 1 from public.system_data_restore_requests where export_id=p_export_id and status in ('pending_review','approved_for_manual_restore')) then
    raise exception 'Já existe uma solicitação aberta para este pacote.';
  end if;

  insert into public.system_data_restore_requests(company_id,project_id,export_id,reason,requested_by)
  values(v_export.company_id,v_export.project_id,p_export_id,trim(p_reason),auth.uid())
  returning id into v_id;

  insert into public.system_data_audit(company_id,project_id,export_id,restore_request_id,action,details,actor_id)
  values(v_export.company_id,v_export.project_id,p_export_id,v_id,'restore_requested',jsonb_build_object('reason',trim(p_reason)),auth.uid());
  return v_id;
end;
$$;

create or replace function public.system_review_data_restore(p_request_id uuid,p_decision text,p_notes text)
returns void
language plpgsql security definer set search_path=public as $$
declare
  v_request public.system_data_restore_requests%rowtype;
  v_actor_role text;
  v_status text;
begin
  select * into v_request from public.system_data_restore_requests where id=p_request_id for update;
  if v_request.id is null then raise exception 'Solicitação não localizada.'; end if;
  if not public.has_company_permission(v_request.company_id,'admin.data.restore') then raise exception 'Sem permissão para revisar restaurações.'; end if;
  select r.key into v_actor_role
  from public.company_memberships m join public.roles r on r.id=m.role_id
  where m.company_id=v_request.company_id and m.user_id=auth.uid() and m.status='active';
  if v_actor_role not in ('owner','admin') then raise exception 'A revisão exige papel de Proprietário ou Administrador.'; end if;
  if v_request.status<>'pending_review' then raise exception 'A solicitação já foi revisada.'; end if;
  if p_decision not in ('approve','reject') then raise exception 'Decisão inválida.'; end if;
  if p_decision='reject' and length(trim(coalesce(p_notes,'')))<10 then raise exception 'Informe o motivo da rejeição.'; end if;

  v_status:=case when p_decision='approve' then 'approved_for_manual_restore' else 'rejected' end;
  update public.system_data_restore_requests
  set status=v_status,reviewed_by=auth.uid(),reviewed_at=now(),review_notes=nullif(trim(coalesce(p_notes,'')),'')
  where id=p_request_id;

  insert into public.system_data_audit(company_id,project_id,export_id,restore_request_id,action,details,actor_id)
  values(v_request.company_id,v_request.project_id,v_request.export_id,p_request_id,
    case when p_decision='approve' then 'restore_approved' else 'restore_rejected' end,
    jsonb_build_object('notes',nullif(trim(coalesce(p_notes,'')),'')),auth.uid());
end;
$$;

create or replace function public.system_cancel_data_restore(p_request_id uuid,p_reason text)
returns void
language plpgsql security definer set search_path=public as $$
declare
  v_request public.system_data_restore_requests%rowtype;
begin
  select * into v_request from public.system_data_restore_requests where id=p_request_id for update;
  if v_request.id is null then raise exception 'Solicitação não localizada.'; end if;
  if not public.has_company_permission(v_request.company_id,'admin.data.restore') then raise exception 'Sem permissão para cancelar restaurações.'; end if;
  if v_request.status not in ('pending_review','approved_for_manual_restore') then raise exception 'A solicitação não pode mais ser cancelada.'; end if;
  update public.system_data_restore_requests set status='cancelled',review_notes=coalesce(nullif(trim(coalesce(p_reason,'')),''),review_notes),reviewed_by=auth.uid(),reviewed_at=now() where id=p_request_id;
  insert into public.system_data_audit(company_id,project_id,export_id,restore_request_id,action,details,actor_id)
  values(v_request.company_id,v_request.project_id,v_request.export_id,p_request_id,'restore_cancelled',jsonb_build_object('reason',nullif(trim(coalesce(p_reason,'')),'')),auth.uid());
end;
$$;

alter table public.system_data_exports enable row level security;
alter table public.system_data_restore_requests enable row level security;
alter table public.system_data_audit enable row level security;

drop policy if exists system_data_exports_select on public.system_data_exports;
create policy system_data_exports_select on public.system_data_exports
for select to authenticated using (
  public.has_company_permission(company_id,'admin.data.view')
  or public.has_company_permission(company_id,'admin.data.export')
  or public.has_company_permission(company_id,'admin.data.manage')
  or public.has_company_permission(company_id,'admin.data.restore')
);

drop policy if exists system_data_restore_requests_select on public.system_data_restore_requests;
create policy system_data_restore_requests_select on public.system_data_restore_requests
for select to authenticated using (
  public.has_company_permission(company_id,'admin.data.restore')
  or public.has_company_permission(company_id,'admin.data.manage')
);

drop policy if exists system_data_audit_select on public.system_data_audit;
create policy system_data_audit_select on public.system_data_audit
for select to authenticated using (
  public.has_company_permission(company_id,'admin.data.view')
  or public.has_company_permission(company_id,'admin.data.manage')
  or public.has_company_permission(company_id,'admin.data.restore')
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'system-backups','system-backups',false,104857600,
  array['application/json','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists system_backups_select on storage.objects;
create policy system_backups_select on storage.objects
for select to authenticated using (
  case
    when bucket_id='system-backups'
      and coalesce((storage.foldername(name))[1],'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.has_company_permission(((storage.foldername(name))[1])::uuid,'admin.data.view')
      or public.has_company_permission(((storage.foldername(name))[1])::uuid,'admin.data.export')
      or public.has_company_permission(((storage.foldername(name))[1])::uuid,'admin.data.manage')
    else false
  end
);

drop policy if exists system_backups_insert on storage.objects;
create policy system_backups_insert on storage.objects
for insert to authenticated with check (
  case
    when bucket_id='system-backups'
      and coalesce((storage.foldername(name))[1],'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.has_company_permission(((storage.foldername(name))[1])::uuid,'admin.data.export')
    else false
  end
);

drop policy if exists system_backups_delete on storage.objects;
create policy system_backups_delete on storage.objects
for delete to authenticated using (
  case
    when bucket_id='system-backups'
      and coalesce((storage.foldername(name))[1],'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.has_company_permission(((storage.foldername(name))[1])::uuid,'admin.data.manage')
    else false
  end
);

revoke insert,update,delete on public.system_data_exports from authenticated;
revoke insert,update,delete on public.system_data_restore_requests from authenticated;
revoke insert,update,delete on public.system_data_audit from authenticated;
grant select on public.system_data_exports to authenticated;
grant select on public.system_data_restore_requests to authenticated;
grant select on public.system_data_audit to authenticated;

grant execute on function public.system_data_module_for_table(text) to authenticated;
grant execute on function public.system_company_data_inventory(uuid,uuid) to authenticated;
grant execute on function public.system_build_data_export(uuid,uuid,text[]) to authenticated;
grant execute on function public.system_create_data_export(uuid,uuid,text,text[],text,integer) to authenticated;
grant execute on function public.system_complete_data_export(uuid,text,text,text,bigint,text,integer,bigint,jsonb) to authenticated;
grant execute on function public.system_fail_data_export(uuid,text) to authenticated;
grant execute on function public.system_log_data_export_download(uuid) to authenticated;
grant execute on function public.system_mark_data_export_deleted(uuid) to authenticated;
grant execute on function public.system_request_data_restore(uuid,text) to authenticated;
grant execute on function public.system_review_data_restore(uuid,text,text) to authenticated;
grant execute on function public.system_cancel_data_restore(uuid,text) to authenticated;

commit;
