-- Elos OS — Suprimentos · Estoque
-- Saldos por material/local/lote, entradas automáticas, consumo, transferências, ajustes e inventários.

begin;

create table if not exists public.procurement_inventory_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  code text not null,
  name text not null,
  location_type text not null default 'warehouse' check(location_type in ('warehouse','site','floor','container','external','other')),
  status text not null default 'active' check(status in ('active','inactive')),
  address text,
  responsible_user_id uuid references auth.users(id),
  responsible_name text,
  allow_negative boolean not null default false,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,code),
  unique(project_id,name)
);

create table if not exists public.procurement_inventory_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  input_id uuid not null references public.engineering_inputs(id) on delete restrict,
  location_id uuid not null references public.procurement_inventory_locations(id) on delete restrict,
  input_code text not null,
  input_name text not null,
  unit_snapshot text not null,
  category_snapshot text,
  batch_number text not null default '',
  expiration_date date not null default '9999-12-31',
  quantity_on_hand numeric(18,6) not null default 0,
  reserved_quantity numeric(18,6) not null default 0,
  available_quantity numeric(18,6) generated always as (quantity_on_hand-reserved_quantity) stored,
  average_unit_cost numeric(18,6) not null default 0,
  total_value numeric(18,2) not null default 0,
  minimum_quantity numeric(18,6) not null default 0,
  maximum_quantity numeric(18,6),
  last_movement_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,input_id,location_id,batch_number,expiration_date),
  constraint procurement_inventory_balance_values_check check(
    quantity_on_hand>=0 and reserved_quantity>=0 and reserved_quantity<=quantity_on_hand+0.000001 and average_unit_cost>=0 and total_value>=0 and minimum_quantity>=0 and (maximum_quantity is null or maximum_quantity>=minimum_quantity)
  )
);

create table if not exists public.procurement_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  sequence_no bigint not null,
  movement_number text not null,
  movement_type text not null check(movement_type in ('receipt','issue','transfer','adjustment_in','adjustment_out','return_to_supplier','return_to_stock')),
  movement_date date not null default current_date,
  input_id uuid not null references public.engineering_inputs(id) on delete restrict,
  input_code text not null,
  input_name text not null,
  unit_snapshot text not null,
  from_location_id uuid references public.procurement_inventory_locations(id) on delete restrict,
  to_location_id uuid references public.procurement_inventory_locations(id) on delete restrict,
  quantity numeric(18,6) not null,
  unit_cost numeric(18,6) not null default 0,
  total_value numeric(18,2) not null default 0,
  batch_number text not null default '',
  expiration_date date not null default '9999-12-31',
  cost_center_service_id uuid references public.engineering_services(id) on delete restrict,
  cost_center_code text,
  cost_center_name text,
  responsible_name text,
  recipient_name text,
  source_type text,
  source_id uuid,
  source_reference text,
  notes text,
  reversed_by_movement_id uuid references public.procurement_inventory_movements(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(project_id,sequence_no),
  unique(project_id,movement_number),
  constraint procurement_inventory_movement_values_check check(quantity>0 and unit_cost>=0 and total_value>=0),
  constraint procurement_inventory_movement_locations_check check(
    (movement_type in ('receipt','adjustment_in','return_to_stock') and from_location_id is null and to_location_id is not null) or
    (movement_type in ('issue','adjustment_out','return_to_supplier') and from_location_id is not null and to_location_id is null) or
    (movement_type='transfer' and from_location_id is not null and to_location_id is not null and from_location_id<>to_location_id)
  )
);

create unique index if not exists procurement_inventory_movement_source_unique
on public.procurement_inventory_movements(source_type,source_id,movement_type)
where source_id is not null;

create table if not exists public.procurement_inventory_counts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  location_id uuid not null references public.procurement_inventory_locations(id) on delete restrict,
  sequence_no integer not null,
  count_number text not null,
  count_date date not null,
  status text not null default 'draft' check(status in ('draft','submitted','approved','cancelled')),
  notes text,
  counter_user_id uuid references auth.users(id),
  counter_name text,
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  approval_notes text,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,sequence_no),
  unique(project_id,count_number),
  constraint procurement_inventory_count_cancel_check check(status<>'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null)
);

create table if not exists public.procurement_inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  count_id uuid not null references public.procurement_inventory_counts(id) on delete cascade,
  balance_id uuid references public.procurement_inventory_balances(id) on delete set null,
  input_id uuid not null references public.engineering_inputs(id) on delete restrict,
  location_id uuid not null references public.procurement_inventory_locations(id) on delete restrict,
  input_code text not null,
  input_name text not null,
  unit_snapshot text not null,
  batch_number text not null default '',
  expiration_date date not null default '9999-12-31',
  book_quantity numeric(18,6) not null,
  counted_quantity numeric(18,6) not null,
  difference_quantity numeric(18,6) generated always as (counted_quantity-book_quantity) stored,
  unit_cost numeric(18,6) not null default 0,
  difference_value numeric(18,2) not null default 0,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(count_id,input_id,location_id,batch_number,expiration_date),
  constraint procurement_inventory_count_item_values_check check(book_quantity>=0 and counted_quantity>=0 and unit_cost>=0)
);

create table if not exists public.procurement_inventory_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create index if not exists procurement_inventory_locations_project_idx on public.procurement_inventory_locations(project_id,status,name);
create index if not exists procurement_inventory_balances_project_idx on public.procurement_inventory_balances(project_id,location_id,input_name);
create index if not exists procurement_inventory_balances_low_idx on public.procurement_inventory_balances(project_id,minimum_quantity,available_quantity);
create index if not exists procurement_inventory_movements_project_idx on public.procurement_inventory_movements(project_id,movement_date desc,created_at desc);
create index if not exists procurement_inventory_movements_input_idx on public.procurement_inventory_movements(project_id,input_id,created_at desc);
create index if not exists procurement_inventory_counts_project_idx on public.procurement_inventory_counts(project_id,status,count_date desc);

insert into public.permissions(key,module,action,description) values
 ('procurement.inventory.view','procurement_inventory','view','Visualizar saldos e movimentações de estoque'),
 ('procurement.inventory.manage','procurement_inventory','manage','Cadastrar locais e parâmetros de estoque'),
 ('procurement.inventory.issue','procurement_inventory','issue','Registrar consumo e devoluções de materiais'),
 ('procurement.inventory.transfer','procurement_inventory','transfer','Transferir materiais entre locais'),
 ('procurement.inventory.adjust','procurement_inventory','adjust','Registrar ajustes manuais de estoque'),
 ('procurement.inventory.count','procurement_inventory','count','Criar e aprovar inventários físicos')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r cross join(values
 ('procurement.inventory.view'),('procurement.inventory.manage'),('procurement.inventory.issue'),('procurement.inventory.transfer'),('procurement.inventory.adjust'),('procurement.inventory.count'))p(permission_key)
where r.key in('owner','admin','director','procurement') on conflict(role_id,permission_key) do update set allowed=excluded.allowed;
insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r cross join(values('procurement.inventory.view'),('procurement.inventory.issue'),('procurement.inventory.transfer'))p(permission_key)
where r.key='field' on conflict(role_id,permission_key) do update set allowed=excluded.allowed;
insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'procurement.inventory.view',true from public.roles r where r.key in('engineering','finance','viewer') on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

alter table public.procurement_inventory_locations enable row level security;
alter table public.procurement_inventory_balances enable row level security;
alter table public.procurement_inventory_movements enable row level security;
alter table public.procurement_inventory_counts enable row level security;
alter table public.procurement_inventory_count_items enable row level security;
alter table public.procurement_inventory_audit enable row level security;

do $$ declare t text; begin
 foreach t in array array['procurement_inventory_locations','procurement_inventory_balances','procurement_inventory_movements','procurement_inventory_counts','procurement_inventory_count_items','procurement_inventory_audit'] loop
  execute format('drop policy if exists %I_select on public.%I',t,t);
  execute format('create policy %I_select on public.%I for select to authenticated using(public.has_company_permission(company_id,''procurement.inventory.view'') or public.has_company_permission(company_id,''procurement.inventory.manage''))',t,t);
  execute format('drop policy if exists %I_write on public.%I',t,t);
  execute format('create policy %I_write on public.%I for all to authenticated using(public.has_company_permission(company_id,''procurement.inventory.manage'') or public.has_company_permission(company_id,''procurement.inventory.issue'') or public.has_company_permission(company_id,''procurement.inventory.transfer'') or public.has_company_permission(company_id,''procurement.inventory.adjust'') or public.has_company_permission(company_id,''procurement.inventory.count'')) with check(public.has_company_permission(company_id,''procurement.inventory.manage'') or public.has_company_permission(company_id,''procurement.inventory.issue'') or public.has_company_permission(company_id,''procurement.inventory.transfer'') or public.has_company_permission(company_id,''procurement.inventory.adjust'') or public.has_company_permission(company_id,''procurement.inventory.count''))',t,t);
 end loop;
end $$;

create or replace function public.ensure_procurement_inventory_location(p_company_id uuid,p_project_id uuid,p_name text)
returns uuid language plpgsql security definer set search_path=public as $$
declare resolved uuid; seq integer; normalized text; begin
 normalized:=coalesce(nullif(trim(p_name),''),'Almoxarifado principal');
 select id into resolved from public.procurement_inventory_locations where company_id=p_company_id and project_id=p_project_id and lower(name)=lower(normalized) limit 1;
 if resolved is null then
  perform pg_advisory_xact_lock(hashtext(p_project_id::text||':inventory-locations'));
  select coalesce(count(*),0)+1 into seq from public.procurement_inventory_locations where project_id=p_project_id;
  insert into public.procurement_inventory_locations(company_id,project_id,code,name,location_type,responsible_name,created_by)
  values(p_company_id,p_project_id,'ALM-'||lpad(seq::text,3,'0'),normalized,'warehouse',coalesce(nullif(auth.jwt()->>'email',''),'Sistema'),auth.uid()) returning id into resolved;
 end if;
 return resolved;
end; $$;

create or replace function public.apply_procurement_inventory_balance(
 p_company_id uuid,p_project_id uuid,p_input_id uuid,p_location_id uuid,p_batch_number text,p_expiration_date date,p_quantity_delta numeric,p_unit_cost numeric
) returns uuid language plpgsql security definer set search_path=public as $$
declare b public.procurement_inventory_balances%rowtype; input_row public.engineering_inputs%rowtype; batch text; expiry date; new_qty numeric; new_total numeric; new_avg numeric; begin
 batch:=coalesce(trim(p_batch_number),''); expiry:=coalesce(p_expiration_date,'9999-12-31'::date);
 select * into b from public.procurement_inventory_balances where project_id=p_project_id and input_id=p_input_id and location_id=p_location_id and batch_number=batch and expiration_date=expiry for update;
 if b.id is null then
  select * into input_row from public.engineering_inputs where id=p_input_id and company_id=p_company_id;
  if input_row.id is null then raise exception 'Material de estoque inválido.'; end if;
  if p_quantity_delta<0 then raise exception 'Não existe saldo para a saída solicitada.'; end if;
  insert into public.procurement_inventory_balances(company_id,project_id,input_id,location_id,input_code,input_name,unit_snapshot,category_snapshot,batch_number,expiration_date,quantity_on_hand,average_unit_cost,total_value,last_movement_at)
  values(p_company_id,p_project_id,p_input_id,p_location_id,input_row.code,input_row.description,input_row.unit,input_row.category,batch,expiry,p_quantity_delta,greatest(coalesce(p_unit_cost,0),0),round(p_quantity_delta*greatest(coalesce(p_unit_cost,0),0),2),now()) returning id into b.id;
  return b.id;
 end if;
 new_qty:=b.quantity_on_hand+p_quantity_delta;
 if new_qty< -0.000001 then raise exception 'Saldo insuficiente de % no local selecionado. Disponível: % %.',b.input_code,b.quantity_on_hand,b.unit_snapshot; end if;
 if p_quantity_delta>0 then
  new_total:=round(b.total_value+p_quantity_delta*greatest(coalesce(p_unit_cost,0),0),2);
  new_avg:=case when new_qty>0 then new_total/new_qty else 0 end;
 else
  new_total:=round(greatest(0,b.total_value-abs(p_quantity_delta)*b.average_unit_cost),2);
  new_avg:=case when new_qty>0 then b.average_unit_cost else 0 end;
 end if;
 update public.procurement_inventory_balances set quantity_on_hand=greatest(0,new_qty),average_unit_cost=greatest(0,new_avg),total_value=greatest(0,new_total),last_movement_at=now(),updated_at=now() where id=b.id;
 return b.id;
end; $$;

create or replace function public.post_procurement_inventory_movement(
 p_company_id uuid,p_project_id uuid,p_movement_type text,p_movement_date date,p_input_id uuid,p_from_location_id uuid,p_to_location_id uuid,
 p_quantity numeric,p_unit_cost numeric,p_batch_number text,p_expiration_date date,p_cost_center_service_id uuid,p_recipient_name text,
 p_source_type text,p_source_id uuid,p_source_reference text,p_notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare input_row public.engineering_inputs%rowtype; service_row public.engineering_services%rowtype; source_balance public.procurement_inventory_balances%rowtype; seq bigint; movement_id uuid; resolved_cost numeric; required_permission text; begin
 required_permission:=case when p_movement_type='issue' then 'procurement.inventory.issue' when p_movement_type='transfer' then 'procurement.inventory.transfer' else 'procurement.inventory.adjust' end;
 if p_movement_type='receipt' and p_source_type='material_receipt' then required_permission:='procurement.receipts.approve'; end if;
 if not public.has_company_permission(p_company_id,required_permission) then raise exception 'Sem permissão para registrar esta movimentação.'; end if;
 if p_movement_type not in('receipt','issue','transfer','adjustment_in','adjustment_out','return_to_supplier','return_to_stock') then raise exception 'Tipo de movimentação inválido.'; end if;
 if coalesce(p_quantity,0)<=0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
 select * into input_row from public.engineering_inputs where id=p_input_id and company_id=p_company_id and status='active';
 if input_row.id is null then raise exception 'Material não encontrado ou inativo.'; end if;
 if p_cost_center_service_id is not null then select * into service_row from public.engineering_services where id=p_cost_center_service_id and company_id=p_company_id and status='active'; end if;
 if p_source_id is not null then
  select id into movement_id from public.procurement_inventory_movements where source_type=p_source_type and source_id=p_source_id and movement_type=p_movement_type;
  if movement_id is not null then return movement_id; end if;
 end if;
 resolved_cost:=greatest(coalesce(p_unit_cost,0),0);
 if p_movement_type in('issue','transfer','adjustment_out','return_to_supplier') then
  select * into source_balance from public.procurement_inventory_balances where project_id=p_project_id and input_id=p_input_id and location_id=p_from_location_id and batch_number=coalesce(trim(p_batch_number),'') and expiration_date=coalesce(p_expiration_date,'9999-12-31'::date) for update;
  if source_balance.id is null or source_balance.available_quantity<p_quantity-0.000001 then raise exception 'Saldo disponível insuficiente para a movimentação.'; end if;
  resolved_cost:=source_balance.average_unit_cost;
 end if;
 perform pg_advisory_xact_lock(hashtext(p_project_id::text||':inventory-movements'));
 select coalesce(max(sequence_no),0)+1 into seq from public.procurement_inventory_movements where project_id=p_project_id;
 insert into public.procurement_inventory_movements(company_id,project_id,sequence_no,movement_number,movement_type,movement_date,input_id,input_code,input_name,unit_snapshot,from_location_id,to_location_id,quantity,unit_cost,total_value,batch_number,expiration_date,cost_center_service_id,cost_center_code,cost_center_name,responsible_name,recipient_name,source_type,source_id,source_reference,notes,created_by)
 values(p_company_id,p_project_id,seq,'MOV-'||lpad(seq::text,6,'0'),p_movement_type,coalesce(p_movement_date,current_date),p_input_id,input_row.code,input_row.description,input_row.unit,p_from_location_id,p_to_location_id,p_quantity,resolved_cost,round(p_quantity*resolved_cost,2),coalesce(trim(p_batch_number),''),coalesce(p_expiration_date,'9999-12-31'::date),service_row.id,service_row.code,service_row.description,coalesce(nullif(auth.jwt()->>'email',''),'Usuário'),nullif(trim(coalesce(p_recipient_name,'')),''),nullif(trim(coalesce(p_source_type,'')),''),p_source_id,nullif(trim(coalesce(p_source_reference,'')),''),nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id into movement_id;
 if p_movement_type in('receipt','adjustment_in','return_to_stock') then
  perform public.apply_procurement_inventory_balance(p_company_id,p_project_id,p_input_id,p_to_location_id,p_batch_number,p_expiration_date,p_quantity,resolved_cost);
 elsif p_movement_type in('issue','adjustment_out','return_to_supplier') then
  perform public.apply_procurement_inventory_balance(p_company_id,p_project_id,p_input_id,p_from_location_id,p_batch_number,p_expiration_date,-p_quantity,resolved_cost);
 elsif p_movement_type='transfer' then
  perform public.apply_procurement_inventory_balance(p_company_id,p_project_id,p_input_id,p_from_location_id,p_batch_number,p_expiration_date,-p_quantity,resolved_cost);
  perform public.apply_procurement_inventory_balance(p_company_id,p_project_id,p_input_id,p_to_location_id,p_batch_number,p_expiration_date,p_quantity,resolved_cost);
 end if;
 insert into public.procurement_inventory_audit(company_id,project_id,entity_type,entity_id,action,details,changed_by)
 values(p_company_id,p_project_id,'movement',movement_id,'posted',jsonb_build_object('type',p_movement_type,'quantity',p_quantity,'unit_cost',resolved_cost),auth.uid());
 return movement_id;
end; $$;

create or replace function public.register_approved_material_receipt_in_inventory(p_receipt_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r public.procurement_material_receipts%rowtype; item record; location_id uuid; begin
 select * into r from public.procurement_material_receipts where id=p_receipt_id and status='approved';
 if r.id is null then return; end if;
 location_id:=public.ensure_procurement_inventory_location(r.company_id,r.project_id,r.warehouse_location);
 for item in select * from public.procurement_material_receipt_items where receipt_id=r.id and accepted_quantity>0 order by sort_order loop
  perform public.post_procurement_inventory_movement(r.company_id,r.project_id,'receipt',r.receipt_date,item.input_id,null,location_id,item.accepted_quantity,item.unit_cost,item.batch_number,item.expiration_date,item.cost_center_service_id,null,'material_receipt',item.id,r.receipt_number,concat_ws(' · ','Entrada por recebimento aprovado',r.invoice_number));
 end loop;
end; $$;

create or replace function public.inventory_receipt_approved_trigger()
returns trigger language plpgsql security definer set search_path=public as $$ begin
 if new.status='approved' and old.status is distinct from 'approved' then perform public.register_approved_material_receipt_in_inventory(new.id); end if;
 return new;
end; $$;
drop trigger if exists inventory_receipt_approved on public.procurement_material_receipts;
create trigger inventory_receipt_approved after update of status on public.procurement_material_receipts for each row execute function public.inventory_receipt_approved_trigger();

create or replace function public.save_procurement_inventory_location(p_company_id uuid,p_project_id uuid,p_location_id uuid,p_code text,p_name text,p_type text,p_address text,p_responsible_name text,p_allow_negative boolean,p_notes text)
returns uuid language plpgsql security definer set search_path=public as $$ declare resolved uuid; begin
 if not public.has_company_permission(p_company_id,'procurement.inventory.manage') then raise exception 'Sem permissão para administrar locais de estoque.'; end if;
 if nullif(trim(coalesce(p_code,'')),'') is null or nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Informe código e nome do local.'; end if;
 if p_location_id is null then
  insert into public.procurement_inventory_locations(company_id,project_id,code,name,location_type,address,responsible_name,allow_negative,notes,created_by)
  values(p_company_id,p_project_id,upper(trim(p_code)),trim(p_name),coalesce(p_type,'warehouse'),nullif(trim(coalesce(p_address,'')),''),nullif(trim(coalesce(p_responsible_name,'')),''),coalesce(p_allow_negative,false),nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id into resolved;
 else
  update public.procurement_inventory_locations set code=upper(trim(p_code)),name=trim(p_name),location_type=coalesce(p_type,'warehouse'),address=nullif(trim(coalesce(p_address,'')),''),responsible_name=nullif(trim(coalesce(p_responsible_name,'')),''),allow_negative=coalesce(p_allow_negative,false),notes=nullif(trim(coalesce(p_notes,'')),''),updated_at=now() where id=p_location_id and company_id=p_company_id and project_id=p_project_id returning id into resolved;
 end if;
 if resolved is null then raise exception 'Local de estoque não encontrado.'; end if;
 return resolved;
end; $$;

create or replace function public.set_procurement_inventory_threshold(p_company_id uuid,p_project_id uuid,p_balance_id uuid,p_minimum numeric,p_maximum numeric)
returns uuid language plpgsql security definer set search_path=public as $$ declare resolved uuid; begin
 if not public.has_company_permission(p_company_id,'procurement.inventory.manage') then raise exception 'Sem permissão para alterar parâmetros de estoque.'; end if;
 if coalesce(p_minimum,0)<0 or (p_maximum is not null and p_maximum<p_minimum) then raise exception 'Revise os níveis mínimo e máximo.'; end if;
 update public.procurement_inventory_balances set minimum_quantity=coalesce(p_minimum,0),maximum_quantity=p_maximum,updated_at=now() where id=p_balance_id and company_id=p_company_id and project_id=p_project_id returning id into resolved;
 if resolved is null then raise exception 'Saldo não encontrado.'; end if; return resolved;
end; $$;

create or replace function public.save_procurement_inventory_count(p_company_id uuid,p_project_id uuid,p_count_id uuid,p_location_id uuid,p_count_date date,p_notes text,p_items jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare c public.procurement_inventory_counts%rowtype; b public.procurement_inventory_balances%rowtype; item jsonb; resolved uuid; seq integer; n integer:=0; counted numeric; counter text; begin
 if not public.has_company_permission(p_company_id,'procurement.inventory.count') then raise exception 'Sem permissão para registrar inventários.'; end if;
 if p_count_date is null then raise exception 'Informe a data do inventário.'; end if;
 if not exists(select 1 from public.procurement_inventory_locations where id=p_location_id and company_id=p_company_id and project_id=p_project_id and status='active') then raise exception 'Local de estoque inválido.'; end if;
 counter:=coalesce(nullif(auth.jwt()->>'email',''),'Usuário');
 if p_count_id is null then
  perform pg_advisory_xact_lock(hashtext(p_project_id::text||':inventory-counts'));
  select coalesce(max(sequence_no),0)+1 into seq from public.procurement_inventory_counts where project_id=p_project_id;
  insert into public.procurement_inventory_counts(company_id,project_id,location_id,sequence_no,count_number,count_date,notes,counter_user_id,counter_name,created_by)
  values(p_company_id,p_project_id,p_location_id,seq,'INV-'||lpad(seq::text,4,'0'),p_count_date,nullif(trim(coalesce(p_notes,'')),''),auth.uid(),counter,auth.uid()) returning id into resolved;
 else
  select * into c from public.procurement_inventory_counts where id=p_count_id and company_id=p_company_id and project_id=p_project_id for update;
  if c.id is null or c.status<>'draft' then raise exception 'Inventário não disponível para edição.'; end if;
  resolved:=c.id; delete from public.procurement_inventory_count_items where count_id=resolved;
  update public.procurement_inventory_counts set location_id=p_location_id,count_date=p_count_date,notes=nullif(trim(coalesce(p_notes,'')),''),updated_at=now() where id=resolved;
 end if;
 if jsonb_typeof(p_items)<>'array' then raise exception 'Itens do inventário inválidos.'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  select * into b from public.procurement_inventory_balances where id=nullif(item->>'balance_id','')::uuid and company_id=p_company_id and project_id=p_project_id and location_id=p_location_id;
  if b.id is null then continue; end if;
  counted:=coalesce(nullif(item->>'counted_quantity','')::numeric,b.quantity_on_hand);
  if counted<0 then raise exception 'A quantidade contada não pode ser negativa.'; end if;
  n:=n+1;
  insert into public.procurement_inventory_count_items(company_id,project_id,count_id,balance_id,input_id,location_id,input_code,input_name,unit_snapshot,batch_number,expiration_date,book_quantity,counted_quantity,unit_cost,difference_value,notes,sort_order)
  values(p_company_id,p_project_id,resolved,b.id,b.input_id,b.location_id,b.input_code,b.input_name,b.unit_snapshot,b.batch_number,b.expiration_date,b.quantity_on_hand,counted,b.average_unit_cost,round((counted-b.quantity_on_hand)*b.average_unit_cost,2),nullif(trim(coalesce(item->>'notes','')),''),n);
 end loop;
 if n=0 then raise exception 'O local não possui itens para inventariar.'; end if;
 insert into public.procurement_inventory_audit(company_id,project_id,entity_type,entity_id,action,details,changed_by) values(p_company_id,p_project_id,'count',resolved,'saved',jsonb_build_object('items',n),auth.uid());
 return resolved;
end; $$;

create or replace function public.change_procurement_inventory_count_status(p_company_id uuid,p_project_id uuid,p_count_id uuid,p_action text,p_notes text)
returns text language plpgsql security definer set search_path=public as $$
declare c public.procurement_inventory_counts%rowtype; item record; next_status text; movement_type text; begin
 if not public.has_company_permission(p_company_id,'procurement.inventory.count') then raise exception 'Sem permissão para administrar inventários.'; end if;
 select * into c from public.procurement_inventory_counts where id=p_count_id and company_id=p_company_id and project_id=p_project_id for update;
 if c.id is null then raise exception 'Inventário não encontrado.'; end if;
 if p_action='submit' then
  if c.status<>'draft' then raise exception 'Inventário não disponível para envio.'; end if;
  next_status:='submitted'; update public.procurement_inventory_counts set status=next_status,submitted_by=auth.uid(),submitted_at=now(),updated_at=now() where id=c.id;
 elsif p_action='approve' then
  if c.status<>'submitted' then raise exception 'Inventário não disponível para aprovação.'; end if;
  for item in select * from public.procurement_inventory_count_items where count_id=c.id and abs(difference_quantity)>0.000001 order by sort_order loop
   movement_type:=case when item.difference_quantity>0 then 'adjustment_in' else 'adjustment_out' end;
   perform public.post_procurement_inventory_movement(p_company_id,p_project_id,movement_type,c.count_date,item.input_id,case when item.difference_quantity<0 then c.location_id else null end,case when item.difference_quantity>0 then c.location_id else null end,abs(item.difference_quantity),item.unit_cost,item.batch_number,item.expiration_date,null,null,'inventory_count',item.id,c.count_number,coalesce(nullif(trim(p_notes),''),'Ajuste por inventário físico'));
  end loop;
  next_status:='approved'; update public.procurement_inventory_counts set status=next_status,approved_by=auth.uid(),approved_at=now(),approval_notes=nullif(trim(coalesce(p_notes,'')),''),updated_at=now() where id=c.id;
 elsif p_action='cancel' then
  if c.status not in('draft','submitted') then raise exception 'Inventário não disponível para cancelamento.'; end if;
  if nullif(trim(coalesce(p_notes,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  next_status:='cancelled'; update public.procurement_inventory_counts set status=next_status,cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=trim(p_notes),updated_at=now() where id=c.id;
 else raise exception 'Ação de inventário inválida.'; end if;
 insert into public.procurement_inventory_audit(company_id,project_id,entity_type,entity_id,action,details,changed_by) values(p_company_id,p_project_id,'count',c.id,p_action,jsonb_build_object('previous_status',c.status,'new_status',next_status,'notes',p_notes),auth.uid());
 return next_status;
end; $$;

-- Registra no estoque recebimentos aprovados antes da instalação desta migration.
do $$ declare receipt record; begin
 for receipt in select id from public.procurement_material_receipts where status='approved' loop
  perform public.register_approved_material_receipt_in_inventory(receipt.id);
 end loop;
end $$;

grant select,insert,update,delete on public.procurement_inventory_locations,public.procurement_inventory_balances,public.procurement_inventory_movements,public.procurement_inventory_counts,public.procurement_inventory_count_items,public.procurement_inventory_audit to authenticated;
grant execute on function public.save_procurement_inventory_location(uuid,uuid,uuid,text,text,text,text,text,boolean,text) to authenticated;
grant execute on function public.set_procurement_inventory_threshold(uuid,uuid,uuid,numeric,numeric) to authenticated;
grant execute on function public.post_procurement_inventory_movement(uuid,uuid,text,date,uuid,uuid,uuid,numeric,numeric,text,date,uuid,text,text,uuid,text,text) to authenticated;
grant execute on function public.save_procurement_inventory_count(uuid,uuid,uuid,uuid,date,text,jsonb) to authenticated;
grant execute on function public.change_procurement_inventory_count_status(uuid,uuid,uuid,text,text) to authenticated;

commit;
