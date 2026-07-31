-- Elos OS — Parcelamento universal de títulos financeiros
-- D+15, recorrência mensal, valores editáveis e fechamento exato do lançamento.

begin;

-- -----------------------------------------------------------------------------
-- Validação de fechamento das parcelas já existentes em Notas Manuais e NF-e.
-- Constraint triggers diferidos validam o estado final da transação, permitindo
-- excluir/reinserir parcelas dentro das funções existentes sem falsos positivos.
-- -----------------------------------------------------------------------------

create or replace function public.validate_manual_invoice_installment_balance()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice_id uuid:=coalesce(new.invoice_id,old.invoice_id);
  v_net numeric(18,2);
  v_sum numeric(18,2);
  v_count integer;
begin
  select net_amount into v_net from public.finance_manual_invoices where id=v_invoice_id;
  if not found then return null; end if;

  select count(*),coalesce(round(sum(amount),2),0) into v_count,v_sum
  from public.finance_manual_invoice_installments where invoice_id=v_invoice_id;

  if v_count=0 then
    raise exception 'Informe ao menos uma parcela para o documento manual.';
  end if;
  if round(v_sum,2)<>round(v_net,2) then
    raise exception 'A soma das parcelas (%) precisa coincidir exatamente com o valor líquido do documento (%).',v_sum,v_net;
  end if;
  return null;
end;
$$;

drop trigger if exists finance_manual_invoice_installment_balance_trigger on public.finance_manual_invoice_installments;
create constraint trigger finance_manual_invoice_installment_balance_trigger
after insert or update or delete on public.finance_manual_invoice_installments
deferrable initially deferred
for each row execute function public.validate_manual_invoice_installment_balance();

create or replace function public.validate_electronic_invoice_installment_balance()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice_id uuid:=coalesce(new.invoice_id,old.invoice_id);
  v_total numeric(18,2);
  v_sum numeric(18,2);
  v_count integer;
begin
  select invoice_total into v_total from public.finance_electronic_invoices where id=v_invoice_id;
  if not found then return null; end if;

  select count(*),coalesce(round(sum(amount),2),0) into v_count,v_sum
  from public.finance_electronic_invoice_installments where invoice_id=v_invoice_id;

  if v_count=0 then
    raise exception 'Informe ao menos uma parcela para a NF-e.';
  end if;
  if round(v_sum,2)<>round(v_total,2) then
    raise exception 'A soma das parcelas (%) precisa coincidir exatamente com o valor total da NF-e (%).',v_sum,v_total;
  end if;
  return null;
end;
$$;

drop trigger if exists finance_electronic_invoice_installment_balance_trigger on public.finance_electronic_invoice_installments;
create constraint trigger finance_electronic_invoice_installment_balance_trigger
after insert or update or delete on public.finance_electronic_invoice_installments
deferrable initially deferred
for each row execute function public.validate_electronic_invoice_installment_balance();

-- -----------------------------------------------------------------------------
-- Programação financeira opcional das Ordens de Serviço.
-- -----------------------------------------------------------------------------

alter table public.execution_work_orders
  add column if not exists financial_mode text not null default 'none',
  add column if not exists payment_total numeric(18,2) not null default 0,
  add column if not exists payables_generated_at timestamptz;

do $$ begin
  alter table public.execution_work_orders
    add constraint execution_work_orders_financial_mode_check
    check(financial_mode in('none','forecast_only','payable_on_acceptance'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.execution_work_orders
    add constraint execution_work_orders_payment_total_check
    check(payment_total>=0);
exception when duplicate_object then null; end $$;

create table if not exists public.execution_work_order_installments(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  work_order_id uuid not null references public.execution_work_orders(id) on delete cascade,
  sequence_no integer not null,
  installment_label text not null,
  due_date date not null,
  amount numeric(18,2) not null check(amount>0),
  payment_method text,
  payable_id uuid references public.payables(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(work_order_id,sequence_no)
);

create index if not exists execution_work_order_installments_due_idx
  on public.execution_work_order_installments(project_id,due_date);
create index if not exists execution_work_order_installments_order_idx
  on public.execution_work_order_installments(work_order_id,sequence_no);

insert into public.permissions(key,module,action,description) values
  ('execution.work_orders.finance','execution_work_orders','finance','Autorizar a geração financeira direta de ordens de serviço')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'execution.work_orders.finance',true
from public.roles r where r.key in('owner','admin','director','finance')
on conflict(role_id,permission_key) do update set allowed=true;

alter table public.execution_work_order_installments enable row level security;

drop policy if exists execution_work_order_installments_select on public.execution_work_order_installments;
create policy execution_work_order_installments_select on public.execution_work_order_installments
for select to authenticated using(
  public.has_company_permission(company_id,'execution.work_orders.view')
  or public.has_company_permission(company_id,'execution.work_orders.manage')
  or public.has_company_permission(company_id,'execution.work_orders.finance')
);

drop policy if exists execution_work_order_installments_write on public.execution_work_order_installments;
create policy execution_work_order_installments_write on public.execution_work_order_installments
for all to authenticated using(
  public.has_company_permission(company_id,'execution.work_orders.manage')
  and exists(select 1 from public.execution_work_orders wo where wo.id=work_order_id and wo.status='draft')
) with check(
  public.has_company_permission(company_id,'execution.work_orders.manage')
  and exists(select 1 from public.execution_work_orders wo where wo.id=work_order_id and wo.status='draft')
);

create or replace function public.validate_work_order_installment_balance()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_work_order_id uuid:=coalesce(new.work_order_id,old.work_order_id);
  v_mode text;
  v_authorized numeric(18,2);
  v_sum numeric(18,2);
  v_count integer;
begin
  select financial_mode,authorized_value into v_mode,v_authorized
  from public.execution_work_orders where id=v_work_order_id;
  if not found or v_mode='none' then return null; end if;

  select count(*),coalesce(round(sum(amount),2),0) into v_count,v_sum
  from public.execution_work_order_installments where work_order_id=v_work_order_id;
  if v_count=0 then raise exception 'Informe ao menos uma parcela para a ordem de serviço.'; end if;
  if round(v_sum,2)<>round(v_authorized,2) then
    raise exception 'A soma das parcelas (%) precisa coincidir exatamente com o valor autorizado da O.S. (%).',v_sum,v_authorized;
  end if;
  return null;
end;
$$;

drop trigger if exists execution_work_order_installment_balance_trigger on public.execution_work_order_installments;
create constraint trigger execution_work_order_installment_balance_trigger
after insert or update or delete on public.execution_work_order_installments
deferrable initially deferred
for each row execute function public.validate_work_order_installment_balance();

create or replace function public.save_execution_work_order_financial_plan(
  p_company_id uuid,
  p_project_id uuid,
  p_work_order_id uuid,
  p_financial_mode text,
  p_installments jsonb
) returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  v_order public.execution_work_orders%rowtype;
  v_installment jsonb;
  v_sequence integer:=0;
  v_sum numeric(18,2):=0;
  v_amount numeric(18,2);
  v_due_date date;
begin
  if not public.has_company_permission(p_company_id,'execution.work_orders.manage') then
    raise exception 'Sem permissão para configurar a programação financeira da O.S.';
  end if;
  if p_financial_mode not in('none','forecast_only','payable_on_acceptance') then
    raise exception 'Modo financeiro inválido.';
  end if;
  if p_financial_mode='payable_on_acceptance'
     and not public.has_company_permission(p_company_id,'execution.work_orders.finance') then
    raise exception 'Seu perfil não pode autorizar geração direta de Contas a Pagar pela O.S.';
  end if;

  select * into v_order from public.execution_work_orders
  where id=p_work_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_order.id is null then raise exception 'Ordem de serviço não encontrada.'; end if;
  if v_order.status<>'draft' then raise exception 'A programação financeira só pode ser alterada enquanto a O.S. está em elaboração.'; end if;

  delete from public.execution_work_order_installments where work_order_id=v_order.id;

  if p_financial_mode='none' then
    update public.execution_work_orders set financial_mode='none',payment_total=0,updated_at=now(),updated_by=auth.uid()
    where id=v_order.id;
    return 'none';
  end if;

  if jsonb_typeof(p_installments)<>'array' or jsonb_array_length(p_installments)=0 then
    raise exception 'Informe ao menos uma parcela para a ordem de serviço.';
  end if;

  for v_installment in select value from jsonb_array_elements(p_installments) loop
    v_sequence:=v_sequence+1;
    if nullif(v_installment->>'due_date','') is null then raise exception 'Informe a data de todas as parcelas.'; end if;
    v_due_date:=(v_installment->>'due_date')::date;
    v_amount:=coalesce(nullif(v_installment->>'amount','')::numeric,0);
    if v_amount<=0 then raise exception 'O valor de cada parcela precisa ser maior que zero.'; end if;
    v_sum:=v_sum+v_amount;
    insert into public.execution_work_order_installments(
      company_id,project_id,work_order_id,sequence_no,installment_label,due_date,amount,payment_method
    ) values(
      p_company_id,p_project_id,v_order.id,v_sequence,
      coalesce(nullif(trim(coalesce(v_installment->>'label',v_installment->>'number','')),''),v_sequence||' / '||jsonb_array_length(p_installments)),
      v_due_date,round(v_amount,2),nullif(trim(coalesce(v_installment->>'payment_method','')),'')
    );
  end loop;

  if round(v_sum,2)<>round(v_order.authorized_value,2) then
    raise exception 'A soma das parcelas (%) precisa coincidir exatamente com o valor autorizado da O.S. (%).',round(v_sum,2),round(v_order.authorized_value,2);
  end if;

  update public.execution_work_orders set
    financial_mode=p_financial_mode,payment_total=round(v_sum,2),payables_generated_at=null,
    updated_at=now(),updated_by=auth.uid()
  where id=v_order.id;

  insert into public.execution_work_order_audit(company_id,project_id,work_order_id,action,details,changed_by)
  values(p_company_id,p_project_id,v_order.id,'financial_plan_saved',jsonb_build_object('mode',p_financial_mode,'installments',v_sequence,'total',round(v_sum,2)),auth.uid());
  return p_financial_mode;
end;
$$;

create or replace function public.save_execution_work_order_with_financial_plan(
  p_company_id uuid,p_project_id uuid,p_work_order_id uuid,p_contract_id uuid,
  p_title text,p_scope_summary text,p_planned_start date,p_planned_finish date,
  p_supplier_contact_name text,p_supplier_contact_phone text,p_site_instructions text,p_safety_instructions text,
  p_quality_requirements text,p_notes text,p_items jsonb,p_prerequisites jsonb,
  p_financial_mode text,p_installments jsonb
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare v_id uuid;
begin
  v_id:=public.save_execution_work_order(
    p_company_id,p_project_id,p_work_order_id,p_contract_id,p_title,p_scope_summary,p_planned_start,p_planned_finish,
    p_supplier_contact_name,p_supplier_contact_phone,p_site_instructions,p_safety_instructions,p_quality_requirements,p_notes,p_items,p_prerequisites
  );
  perform public.save_execution_work_order_financial_plan(p_company_id,p_project_id,v_id,p_financial_mode,p_installments);
  return v_id;
end;
$$;

create or replace function public.generate_execution_work_order_payables(
  p_company_id uuid,p_project_id uuid,p_work_order_id uuid
) returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_order public.execution_work_orders%rowtype;
  v_installment public.execution_work_order_installments%rowtype;
  v_payable_id uuid;
  v_count integer:=0;
begin
  select * into v_order from public.execution_work_orders
  where id=p_work_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_order.id is null then raise exception 'Ordem de serviço não encontrada.'; end if;
  if v_order.financial_mode<>'payable_on_acceptance' then return 0; end if;
  if v_order.status<>'finished' then raise exception 'As parcelas da O.S. só podem ser geradas após o aceite técnico.'; end if;
  if round(v_order.payment_total,2)<>round(v_order.accepted_value,2) then
    raise exception 'O valor aceito da O.S. (%) é diferente da programação financeira (%). Ajuste a O.S. antes do aceite.',v_order.accepted_value,v_order.payment_total;
  end if;

  for v_installment in select * from public.execution_work_order_installments where work_order_id=v_order.id order by sequence_no loop
    insert into public.payables(
      company_id,project_id,supplier_id,document,fiscal_class,payment_method,due_date,amount,status,installment_label,notes,
      origin,source_system,source_id,created_by
    ) values(
      p_company_id,p_project_id,v_order.supplier_id,v_order.work_order_number,'Ordem de serviço',v_installment.payment_method,
      v_installment.due_date,v_installment.amount,'open',v_installment.sequence_no||' / '||(select count(*) from public.execution_work_order_installments where work_order_id=v_order.id),
      concat_ws(E'\n',v_order.title,v_order.scope_summary,'Gerada automaticamente após o aceite técnico da O.S.'),
      'work_order','elos_work_order','work_order:'||v_order.id::text||':'||v_installment.id::text,auth.uid()
    ) on conflict(company_id,source_system,source_id) do update set
      due_date=case when public.payables.status='open' then excluded.due_date else public.payables.due_date end,
      amount=case when public.payables.status='open' then excluded.amount else public.payables.amount end,
      payment_method=case when public.payables.status='open' then excluded.payment_method else public.payables.payment_method end,
      document=excluded.document
    returning id into v_payable_id;
    update public.execution_work_order_installments set payable_id=v_payable_id,updated_at=now() where id=v_installment.id;
    v_count:=v_count+1;
  end loop;

  update public.execution_work_orders set payables_generated_at=coalesce(payables_generated_at,now()),updated_at=now() where id=v_order.id;
  insert into public.execution_work_order_audit(company_id,project_id,work_order_id,action,details,changed_by)
  values(p_company_id,p_project_id,v_order.id,'payables_generated',jsonb_build_object('count',v_count,'total',v_order.payment_total),auth.uid());
  return v_count;
end;
$$;

create or replace function public.accept_execution_work_order_with_financial(
  p_company_id uuid,p_project_id uuid,p_work_order_id uuid,p_result text,p_quality_status text,
  p_quality_reference text,p_notes text,p_punch_list jsonb
) returns text
language plpgsql
security definer
set search_path=public
as $$
declare v_status text;
begin
  v_status:=public.accept_execution_work_order(
    p_company_id,p_project_id,p_work_order_id,p_result,p_quality_status,p_quality_reference,p_notes,p_punch_list
  );
  if v_status='finished' then
    perform public.generate_execution_work_order_payables(p_company_id,p_project_id,p_work_order_id);
  end if;
  return v_status;
end;
$$;

-- Impede medir novamente uma O.S. cujo pagamento direto já foi escolhido.
create or replace function public.prevent_direct_payable_work_order_measurement()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.work_order_id is not null and exists(
    select 1 from public.execution_work_orders wo
    where wo.id=new.work_order_id and wo.financial_mode='payable_on_acceptance'
  ) then
    raise exception 'Esta O.S. gera Contas a Pagar diretamente no aceite e não pode ser incluída novamente em medição.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_direct_payable_work_order_measurement_trigger on public.execution_contract_measurement_items;
create trigger prevent_direct_payable_work_order_measurement_trigger
before insert or update of work_order_id on public.execution_contract_measurement_items
for each row execute function public.prevent_direct_payable_work_order_measurement();

grant select,insert,update,delete on public.execution_work_order_installments to authenticated;
grant execute on function public.validate_manual_invoice_installment_balance() to authenticated;
grant execute on function public.validate_electronic_invoice_installment_balance() to authenticated;
grant execute on function public.validate_work_order_installment_balance() to authenticated;
grant execute on function public.save_execution_work_order_financial_plan(uuid,uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.save_execution_work_order_with_financial_plan(uuid,uuid,uuid,uuid,text,text,date,date,text,text,text,text,text,text,jsonb,jsonb,text,jsonb) to authenticated;
grant execute on function public.generate_execution_work_order_payables(uuid,uuid,uuid) to authenticated;
grant execute on function public.accept_execution_work_order_with_financial(uuid,uuid,uuid,text,text,text,text,jsonb) to authenticated;

commit;
