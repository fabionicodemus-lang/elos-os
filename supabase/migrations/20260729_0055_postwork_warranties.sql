-- Elos OS — Pós-Obra · Garantias
-- Regras de cobertura, itens garantidos, manutenção preventiva, documentos e análise de chamados.

begin;

create table if not exists public.postwork_warranty_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  counter_year integer not null,
  last_number integer not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key(company_id,project_id,counter_year)
);

create table if not exists public.postwork_warranty_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  code text not null,
  name text not null,
  scope_type text not null default 'system' check (scope_type in ('project','common_area','unit','system','equipment')),
  category text not null default 'other' check (category in ('waterproofing','hydraulic','electrical','finishes','frames','painting','flooring','equipment','structure','gas','common_area','other')),
  start_rule text not null default 'custom' check (start_rule in ('project_delivery','unit_delivery','installation','purchase','custom')),
  term_months integer not null check (term_months between 1 and 600),
  alert_days integer not null default 60 check (alert_days between 0 and 730),
  supplier_id uuid references public.suppliers(id) on delete set null,
  manufacturer text,
  coverage_terms text not null,
  exclusions text,
  maintenance_requirements text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists postwork_warranty_policies_code_uidx
  on public.postwork_warranty_policies(company_id,coalesce(project_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(code));

create table if not exists public.postwork_warranty_assets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  policy_id uuid not null references public.postwork_warranty_policies(id) on delete restrict,
  unit_id uuid references public.units(id) on delete restrict,
  sale_id uuid references public.sales(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  asset_code text not null,
  item_name text not null,
  location_detail text,
  brand text,
  model text,
  serial_number text,
  invoice_number text,
  purchase_date date,
  installation_date date,
  start_date date not null,
  end_date date not null,
  status text not null default 'active' check (status in ('active','cancelled')),
  cancellation_reason text,
  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,project_id,asset_code),
  check (end_date >= start_date),
  check (status <> 'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null)
);

create table if not exists public.postwork_warranty_maintenance (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  asset_id uuid not null references public.postwork_warranty_assets(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  title text not null,
  due_date date not null,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  completion_notes text,
  cost numeric(16,2) not null default 0 check (cost >= 0),
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  cancellation_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'completed' or completed_at is not null),
  check (status <> 'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null)
);

create table if not exists public.postwork_warranty_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  policy_id uuid references public.postwork_warranty_policies(id) on delete cascade,
  asset_id uuid references public.postwork_warranty_assets(id) on delete cascade,
  maintenance_id uuid references public.postwork_warranty_maintenance(id) on delete set null,
  document_type text not null default 'other' check (document_type in ('policy','manual','invoice','certificate','maintenance','claim','other')),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  caption text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  unique(project_id,storage_path),
  check (policy_id is not null or asset_id is not null)
);

create table if not exists public.postwork_warranty_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  policy_id uuid references public.postwork_warranty_policies(id) on delete set null,
  asset_id uuid references public.postwork_warranty_assets(id) on delete set null,
  maintenance_id uuid references public.postwork_warranty_maintenance(id) on delete set null,
  assistance_ticket_id uuid references public.postwork_assistance_tickets(id) on delete set null,
  action text not null,
  notes text,
  details jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

alter table public.postwork_assistance_tickets
  add column if not exists warranty_policy_id uuid references public.postwork_warranty_policies(id) on delete set null,
  add column if not exists warranty_asset_id uuid references public.postwork_warranty_assets(id) on delete set null,
  add column if not exists warranty_analysis_at timestamptz,
  add column if not exists warranty_analyzed_by uuid references auth.users(id);

create index if not exists postwork_warranty_policies_project_idx on public.postwork_warranty_policies(company_id,project_id,status,category,name);
create index if not exists postwork_warranty_assets_project_idx on public.postwork_warranty_assets(project_id,status,end_date,item_name);
create index if not exists postwork_warranty_assets_unit_idx on public.postwork_warranty_assets(unit_id,end_date) where unit_id is not null;
create index if not exists postwork_warranty_assets_policy_idx on public.postwork_warranty_assets(policy_id,end_date);
create index if not exists postwork_warranty_maintenance_due_idx on public.postwork_warranty_maintenance(project_id,status,due_date);
create index if not exists postwork_warranty_documents_asset_idx on public.postwork_warranty_documents(asset_id,uploaded_at desc);
create index if not exists postwork_warranty_audit_project_idx on public.postwork_warranty_audit(project_id,changed_at desc);
create index if not exists postwork_assistance_warranty_idx on public.postwork_assistance_tickets(project_id,warranty_status,warranty_policy_id);

insert into public.permissions(key,module,action,description) values
  ('postwork.warranties.view','postwork_warranties','view','Visualizar regras, vigências, documentos e manutenções de garantia'),
  ('postwork.warranties.manage','postwork_warranties','manage','Cadastrar regras, itens cobertos e documentos de garantia'),
  ('postwork.warranties.analyze','postwork_warranties','analyze','Analisar a cobertura dos chamados técnicos'),
  ('postwork.warranties.maintenance','postwork_warranties','maintenance','Agendar e registrar manutenções vinculadas à garantia')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values
  ('postwork.warranties.view'),('postwork.warranties.manage'),('postwork.warranties.analyze'),('postwork.warranties.maintenance')
) p(permission_key)
where r.key in ('owner','admin','director')
on conflict(role_id,permission_key) do update set allowed=true;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values
  ('postwork.warranties.view'),('postwork.warranties.manage'),('postwork.warranties.analyze'),('postwork.warranties.maintenance')
) p(permission_key)
where r.key in ('engineering','field')
on conflict(role_id,permission_key) do update set allowed=true;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'postwork.warranties.view',true from public.roles r
where r.key in ('commercial','finance','procurement','viewer')
on conflict(role_id,permission_key) do update set allowed=true;

alter table public.postwork_warranty_counters enable row level security;
alter table public.postwork_warranty_policies enable row level security;
alter table public.postwork_warranty_assets enable row level security;
alter table public.postwork_warranty_maintenance enable row level security;
alter table public.postwork_warranty_documents enable row level security;
alter table public.postwork_warranty_audit enable row level security;

do $$
declare t text;
begin
  foreach t in array array['postwork_warranty_policies','postwork_warranty_assets','postwork_warranty_maintenance','postwork_warranty_documents','postwork_warranty_audit'] loop
    execute format('drop policy if exists %I_select on public.%I',t,t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.has_company_permission(company_id,''postwork.warranties.view'') or public.has_company_permission(company_id,''postwork.warranties.manage'') or public.has_company_permission(company_id,''postwork.warranties.analyze'') or public.has_company_permission(company_id,''postwork.warranties.maintenance''))',t,t);
    execute format('drop policy if exists %I_write on public.%I',t,t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.has_company_permission(company_id,''postwork.warranties.manage'') or public.has_company_permission(company_id,''postwork.warranties.analyze'') or public.has_company_permission(company_id,''postwork.warranties.maintenance'')) with check (public.has_company_permission(company_id,''postwork.warranties.manage'') or public.has_company_permission(company_id,''postwork.warranties.analyze'') or public.has_company_permission(company_id,''postwork.warranties.maintenance''))',t,t);
  end loop;
end $$;

drop policy if exists postwork_warranty_counters_select on public.postwork_warranty_counters;

create or replace function public.postwork_next_warranty_asset_code(p_company_id uuid,p_project_id uuid,p_reference_date date default current_date)
returns text language plpgsql security definer set search_path=public as $$
declare v_year integer:=extract(year from coalesce(p_reference_date,current_date))::integer; v_number integer;
begin
  if not public.has_company_permission(p_company_id,'postwork.warranties.manage') then raise exception 'Sem permissão para cadastrar garantias.'; end if;
  if not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id and status<>'archived') then raise exception 'Empreendimento inválido.'; end if;
  insert into public.postwork_warranty_counters(company_id,project_id,counter_year,last_number)
  values(p_company_id,p_project_id,v_year,1)
  on conflict(company_id,project_id,counter_year) do update set last_number=public.postwork_warranty_counters.last_number+1,updated_at=now()
  returning last_number into v_number;
  return format('GAR-%s-%s',v_year,lpad(v_number::text,4,'0'));
end; $$;

create or replace function public.save_postwork_warranty_policy(
  p_company_id uuid,p_project_id uuid,p_policy_id uuid,p_code text,p_name text,p_scope_type text,p_category text,
  p_start_rule text,p_term_months integer,p_alert_days integer,p_supplier_id uuid,p_manufacturer text,
  p_coverage_terms text,p_exclusions text,p_maintenance_requirements text,p_status text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not public.has_company_permission(p_company_id,'postwork.warranties.manage') then raise exception 'Sem permissão para gerenciar regras de garantia.'; end if;
  if nullif(trim(coalesce(p_code,'')),'') is null or nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Informe código e nome da garantia.'; end if;
  if nullif(trim(coalesce(p_coverage_terms,'')),'') is null then raise exception 'Descreva as condições de cobertura.'; end if;
  if p_scope_type not in ('project','common_area','unit','system','equipment') then raise exception 'Abrangência inválida.'; end if;
  if p_category not in ('waterproofing','hydraulic','electrical','finishes','frames','painting','flooring','equipment','structure','gas','common_area','other') then raise exception 'Categoria inválida.'; end if;
  if p_start_rule not in ('project_delivery','unit_delivery','installation','purchase','custom') then raise exception 'Regra de início inválida.'; end if;
  if coalesce(p_term_months,0) not between 1 and 600 then raise exception 'Prazo de garantia inválido.'; end if;
  if coalesce(p_alert_days,0) not between 0 and 730 then raise exception 'Prazo do alerta inválido.'; end if;
  if p_project_id is not null and not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id) then raise exception 'Empreendimento inválido.'; end if;
  if p_supplier_id is not null and not exists(select 1 from public.suppliers where id=p_supplier_id and company_id=p_company_id) then raise exception 'Fornecedor inválido.'; end if;
  if p_status not in ('active','inactive') then raise exception 'Situação inválida.'; end if;

  if p_policy_id is null then
    insert into public.postwork_warranty_policies(company_id,project_id,code,name,scope_type,category,start_rule,term_months,alert_days,supplier_id,manufacturer,coverage_terms,exclusions,maintenance_requirements,status,created_by,updated_by)
    values(p_company_id,p_project_id,upper(trim(p_code)),trim(p_name),p_scope_type,p_category,p_start_rule,p_term_months,p_alert_days,p_supplier_id,nullif(trim(coalesce(p_manufacturer,'')),''),trim(p_coverage_terms),nullif(trim(coalesce(p_exclusions,'')),''),nullif(trim(coalesce(p_maintenance_requirements,'')),''),p_status,auth.uid(),auth.uid()) returning id into v_id;
  else
    update public.postwork_warranty_policies set project_id=p_project_id,code=upper(trim(p_code)),name=trim(p_name),scope_type=p_scope_type,category=p_category,start_rule=p_start_rule,term_months=p_term_months,alert_days=p_alert_days,supplier_id=p_supplier_id,manufacturer=nullif(trim(coalesce(p_manufacturer,'')),''),coverage_terms=trim(p_coverage_terms),exclusions=nullif(trim(coalesce(p_exclusions,'')),''),maintenance_requirements=nullif(trim(coalesce(p_maintenance_requirements,'')),''),status=p_status,updated_by=auth.uid(),updated_at=now()
    where id=p_policy_id and company_id=p_company_id returning id into v_id;
    if v_id is null then raise exception 'Regra de garantia não localizada.'; end if;
  end if;

  insert into public.postwork_warranty_audit(company_id,project_id,policy_id,action,details,changed_by)
  values(p_company_id,coalesce(p_project_id,(select id from public.projects where company_id=p_company_id and status<>'archived' order by created_at limit 1)),v_id,case when p_policy_id is null then 'policy_created' else 'policy_updated' end,jsonb_build_object('code',upper(trim(p_code)),'name',trim(p_name),'term_months',p_term_months),auth.uid());
  return v_id;
end; $$;

create or replace function public.create_postwork_warranty_asset(
  p_company_id uuid,p_project_id uuid,p_policy_id uuid,p_unit_id uuid,p_supplier_id uuid,p_item_name text,p_location_detail text,
  p_brand text,p_model text,p_serial_number text,p_invoice_number text,p_purchase_date date,p_installation_date date,p_start_date date,p_notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_policy public.postwork_warranty_policies%rowtype; v_start date; v_end date; v_code text; v_id uuid; v_sale_id uuid;
begin
  if not public.has_company_permission(p_company_id,'postwork.warranties.manage') then raise exception 'Sem permissão para cadastrar itens garantidos.'; end if;
  select * into v_policy from public.postwork_warranty_policies where id=p_policy_id and company_id=p_company_id and status='active';
  if v_policy.id is null or (v_policy.project_id is not null and v_policy.project_id<>p_project_id) then raise exception 'Regra de garantia inválida para o empreendimento.'; end if;
  if nullif(trim(coalesce(p_item_name,'')),'') is null then raise exception 'Informe o item coberto.'; end if;
  if p_unit_id is not null and not exists(select 1 from public.units where id=p_unit_id and company_id=p_company_id and project_id=p_project_id) then raise exception 'Unidade inválida.'; end if;
  if v_policy.scope_type='unit' and p_unit_id is null then raise exception 'Esta regra exige uma unidade vinculada.'; end if;
  if p_supplier_id is not null and not exists(select 1 from public.suppliers where id=p_supplier_id and company_id=p_company_id) then raise exception 'Fornecedor inválido.'; end if;

  v_start:=case v_policy.start_rule
    when 'unit_delivery' then (select delivered_at::date from public.postwork_unit_inspections where company_id=p_company_id and project_id=p_project_id and unit_id=p_unit_id and status='delivered' order by delivered_at desc limit 1)
    when 'installation' then p_installation_date
    when 'purchase' then p_purchase_date
    else p_start_date
  end;
  if v_start is null then raise exception 'Não foi possível definir a data inicial da garantia. Informe ou conclua o evento correspondente.'; end if;
  v_end:=(v_start + make_interval(months=>v_policy.term_months))::date;
  if p_unit_id is not null then
    select id into v_sale_id from public.sales where company_id=p_company_id and project_id=p_project_id and unit_id=p_unit_id and status='active' order by sale_date desc limit 1;
  end if;
  v_code:=public.postwork_next_warranty_asset_code(p_company_id,p_project_id,v_start);
  insert into public.postwork_warranty_assets(company_id,project_id,policy_id,unit_id,sale_id,supplier_id,asset_code,item_name,location_detail,brand,model,serial_number,invoice_number,purchase_date,installation_date,start_date,end_date,notes,created_by,updated_by)
  values(p_company_id,p_project_id,p_policy_id,p_unit_id,v_sale_id,coalesce(p_supplier_id,v_policy.supplier_id),v_code,trim(p_item_name),nullif(trim(coalesce(p_location_detail,'')),''),nullif(trim(coalesce(p_brand,'')),''),nullif(trim(coalesce(p_model,'')),''),nullif(trim(coalesce(p_serial_number,'')),''),nullif(trim(coalesce(p_invoice_number,'')),''),p_purchase_date,p_installation_date,v_start,v_end,nullif(trim(coalesce(p_notes,'')),''),auth.uid(),auth.uid()) returning id into v_id;
  insert into public.postwork_warranty_audit(company_id,project_id,policy_id,asset_id,action,details,changed_by)
  values(p_company_id,p_project_id,p_policy_id,v_id,'asset_created',jsonb_build_object('asset_code',v_code,'start_date',v_start,'end_date',v_end),auth.uid());
  return v_id;
end; $$;

create or replace function public.cancel_postwork_warranty_asset(p_company_id uuid,p_project_id uuid,p_asset_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$
declare v_asset public.postwork_warranty_assets%rowtype;
begin
  if not public.has_company_permission(p_company_id,'postwork.warranties.manage') then raise exception 'Sem permissão para cancelar garantias.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into v_asset from public.postwork_warranty_assets where id=p_asset_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_asset.id is null or v_asset.status='cancelled' then raise exception 'Item de garantia indisponível.'; end if;
  update public.postwork_warranty_assets set status='cancelled',cancellation_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() where id=p_asset_id;
  insert into public.postwork_warranty_audit(company_id,project_id,policy_id,asset_id,action,notes,changed_by) values(p_company_id,p_project_id,v_asset.policy_id,p_asset_id,'asset_cancelled',trim(p_reason),auth.uid());
  return 'cancelled';
end; $$;

create or replace function public.schedule_postwork_warranty_maintenance(p_company_id uuid,p_project_id uuid,p_asset_id uuid,p_supplier_id uuid,p_title text,p_due_date date)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_asset public.postwork_warranty_assets%rowtype; v_id uuid;
begin
  if not public.has_company_permission(p_company_id,'postwork.warranties.maintenance') then raise exception 'Sem permissão para agendar manutenções.'; end if;
  select * into v_asset from public.postwork_warranty_assets where id=p_asset_id and company_id=p_company_id and project_id=p_project_id and status='active';
  if v_asset.id is null then raise exception 'Item de garantia inválido.'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null or p_due_date is null then raise exception 'Informe serviço e vencimento da manutenção.'; end if;
  if p_supplier_id is not null and not exists(select 1 from public.suppliers where id=p_supplier_id and company_id=p_company_id) then raise exception 'Fornecedor inválido.'; end if;
  insert into public.postwork_warranty_maintenance(company_id,project_id,asset_id,supplier_id,title,due_date,created_by)
  values(p_company_id,p_project_id,p_asset_id,coalesce(p_supplier_id,v_asset.supplier_id),trim(p_title),p_due_date,auth.uid()) returning id into v_id;
  insert into public.postwork_warranty_audit(company_id,project_id,policy_id,asset_id,maintenance_id,action,details,changed_by)
  values(p_company_id,p_project_id,v_asset.policy_id,p_asset_id,v_id,'maintenance_scheduled',jsonb_build_object('title',trim(p_title),'due_date',p_due_date),auth.uid());
  return v_id;
end; $$;

create or replace function public.complete_postwork_warranty_maintenance(p_company_id uuid,p_project_id uuid,p_maintenance_id uuid,p_notes text,p_cost numeric)
returns text language plpgsql security definer set search_path=public as $$
declare v_row public.postwork_warranty_maintenance%rowtype; v_asset public.postwork_warranty_assets%rowtype;
begin
  if not public.has_company_permission(p_company_id,'postwork.warranties.maintenance') then raise exception 'Sem permissão para concluir manutenções.'; end if;
  select * into v_row from public.postwork_warranty_maintenance where id=p_maintenance_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_row.id is null or v_row.status<>'scheduled' then raise exception 'Manutenção indisponível para conclusão.'; end if;
  if nullif(trim(coalesce(p_notes,'')),'') is null then raise exception 'Descreva o serviço realizado.'; end if;
  if coalesce(p_cost,0)<0 then raise exception 'Custo inválido.'; end if;
  select * into v_asset from public.postwork_warranty_assets where id=v_row.asset_id;
  update public.postwork_warranty_maintenance set status='completed',completion_notes=trim(p_notes),cost=coalesce(p_cost,0),completed_at=now(),completed_by=auth.uid(),updated_at=now() where id=p_maintenance_id;
  insert into public.postwork_warranty_audit(company_id,project_id,policy_id,asset_id,maintenance_id,action,notes,details,changed_by)
  values(p_company_id,p_project_id,v_asset.policy_id,v_row.asset_id,p_maintenance_id,'maintenance_completed',trim(p_notes),jsonb_build_object('cost',coalesce(p_cost,0)),auth.uid());
  return 'completed';
end; $$;

create or replace function public.analyze_postwork_assistance_warranty(
  p_company_id uuid,p_project_id uuid,p_ticket_id uuid,p_policy_id uuid,p_asset_id uuid,p_status text,p_reason text
) returns text language plpgsql security definer set search_path=public as $$
declare v_ticket public.postwork_assistance_tickets%rowtype; v_policy public.postwork_warranty_policies%rowtype; v_asset public.postwork_warranty_assets%rowtype;
begin
  if not public.has_company_permission(p_company_id,'postwork.warranties.analyze') then raise exception 'Sem permissão para analisar garantias.'; end if;
  if p_status not in ('pending','covered','not_covered','courtesy','not_applicable') then raise exception 'Resultado da análise inválido.'; end if;
  select * into v_ticket from public.postwork_assistance_tickets where id=p_ticket_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_ticket.id is null then raise exception 'Chamado técnico não localizado.'; end if;
  if p_policy_id is not null then
    select * into v_policy from public.postwork_warranty_policies where id=p_policy_id and company_id=p_company_id and status='active';
    if v_policy.id is null or (v_policy.project_id is not null and v_policy.project_id<>p_project_id) then raise exception 'Regra de garantia inválida.'; end if;
  end if;
  if p_asset_id is not null then
    select * into v_asset from public.postwork_warranty_assets where id=p_asset_id and company_id=p_company_id and project_id=p_project_id;
    if v_asset.id is null then raise exception 'Item garantido inválido.'; end if;
    if p_policy_id is not null and v_asset.policy_id<>p_policy_id then raise exception 'O item não pertence à regra selecionada.'; end if;
    if v_ticket.unit_id is not null and v_asset.unit_id is not null and v_asset.unit_id<>v_ticket.unit_id then raise exception 'O item garantido pertence a outra unidade.'; end if;
  end if;
  if p_status='covered' then
    if v_asset.id is null then raise exception 'Selecione o item garantido para confirmar a cobertura.'; end if;
    if v_asset.status<>'active' then raise exception 'O item garantido está cancelado.'; end if;
    if current_date<v_asset.start_date or current_date>v_asset.end_date then raise exception 'A vigência do item não cobre a data atual. Use cortesia ou não coberta conforme a decisão técnica.'; end if;
  end if;
  if p_status in ('not_covered','courtesy') and nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Justifique a decisão de garantia.'; end if;
  update public.postwork_assistance_tickets set warranty_status=p_status,warranty_reason=nullif(trim(coalesce(p_reason,'')),''),warranty_policy_id=p_policy_id,warranty_asset_id=p_asset_id,warranty_analysis_at=now(),warranty_analyzed_by=auth.uid(),updated_by=auth.uid(),updated_at=now() where id=p_ticket_id;
  insert into public.postwork_assistance_audit(company_id,project_id,ticket_id,action,notes,details,changed_by)
  values(p_company_id,p_project_id,p_ticket_id,'warranty_analyzed',p_reason,jsonb_build_object('status',p_status,'policy_id',p_policy_id,'asset_id',p_asset_id),auth.uid());
  insert into public.postwork_warranty_audit(company_id,project_id,policy_id,asset_id,assistance_ticket_id,action,notes,details,changed_by)
  values(p_company_id,p_project_id,p_policy_id,p_asset_id,p_ticket_id,'assistance_analyzed',p_reason,jsonb_build_object('status',p_status,'ticket_number',v_ticket.number),auth.uid());
  return p_status;
end; $$;

create or replace function public.postwork_warranties_summary(p_company_id uuid,p_project_id uuid default null)
returns jsonb language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'policy_count',(select count(*) from public.postwork_warranty_policies p where p.company_id=p_company_id and p.status='active' and (p.project_id is null or p_project_id is null or p.project_id=p_project_id)),
    'active_asset_count',count(*) filter(where a.status='active' and a.start_date<=current_date and a.end_date>=current_date),
    'expiring_count',count(*) filter(where a.status='active' and a.end_date between current_date and current_date+90),
    'expired_count',count(*) filter(where a.status='active' and a.end_date<current_date),
    'maintenance_due_count',(select count(*) from public.postwork_warranty_maintenance m where m.company_id=p_company_id and (p_project_id is null or m.project_id=p_project_id) and m.status='scheduled' and m.due_date between current_date and current_date+30),
    'maintenance_overdue_count',(select count(*) from public.postwork_warranty_maintenance m where m.company_id=p_company_id and (p_project_id is null or m.project_id=p_project_id) and m.status='scheduled' and m.due_date<current_date),
    'pending_claim_count',(select count(*) from public.postwork_assistance_tickets t where t.company_id=p_company_id and (p_project_id is null or t.project_id=p_project_id) and t.warranty_claimed and t.warranty_status='pending' and t.status not in ('resolved','rejected','cancelled')),
    'covered_claim_count',(select count(*) from public.postwork_assistance_tickets t where t.company_id=p_company_id and (p_project_id is null or t.project_id=p_project_id) and t.warranty_status='covered')
  ) from public.postwork_warranty_assets a where a.company_id=p_company_id and (p_project_id is null or a.project_id=p_project_id);
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('postwork-warranties','postwork-warranties',false,26214400,array['application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists postwork_warranties_storage_select on storage.objects;
create policy postwork_warranties_storage_select on storage.objects for select to authenticated using(bucket_id='postwork-warranties' and exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and m.status='active' and m.company_id::text=(storage.foldername(name))[1]));
drop policy if exists postwork_warranties_storage_insert on storage.objects;
create policy postwork_warranties_storage_insert on storage.objects for insert to authenticated with check(bucket_id='postwork-warranties' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'postwork.warranties.manage'));
drop policy if exists postwork_warranties_storage_delete on storage.objects;
create policy postwork_warranties_storage_delete on storage.objects for delete to authenticated using(bucket_id='postwork-warranties' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'postwork.warranties.manage'));

grant select,insert,update,delete on public.postwork_warranty_policies,public.postwork_warranty_assets,public.postwork_warranty_maintenance,public.postwork_warranty_documents,public.postwork_warranty_audit to authenticated;
grant execute on function public.postwork_next_warranty_asset_code(uuid,uuid,date) to authenticated;
grant execute on function public.save_postwork_warranty_policy(uuid,uuid,uuid,text,text,text,text,text,integer,integer,uuid,text,text,text,text,text) to authenticated;
grant execute on function public.create_postwork_warranty_asset(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,date,date,date,text) to authenticated;
grant execute on function public.cancel_postwork_warranty_asset(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.schedule_postwork_warranty_maintenance(uuid,uuid,uuid,uuid,text,date) to authenticated;
grant execute on function public.complete_postwork_warranty_maintenance(uuid,uuid,uuid,text,numeric) to authenticated;
grant execute on function public.analyze_postwork_assistance_warranty(uuid,uuid,uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.postwork_warranties_summary(uuid,uuid) to authenticated;

commit;
