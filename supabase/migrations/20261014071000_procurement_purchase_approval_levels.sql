-- Elos OS — Suprimentos 9.5 · Alçadas de aprovação de Pedidos de Compra

begin;

create table if not exists public.procurement_purchase_approval_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  enabled boolean not null default false,
  level1_limit numeric(18,2) not null default 5000,
  level2_limit numeric(18,2) not null default 40000,
  require_distinct_approvers boolean not null default true,
  requester_cannot_approve boolean not null default true,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint procurement_purchase_approval_settings_limits_check check (
    level1_limit >= 0 and level2_limit > level1_limit
  )
);

alter table public.procurement_purchase_orders
  add column if not exists approval_status text not null default 'not_required',
  add column if not exists required_approval_level integer not null default 0,
  add column if not exists current_approval_level integer not null default 0,
  add column if not exists approval_submitted_by uuid references auth.users(id),
  add column if not exists approval_submitted_at timestamptz,
  add column if not exists approval_completed_at timestamptz,
  add column if not exists approval_rejected_by uuid references auth.users(id),
  add column if not exists approval_rejected_at timestamptz,
  add column if not exists approval_rejection_reason text;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='procurement_purchase_orders_approval_status_check') then
    alter table public.procurement_purchase_orders add constraint procurement_purchase_orders_approval_status_check
      check(approval_status in('not_required','pending','approved','rejected'));
  end if;
  if not exists(select 1 from pg_constraint where conname='procurement_purchase_orders_approval_level_check') then
    alter table public.procurement_purchase_orders add constraint procurement_purchase_orders_approval_level_check
      check(required_approval_level between 0 and 3 and current_approval_level between 0 and 3 and current_approval_level<=required_approval_level);
  end if;
end $$;

create table if not exists public.procurement_purchase_order_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  order_id uuid not null references public.procurement_purchase_orders(id) on delete cascade,
  approval_level integer not null check(approval_level between 1 and 3),
  decision text not null check(decision in('approved','rejected')),
  notes text,
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now()
);
create index if not exists procurement_purchase_order_approvals_order_idx on public.procurement_purchase_order_approvals(order_id,approval_level,decided_at);
create unique index if not exists procurement_purchase_order_approval_level_unique
  on public.procurement_purchase_order_approvals(order_id,approval_level)
  where decision='approved';

insert into public.permissions(key,module,action,description) values
  ('procurement.orders.approve','procurement_orders','approve','Aprovar ou rejeitar pedidos de compra por alçada'),
  ('procurement.approval_settings.manage','procurement_orders','manage_approval_settings','Configurar limites e regras das alçadas de compras')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values('procurement.orders.approve'),('procurement.approval_settings.manage')) p(permission_key)
where r.key in('owner','admin','director')
on conflict(role_id,permission_key) do update set allowed=true;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'procurement.orders.approve',true from public.roles r
where r.key='finance'
on conflict(role_id,permission_key) do update set allowed=true;

alter table public.procurement_purchase_approval_settings enable row level security;
alter table public.procurement_purchase_order_approvals enable row level security;

drop policy if exists procurement_purchase_approval_settings_select on public.procurement_purchase_approval_settings;
create policy procurement_purchase_approval_settings_select on public.procurement_purchase_approval_settings for select to authenticated using(
  public.has_company_permission(company_id,'procurement.orders.view') or public.has_company_permission(company_id,'procurement.orders.approve')
);
drop policy if exists procurement_purchase_approval_settings_write on public.procurement_purchase_approval_settings;
create policy procurement_purchase_approval_settings_write on public.procurement_purchase_approval_settings for all to authenticated using(
  public.has_company_permission(company_id,'procurement.approval_settings.manage')
) with check(public.has_company_permission(company_id,'procurement.approval_settings.manage'));

drop policy if exists procurement_purchase_order_approvals_select on public.procurement_purchase_order_approvals;
create policy procurement_purchase_order_approvals_select on public.procurement_purchase_order_approvals for select to authenticated using(
  public.has_company_permission(company_id,'procurement.orders.view') or public.has_company_permission(company_id,'procurement.orders.approve')
);

create or replace function public.procurement_required_approval_level(p_company_id uuid,p_total numeric)
returns integer language sql stable security definer set search_path=public as $$
  select case
    when s.company_id is null or not s.enabled then 0
    when coalesce(p_total,0)<=s.level1_limit then 1
    when coalesce(p_total,0)<=s.level2_limit then 2
    else 3 end
  from (select p_company_id company_id) x
  left join public.procurement_purchase_approval_settings s on s.company_id=x.company_id;
$$;

create or replace function public.save_procurement_purchase_approval_settings(
  p_company_id uuid,p_enabled boolean,p_level1_limit numeric,p_level2_limit numeric,
  p_require_distinct boolean,p_requester_cannot_approve boolean
) returns uuid language plpgsql security definer set search_path=public as $$
begin
  if not public.has_company_permission(p_company_id,'procurement.approval_settings.manage') then raise exception 'Sem permissão para configurar alçadas.'; end if;
  if coalesce(p_level1_limit,-1)<0 or coalesce(p_level2_limit,-1)<=coalesce(p_level1_limit,-1) then raise exception 'Os limites das alçadas são inválidos.'; end if;
  insert into public.procurement_purchase_approval_settings(company_id,enabled,level1_limit,level2_limit,require_distinct_approvers,requester_cannot_approve,updated_by,updated_at)
  values(p_company_id,coalesce(p_enabled,false),p_level1_limit,p_level2_limit,coalesce(p_require_distinct,true),coalesce(p_requester_cannot_approve,true),auth.uid(),now())
  on conflict(company_id) do update set enabled=excluded.enabled,level1_limit=excluded.level1_limit,level2_limit=excluded.level2_limit,require_distinct_approvers=excluded.require_distinct_approvers,requester_cannot_approve=excluded.requester_cannot_approve,updated_by=auth.uid(),updated_at=now();
  return p_company_id;
end; $$;

create or replace function public.submit_procurement_purchase_order_for_approval(p_company_id uuid,p_project_id uuid,p_order_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare o public.procurement_purchase_orders%rowtype; required_level integer; begin
  if not(public.has_company_permission(p_company_id,'procurement.orders.manage') or public.has_company_permission(p_company_id,'procurement.orders.issue')) then raise exception 'Sem permissão para enviar o pedido para aprovação.'; end if;
  select * into o from public.procurement_purchase_orders where id=p_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if o.id is null or o.status<>'draft' then raise exception 'Somente pedidos em elaboração podem ser enviados para aprovação.'; end if;
  if o.total_amount<=0 then raise exception 'O pedido precisa possuir valor maior que zero.'; end if;
  required_level:=public.procurement_required_approval_level(p_company_id,o.total_amount);
  delete from public.procurement_purchase_order_approvals where order_id=o.id;
  update public.procurement_purchase_orders set
    required_approval_level=required_level,current_approval_level=0,
    approval_status=case when required_level=0 then 'not_required' else 'pending' end,
    approval_submitted_by=auth.uid(),approval_submitted_at=now(),approval_completed_at=case when required_level=0 then now() else null end,
    approval_rejected_by=null,approval_rejected_at=null,approval_rejection_reason=null,updated_by=auth.uid(),updated_at=now()
  where id=o.id;
  insert into public.procurement_purchase_order_audit(company_id,project_id,order_id,action,previous_status,new_status,details,changed_by)
  values(p_company_id,p_project_id,o.id,'approval_submitted',o.status,o.status,jsonb_build_object('required_level',required_level,'total_amount',o.total_amount),auth.uid());
  return case when required_level=0 then 'not_required' else 'pending' end;
end; $$;

create or replace function public.approve_procurement_purchase_order_level(p_company_id uuid,p_project_id uuid,p_order_id uuid,p_notes text)
returns text language plpgsql security definer set search_path=public as $$
declare o public.procurement_purchase_orders%rowtype; s public.procurement_purchase_approval_settings%rowtype; next_level integer; begin
  if not public.has_company_permission(p_company_id,'procurement.orders.approve') then raise exception 'Sem permissão para aprovar pedidos de compra.'; end if;
  select * into o from public.procurement_purchase_orders where id=p_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if o.id is null or o.status<>'draft' or o.approval_status<>'pending' then raise exception 'Pedido não disponível para aprovação.'; end if;
  select * into s from public.procurement_purchase_approval_settings where company_id=p_company_id;
  if coalesce(s.requester_cannot_approve,true) and o.created_by=auth.uid() then raise exception 'O criador do pedido não pode aprovar o próprio pedido.'; end if;
  if coalesce(s.require_distinct_approvers,true) and exists(select 1 from public.procurement_purchase_order_approvals where order_id=o.id and decision='approved' and decided_by=auth.uid()) then raise exception 'As alçadas deste pedido exigem aprovadores diferentes.'; end if;
  next_level:=o.current_approval_level+1;
  if next_level>o.required_approval_level then raise exception 'Todas as alçadas já foram concluídas.'; end if;
  insert into public.procurement_purchase_order_approvals(company_id,project_id,order_id,approval_level,decision,notes,decided_by)
  values(p_company_id,p_project_id,o.id,next_level,'approved',nullif(trim(coalesce(p_notes,'')),''),auth.uid());
  update public.procurement_purchase_orders set current_approval_level=next_level,
    approval_status=case when next_level>=required_approval_level then 'approved' else 'pending' end,
    approval_completed_at=case when next_level>=required_approval_level then now() else null end,
    updated_by=auth.uid(),updated_at=now()
  where id=o.id;
  insert into public.procurement_purchase_order_audit(company_id,project_id,order_id,action,previous_status,new_status,details,changed_by)
  values(p_company_id,p_project_id,o.id,'approval_level_approved',o.status,o.status,jsonb_build_object('level',next_level,'required_level',o.required_approval_level),auth.uid());
  return case when next_level>=o.required_approval_level then 'approved' else 'pending' end;
end; $$;

create or replace function public.reject_procurement_purchase_order_approval(p_company_id uuid,p_project_id uuid,p_order_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$
declare o public.procurement_purchase_orders%rowtype; next_level integer; begin
  if not public.has_company_permission(p_company_id,'procurement.orders.approve') then raise exception 'Sem permissão para rejeitar pedidos de compra.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo da rejeição.'; end if;
  select * into o from public.procurement_purchase_orders where id=p_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if o.id is null or o.status<>'draft' or o.approval_status<>'pending' then raise exception 'Pedido não disponível para rejeição.'; end if;
  next_level:=least(3,o.current_approval_level+1);
  insert into public.procurement_purchase_order_approvals(company_id,project_id,order_id,approval_level,decision,notes,decided_by)
  values(p_company_id,p_project_id,o.id,next_level,'rejected',trim(p_reason),auth.uid());
  update public.procurement_purchase_orders set approval_status='rejected',approval_rejected_by=auth.uid(),approval_rejected_at=now(),approval_rejection_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() where id=o.id;
  insert into public.procurement_purchase_order_audit(company_id,project_id,order_id,action,previous_status,new_status,reason,changed_by)
  values(p_company_id,p_project_id,o.id,'approval_rejected',o.status,o.status,trim(p_reason),auth.uid());
  return 'rejected';
end; $$;

-- Emissão agora respeita alçadas quando a empresa habilitar o recurso.
create or replace function public.issue_procurement_purchase_order(p_company_id uuid,p_project_id uuid,p_order_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare o public.procurement_purchase_orders%rowtype; item record; request_item public.execution_material_request_items%rowtype; approval_enabled boolean; begin
  if not public.has_company_permission(p_company_id,'procurement.orders.issue') then raise exception 'Sem permissão para emitir pedidos.'; end if;
  select * into o from public.procurement_purchase_orders where id=p_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if o.id is null or o.status<>'draft' then raise exception 'Pedido não disponível para emissão.'; end if;
  select coalesce(enabled,false) into approval_enabled from public.procurement_purchase_approval_settings where company_id=p_company_id;
  approval_enabled:=coalesce(approval_enabled,false);
  if approval_enabled and o.approval_status<>'approved' then raise exception 'O pedido precisa concluir as alçadas de aprovação antes da emissão.'; end if;
  if o.expected_delivery_date is null or nullif(trim(coalesce(o.delivery_address,'')),'') is null then raise exception 'Informe a data e o endereço de entrega antes da emissão.'; end if;
  if o.total_amount<=0 or not exists(select 1 from public.procurement_purchase_order_items where order_id=o.id) then raise exception 'O pedido precisa possuir itens e valor maior que zero.'; end if;
  for item in select * from public.procurement_purchase_order_items where order_id=o.id order by sort_order for update loop
    select * into request_item from public.execution_material_request_items where id=item.request_item_id for update;
    if request_item.id is null then raise exception 'Item de solicitação não encontrado.'; end if;
    if request_item.ordered_quantity+request_item.stock_fulfilled_quantity+item.ordered_quantity>request_item.requested_quantity+0.000001 then raise exception 'O pedido ultrapassa o saldo solicitado para %.',item.input_code; end if;
    update public.execution_material_request_items set ordered_quantity=ordered_quantity+item.ordered_quantity,updated_at=now() where id=request_item.id;
  end loop;
  update public.procurement_purchase_orders set status='issued',issue_date=current_date,issued_by=auth.uid(),issued_at=now(),updated_by=auth.uid(),updated_at=now() where id=o.id;
  insert into public.procurement_purchase_order_audit(company_id,project_id,order_id,action,previous_status,new_status,details,changed_by) values(p_company_id,p_project_id,o.id,'issued','draft','issued',jsonb_build_object('total_amount',o.total_amount,'approval_status',o.approval_status),auth.uid());
  return 'issued';
end; $$;

grant select,insert,update,delete on public.procurement_purchase_approval_settings to authenticated;
grant select on public.procurement_purchase_order_approvals to authenticated;
grant execute on function public.procurement_required_approval_level(uuid,numeric) to authenticated;
grant execute on function public.save_procurement_purchase_approval_settings(uuid,boolean,numeric,numeric,boolean,boolean) to authenticated;
grant execute on function public.submit_procurement_purchase_order_for_approval(uuid,uuid,uuid) to authenticated;
grant execute on function public.approve_procurement_purchase_order_level(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.reject_procurement_purchase_order_approval(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.issue_procurement_purchase_order(uuid,uuid,uuid) to authenticated;

commit;
