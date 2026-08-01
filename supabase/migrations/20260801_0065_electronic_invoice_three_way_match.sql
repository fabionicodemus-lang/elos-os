-- Elos OS — NF-e · conferência automática Pedido × Recebimento × Nota
-- Considera entregas e notas parciais, quantidade já faturada e tolerâncias por obra.

begin;

alter table public.finance_electronic_invoices
  add column if not exists three_way_status text not null default 'pending',
  add column if not exists three_way_checked_at timestamptz;

do $$ begin
  alter table public.finance_electronic_invoices
    add constraint finance_electronic_invoices_three_way_status_check
    check(three_way_status in('pending','matched','attention','blocked'));
exception when duplicate_object then null; end $$;

alter table public.finance_electronic_invoice_items
  add column if not exists receipt_quantity numeric(18,6),
  add column if not exists receipt_unit_cost numeric(18,6),
  add column if not exists previously_invoiced_quantity numeric(18,6) not null default 0,
  add column if not exists invoiceable_quantity numeric(18,6),
  add column if not exists three_way_status text not null default 'pending';

do $$ begin
  alter table public.finance_electronic_invoice_items
    add constraint finance_electronic_invoice_items_three_way_status_check
    check(three_way_status in('pending','matched','attention','blocked'));
exception when duplicate_object then null; end $$;

alter table public.finance_electronic_invoice_divergences
  add column if not exists rule_key text,
  add column if not exists match_snapshot jsonb not null default '{}'::jsonb;

create index if not exists finance_electronic_invoice_divergences_rule_idx
  on public.finance_electronic_invoice_divergences(invoice_id,rule_key,status);

create table if not exists public.finance_three_way_match_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  quantity_tolerance numeric(18,6) not null default 0.0001,
  price_absolute_tolerance numeric(18,6) not null default 0.01,
  price_percent_tolerance numeric(12,8) not null default 0.001,
  total_absolute_tolerance numeric(18,2) not null default 0.05,
  require_order boolean not null default true,
  require_receipt boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_three_way_match_settings_values_check check(
    quantity_tolerance>=0 and price_absolute_tolerance>=0 and price_percent_tolerance>=0 and total_absolute_tolerance>=0
  )
);

create unique index if not exists finance_three_way_match_settings_scope_idx
  on public.finance_three_way_match_settings(
    company_id,
    coalesce(project_id,'00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table public.finance_three_way_match_settings enable row level security;
drop policy if exists finance_three_way_match_settings_select on public.finance_three_way_match_settings;
create policy finance_three_way_match_settings_select on public.finance_three_way_match_settings
for select to authenticated using(
  public.has_company_permission(company_id,'finance.invoices.view')
  or public.has_company_permission(company_id,'finance.invoices.manage')
  or public.has_company_permission(company_id,'finance.invoices.approve')
);
drop policy if exists finance_three_way_match_settings_write on public.finance_three_way_match_settings;
create policy finance_three_way_match_settings_write on public.finance_three_way_match_settings
for all to authenticated using(
  public.has_company_permission(company_id,'finance.invoices.approve')
) with check(
  public.has_company_permission(company_id,'finance.invoices.approve')
);

grant select,insert,update,delete on public.finance_three_way_match_settings to authenticated;

create or replace function public.finance_register_three_way_divergence(
  p_invoice_id uuid,
  p_invoice_item_id uuid,
  p_rule_key text,
  p_divergence_type text,
  p_severity text,
  p_title text,
  p_description text,
  p_expected_value text,
  p_actual_value text,
  p_snapshot jsonb
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice public.finance_electronic_invoices%rowtype;
begin
  select * into v_invoice from public.finance_electronic_invoices where id=p_invoice_id;
  if v_invoice.id is null then raise exception 'NF-e não encontrada para a conferência.'; end if;

  -- Uma dispensa permanece válida somente enquanto o cálculo que a originou continuar idêntico.
  if exists(
    select 1 from public.finance_electronic_invoice_divergences d
    where d.invoice_id=p_invoice_id
      and d.rule_key=p_rule_key
      and d.status='waived'
      and d.match_snapshot=coalesce(p_snapshot,'{}'::jsonb)
  ) then
    return;
  end if;

  insert into public.finance_electronic_invoice_divergences(
    company_id,project_id,invoice_id,invoice_item_id,divergence_type,severity,title,description,
    expected_value,actual_value,status,rule_key,match_snapshot
  ) values(
    v_invoice.company_id,v_invoice.project_id,p_invoice_id,p_invoice_item_id,p_divergence_type,p_severity,
    p_title,p_description,p_expected_value,p_actual_value,'open',p_rule_key,coalesce(p_snapshot,'{}'::jsonb)
  );
end;
$$;

create or replace function public.refresh_finance_electronic_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  open_high integer;
  all_open integer;
  total_items integer;
  mapped_items integer;
  payment_sum numeric;
  match_open integer;
  match_high integer;
  next_match_status text;
begin
  select count(*),count(*) filter(where input_id is not null)
  into total_items,mapped_items
  from public.finance_electronic_invoice_items where invoice_id=p_invoice_id;

  select count(*) filter(where status='open' and severity in('high','critical')),
         count(*) filter(where status='open')
  into open_high,all_open
  from public.finance_electronic_invoice_divergences where invoice_id=p_invoice_id;

  select count(*) filter(where status='open'),
         count(*) filter(where status='open' and severity in('high','critical'))
  into match_open,match_high
  from public.finance_electronic_invoice_divergences
  where invoice_id=p_invoice_id and rule_key like '3way:%';

  next_match_status:=case
    when match_high>0 then 'blocked'
    when match_open>0 then 'attention'
    when total_items>0 then 'matched'
    else 'pending'
  end;

  select coalesce(sum(amount),0) into payment_sum
  from public.finance_electronic_invoice_installments where invoice_id=p_invoice_id;

  update public.finance_electronic_invoices set
    item_count=total_items,
    mapped_item_count=mapped_items,
    divergence_count=all_open,
    payment_total=payment_sum,
    three_way_status=next_match_status,
    validation_status=case
      when open_high>0 then 'blocked'
      when mapped_items<total_items or all_open>0 then 'attention'
      else 'ready'
    end,
    updated_at=now()
  where id=p_invoice_id;
end;
$$;

create or replace function public.recompute_finance_electronic_invoice_three_way_match(p_invoice_id uuid)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice public.finance_electronic_invoices%rowtype;
  v_order public.procurement_purchase_orders%rowtype;
  v_receipt public.procurement_material_receipts%rowtype;
  v_item public.finance_electronic_invoice_items%rowtype;
  v_order_item public.procurement_purchase_order_items%rowtype;
  v_receipt_item public.procurement_material_receipt_items%rowtype;
  v_quantity_tolerance numeric(18,6):=0.0001;
  v_price_absolute_tolerance numeric(18,6):=0.01;
  v_price_percent_tolerance numeric(12,8):=0.001;
  v_require_order boolean:=true;
  v_require_receipt boolean:=true;
  v_previous_order_qty numeric(18,6);
  v_previous_receipt_qty numeric(18,6);
  v_order_capacity numeric(18,6);
  v_receipt_capacity numeric(18,6);
  v_invoiceable numeric(18,6);
  v_price_difference numeric(18,6);
  v_price_limit numeric(18,6);
  v_unit_xml text;
  v_unit_order text;
  v_unit_receipt text;
  v_item_status text;
  v_snapshot jsonb;
  v_result text;
begin
  perform pg_advisory_xact_lock(hashtext(p_invoice_id::text||':three-way-match'));

  select * into v_invoice
  from public.finance_electronic_invoices
  where id=p_invoice_id
  for update;
  if v_invoice.id is null then raise exception 'NF-e não encontrada.'; end if;

  select
    s.quantity_tolerance,s.price_absolute_tolerance,s.price_percent_tolerance,
    s.require_order,s.require_receipt
  into
    v_quantity_tolerance,v_price_absolute_tolerance,v_price_percent_tolerance,
    v_require_order,v_require_receipt
  from public.finance_three_way_match_settings s
  where s.company_id=v_invoice.company_id
    and (s.project_id=v_invoice.project_id or s.project_id is null)
  order by (s.project_id=v_invoice.project_id) desc,s.updated_at desc
  limit 1;

  v_quantity_tolerance:=coalesce(v_quantity_tolerance,0.0001);
  v_price_absolute_tolerance:=coalesce(v_price_absolute_tolerance,0.01);
  v_price_percent_tolerance:=coalesce(v_price_percent_tolerance,0.001);
  v_require_order:=coalesce(v_require_order,true);
  v_require_receipt:=coalesce(v_require_receipt,true);

  -- Remove o resultado automático anterior, preservando resoluções e dispensas para auditoria.
  delete from public.finance_electronic_invoice_divergences
  where invoice_id=p_invoice_id and status='open' and rule_key like '3way:%';

  -- Remove comparações legadas que tratavam uma NF-e parcial como se fosse o pedido inteiro.
  delete from public.finance_electronic_invoice_divergences
  where invoice_id=p_invoice_id and status='open' and rule_key is null
    and title in(
      'Quantidade diferente do pedido',
      'Preço unitário diferente do pedido',
      'Valor da NF-e diferente do pedido'
    );

  if v_invoice.order_id is not null then
    select * into v_order from public.procurement_purchase_orders
    where id=v_invoice.order_id and company_id=v_invoice.company_id and project_id=v_invoice.project_id;
  end if;
  if v_invoice.receipt_id is not null then
    select * into v_receipt from public.procurement_material_receipts
    where id=v_invoice.receipt_id and company_id=v_invoice.company_id and project_id=v_invoice.project_id;
  end if;

  if v_require_order and v_order.id is null then
    perform public.finance_register_three_way_divergence(
      p_invoice_id,null,'3way:header:order_missing','order','critical',
      'NF-e sem Pedido de Compra',
      'Vincule a NF-e a um Pedido de Compra emitido antes de aprová-la.',
      'Pedido de Compra vinculado',coalesce(v_invoice.order_id::text,'Sem vínculo'),
      jsonb_build_object('order_id',v_invoice.order_id)
    );
  end if;

  if v_require_receipt and v_receipt.id is null then
    perform public.finance_register_three_way_divergence(
      p_invoice_id,null,'3way:header:receipt_missing','receipt','critical',
      'NF-e sem recebimento aprovado',
      'Vincule a NF-e a um recebimento físico aprovado antes de aprová-la.',
      'Recebimento aprovado vinculado',coalesce(v_invoice.receipt_id::text,'Sem vínculo'),
      jsonb_build_object('receipt_id',v_invoice.receipt_id)
    );
  end if;

  if v_order.id is not null and v_order.supplier_id<>v_invoice.supplier_id then
    perform public.finance_register_three_way_divergence(
      p_invoice_id,null,'3way:header:order_supplier','supplier','critical',
      'Fornecedor da NF-e diferente do Pedido',
      'O fornecedor vinculado à nota não é o mesmo fornecedor do Pedido de Compra.',
      v_order.supplier_id::text,v_invoice.supplier_id::text,
      jsonb_build_object('order_supplier_id',v_order.supplier_id,'invoice_supplier_id',v_invoice.supplier_id)
    );
  end if;

  if v_receipt.id is not null and v_receipt.supplier_id<>v_invoice.supplier_id then
    perform public.finance_register_three_way_divergence(
      p_invoice_id,null,'3way:header:receipt_supplier','supplier','critical',
      'Fornecedor da NF-e diferente do recebimento',
      'O fornecedor vinculado à nota não é o mesmo fornecedor do recebimento.',
      v_receipt.supplier_id::text,v_invoice.supplier_id::text,
      jsonb_build_object('receipt_supplier_id',v_receipt.supplier_id,'invoice_supplier_id',v_invoice.supplier_id)
    );
  end if;

  if v_order.id is not null and v_receipt.id is not null and v_receipt.order_id<>v_order.id then
    perform public.finance_register_three_way_divergence(
      p_invoice_id,null,'3way:header:receipt_order','receipt','critical',
      'Recebimento pertence a outro Pedido',
      'O recebimento selecionado não pertence ao Pedido de Compra vinculado à NF-e.',
      v_order.id::text,v_receipt.order_id::text,
      jsonb_build_object('invoice_order_id',v_order.id,'receipt_order_id',v_receipt.order_id)
    );
  end if;

  for v_item in
    select * from public.finance_electronic_invoice_items
    where invoice_id=p_invoice_id
    order by line_number
  loop
    v_order_item:=null;
    v_receipt_item:=null;
    v_item_status:='matched';

    if v_item.order_item_id is not null and v_order.id is not null then
      select * into v_order_item from public.procurement_purchase_order_items
      where id=v_item.order_item_id and order_id=v_order.id
        and company_id=v_invoice.company_id and project_id=v_invoice.project_id;
    end if;
    if v_item.receipt_item_id is not null and v_receipt.id is not null then
      select * into v_receipt_item from public.procurement_material_receipt_items
      where id=v_item.receipt_item_id and receipt_id=v_receipt.id
        and company_id=v_invoice.company_id and project_id=v_invoice.project_id;
    end if;

    if v_order_item.id is null then
      v_item_status:='blocked';
      perform public.finance_register_three_way_divergence(
        p_invoice_id,v_item.id,'3way:item:'||v_item.id||':order_item_missing','order','critical',
        'Item da NF-e sem item do Pedido',
        'Associe esta linha do XML ao item correspondente do Pedido de Compra.',
        'Item do Pedido vinculado',coalesce(v_item.order_item_id::text,'Sem vínculo'),
        jsonb_build_object('invoice_item_id',v_item.id,'order_item_id',v_item.order_item_id)
      );
    end if;

    if v_receipt_item.id is null then
      v_item_status:='blocked';
      perform public.finance_register_three_way_divergence(
        p_invoice_id,v_item.id,'3way:item:'||v_item.id||':receipt_item_missing','receipt','critical',
        'Item da NF-e sem item recebido',
        'Associe esta linha do XML ao item efetivamente aceito no recebimento.',
        'Item de recebimento vinculado',coalesce(v_item.receipt_item_id::text,'Sem vínculo'),
        jsonb_build_object('invoice_item_id',v_item.id,'receipt_item_id',v_item.receipt_item_id)
      );
    end if;

    if v_order_item.id is null or v_receipt_item.id is null then
      update public.finance_electronic_invoice_items set
        three_way_status=v_item_status,
        receipt_quantity=case when v_receipt_item.id is null then null else v_receipt_item.accepted_quantity end,
        receipt_unit_cost=case when v_receipt_item.id is null then null else v_receipt_item.unit_cost end,
        previously_invoiced_quantity=0,
        invoiceable_quantity=0,
        quantity_variance=v_item.quantity,
        updated_at=now()
      where id=v_item.id;
      continue;
    end if;

    if v_receipt_item.order_item_id<>v_order_item.id then
      v_item_status:='blocked';
      perform public.finance_register_three_way_divergence(
        p_invoice_id,v_item.id,'3way:item:'||v_item.id||':receipt_order_item','receipt','critical',
        'Item recebido pertence a outro item do Pedido',
        'O item de recebimento e o item do Pedido selecionados não representam a mesma compra.',
        v_order_item.id::text,v_receipt_item.order_item_id::text,
        jsonb_build_object('order_item_id',v_order_item.id,'receipt_order_item_id',v_receipt_item.order_item_id)
      );
    end if;

    if v_item.input_id is distinct from v_order_item.input_id
       or v_item.input_id is distinct from v_receipt_item.input_id then
      v_item_status:='blocked';
      perform public.finance_register_three_way_divergence(
        p_invoice_id,v_item.id,'3way:item:'||v_item.id||':input','item_mapping','high',
        'Insumo divergente entre Pedido, recebimento e NF-e',
        'Os três documentos precisam apontar para o mesmo insumo do Elos OS.',
        coalesce(v_order_item.input_id::text,'Sem insumo'),coalesce(v_item.input_id::text,'Sem insumo'),
        jsonb_build_object('order_input_id',v_order_item.input_id,'receipt_input_id',v_receipt_item.input_id,'invoice_input_id',v_item.input_id)
      );
    end if;

    v_unit_xml:=lower(regexp_replace(coalesce(v_item.unit_snapshot,''),'\s','','g'));
    v_unit_order:=lower(regexp_replace(coalesce(v_order_item.unit_snapshot,''),'\s','','g'));
    v_unit_receipt:=lower(regexp_replace(coalesce(v_receipt_item.unit_snapshot,''),'\s','','g'));
    if v_unit_xml='' or v_unit_order='' or v_unit_receipt=''
       or v_unit_xml<>v_unit_order or v_unit_xml<>v_unit_receipt then
      v_item_status:='blocked';
      perform public.finance_register_three_way_divergence(
        p_invoice_id,v_item.id,'3way:item:'||v_item.id||':unit','item_mapping','high',
        'Unidade divergente entre os documentos',
        'A conversão de unidade precisa ser tratada antes da aprovação da NF-e.',
        concat_ws(' / ',nullif(v_order_item.unit_snapshot,''),nullif(v_receipt_item.unit_snapshot,'')),
        coalesce(v_item.unit_snapshot,'Não informada'),
        jsonb_build_object('order_unit',v_order_item.unit_snapshot,'receipt_unit',v_receipt_item.unit_snapshot,'invoice_unit',v_item.unit_snapshot)
      );
    end if;

    select coalesce(sum(ii.quantity),0) into v_previous_order_qty
    from public.finance_electronic_invoice_items ii
    join public.finance_electronic_invoices i on i.id=ii.invoice_id
    where ii.order_item_id=v_order_item.id
      and i.id<>p_invoice_id
      and i.status in('review','approved');

    select coalesce(sum(ii.quantity),0) into v_previous_receipt_qty
    from public.finance_electronic_invoice_items ii
    join public.finance_electronic_invoices i on i.id=ii.invoice_id
    where ii.receipt_item_id=v_receipt_item.id
      and i.id<>p_invoice_id
      and i.status in('review','approved');

    v_order_capacity:=greatest(0,
      coalesce(v_order_item.ordered_quantity,0)-coalesce(v_order_item.cancelled_quantity,0)-v_previous_order_qty
    );
    v_receipt_capacity:=greatest(0,
      coalesce(v_receipt_item.accepted_quantity,0)-v_previous_receipt_qty
    );
    v_invoiceable:=least(v_order_capacity,v_receipt_capacity);

    if v_item.quantity>v_order_capacity+v_quantity_tolerance then
      v_item_status:='blocked';
      v_snapshot:=jsonb_build_object(
        'ordered_quantity',v_order_item.ordered_quantity,
        'cancelled_quantity',v_order_item.cancelled_quantity,
        'previously_invoiced',v_previous_order_qty,
        'available',v_order_capacity,
        'invoice_quantity',v_item.quantity
      );
      perform public.finance_register_three_way_divergence(
        p_invoice_id,v_item.id,'3way:item:'||v_item.id||':order_capacity','quantity','critical',
        'Quantidade faturada excede o saldo do Pedido',
        'A NF-e atual, somada às outras notas, ultrapassa a quantidade ainda disponível no Pedido.',
        v_order_capacity::text,v_item.quantity::text,v_snapshot
      );
    end if;

    if v_item.quantity>v_receipt_capacity+v_quantity_tolerance then
      v_item_status:='blocked';
      v_snapshot:=jsonb_build_object(
        'accepted_quantity',v_receipt_item.accepted_quantity,
        'previously_invoiced',v_previous_receipt_qty,
        'available',v_receipt_capacity,
        'invoice_quantity',v_item.quantity
      );
      perform public.finance_register_three_way_divergence(
        p_invoice_id,v_item.id,'3way:item:'||v_item.id||':receipt_capacity','quantity','critical',
        'Quantidade faturada excede o material aceito',
        'A NF-e atual, somada às outras notas, ultrapassa a quantidade aceita neste recebimento.',
        v_receipt_capacity::text,v_item.quantity::text,v_snapshot
      );
    end if;

    v_price_difference:=v_item.unit_price-v_order_item.unit_price;
    v_price_limit:=greatest(v_price_absolute_tolerance,abs(v_order_item.unit_price)*v_price_percent_tolerance);
    if abs(v_price_difference)>v_price_limit then
      v_item_status:='blocked';
      perform public.finance_register_three_way_divergence(
        p_invoice_id,v_item.id,'3way:item:'||v_item.id||':order_price','price','high',
        'Preço unitário diferente do Pedido',
        'O preço unitário da NF-e está fora da tolerância definida para a obra.',
        v_order_item.unit_price::text,v_item.unit_price::text,
        jsonb_build_object('order_price',v_order_item.unit_price,'invoice_price',v_item.unit_price,'allowed_difference',v_price_limit)
      );
    end if;

    if abs(v_item.unit_price-v_receipt_item.unit_cost)>v_price_limit then
      v_item_status:='blocked';
      perform public.finance_register_three_way_divergence(
        p_invoice_id,v_item.id,'3way:item:'||v_item.id||':receipt_price','price','high',
        'Preço unitário diferente do recebimento',
        'O preço da NF-e não coincide com o custo unitário conferido no recebimento.',
        v_receipt_item.unit_cost::text,v_item.unit_price::text,
        jsonb_build_object('receipt_unit_cost',v_receipt_item.unit_cost,'invoice_price',v_item.unit_price,'allowed_difference',v_price_limit)
      );
    end if;

    update public.finance_electronic_invoice_items set
      order_quantity=coalesce(v_order_item.ordered_quantity,0)-coalesce(v_order_item.cancelled_quantity,0),
      order_unit_price=v_order_item.unit_price,
      receipt_quantity=v_receipt_item.accepted_quantity,
      receipt_unit_cost=v_receipt_item.unit_cost,
      previously_invoiced_quantity=greatest(v_previous_order_qty,v_previous_receipt_qty),
      invoiceable_quantity=v_invoiceable,
      quantity_variance=v_item.quantity-v_invoiceable,
      unit_price_variance=v_item.unit_price-v_order_item.unit_price,
      three_way_status=v_item_status,
      mapping_status=case when v_item_status='blocked' then 'divergent' else 'matched' end,
      updated_at=now()
    where id=v_item.id;
  end loop;

  update public.finance_electronic_invoices set three_way_checked_at=now(),updated_at=now()
  where id=p_invoice_id;
  perform public.refresh_finance_electronic_invoice(p_invoice_id);
  select three_way_status into v_result from public.finance_electronic_invoices where id=p_invoice_id;

  insert into public.finance_electronic_invoice_audit(
    company_id,project_id,invoice_id,action,details,changed_by
  ) values(
    v_invoice.company_id,v_invoice.project_id,p_invoice_id,'three_way_recomputed',
    jsonb_build_object(
      'status',v_result,
      'open_divergences',(select count(*) from public.finance_electronic_invoice_divergences where invoice_id=p_invoice_id and status='open' and rule_key like '3way:%'),
      'checked_at',now()
    ),auth.uid()
  );
  return v_result;
end;
$$;

create or replace function public.trigger_recompute_finance_three_way_match()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.recompute_finance_electronic_invoice_three_way_match(coalesce(new.invoice_id,old.invoice_id));
  return coalesce(new,old);
end;
$$;

drop trigger if exists finance_invoice_items_three_way_insert on public.finance_electronic_invoice_items;
create trigger finance_invoice_items_three_way_insert
after insert on public.finance_electronic_invoice_items
for each row execute function public.trigger_recompute_finance_three_way_match();

drop trigger if exists finance_invoice_items_three_way_update on public.finance_electronic_invoice_items;
create trigger finance_invoice_items_three_way_update
after update of order_item_id,receipt_item_id,input_id,quantity,unit_price,unit_snapshot
on public.finance_electronic_invoice_items
for each row execute function public.trigger_recompute_finance_three_way_match();

drop trigger if exists finance_invoice_items_three_way_delete on public.finance_electronic_invoice_items;
create trigger finance_invoice_items_three_way_delete
after delete on public.finance_electronic_invoice_items
for each row execute function public.trigger_recompute_finance_three_way_match();

create or replace function public.guard_finance_invoice_three_way_approval()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_match_status text;
begin
  if new.status='approved' and old.status is distinct from new.status then
    perform public.recompute_finance_electronic_invoice_three_way_match(old.id);
    select three_way_status into v_match_status
    from public.finance_electronic_invoices where id=old.id;
    if v_match_status='blocked' then
      raise exception 'A NF-e está bloqueada pela conferência Pedido × Recebimento × Nota. Trate ou dispense as divergências antes de aprovar.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists finance_invoice_three_way_approval_guard on public.finance_electronic_invoices;
create trigger finance_invoice_three_way_approval_guard
before update of status on public.finance_electronic_invoices
for each row execute function public.guard_finance_invoice_three_way_approval();

-- Recalcula documentos existentes sem alterar títulos já gerados.
do $$
declare v_invoice record;
begin
  for v_invoice in
    select id from public.finance_electronic_invoices where status<>'cancelled'
  loop
    perform public.recompute_finance_electronic_invoice_three_way_match(v_invoice.id);
  end loop;
end $$;

revoke all on function public.finance_register_three_way_divergence(uuid,uuid,text,text,text,text,text,text,text,jsonb) from public,authenticated;
revoke all on function public.recompute_finance_electronic_invoice_three_way_match(uuid) from public,authenticated;
revoke all on function public.trigger_recompute_finance_three_way_match() from public,authenticated;
revoke all on function public.guard_finance_invoice_three_way_approval() from public,authenticated;
grant execute on function public.refresh_finance_electronic_invoice(uuid) to authenticated;

commit;
