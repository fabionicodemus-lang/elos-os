-- Elos OS — Correções de runtime do lançamento direto das Notas Manuais
-- Executar depois da migration principal 0064.

begin;

-- IRRF e as contribuições federais podem depender do evento de crédito/pagamento e
-- da apuração fiscal adotada. Cadastros globais identificados automaticamente não
-- devem virar obrigações definitivas com uma data presumida. A empresa precisa
-- confirmar explicitamente data-base, prazo e órgão antes do primeiro lançamento.
update public.finance_tax_types set
  due_trigger='issue_date',
  due_rule='manual',
  due_day=null,
  due_month_offset=0,
  due_days_after_event=0,
  business_day_adjustment='none',
  auto_generate_payable=true,
  updated_at=now()
where project_id is null
  and retention_key in('irrf','pis','cofins','csll');

create or replace function public.finance_compute_tax_due_date(
  p_tax_type_id uuid,
  p_issue_date date,
  p_competence_date date,
  p_first_installment_due_date date
) returns date
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_type public.finance_tax_types%rowtype;
  v_base date;
  v_month date;
  v_last_day integer;
  v_due date;
begin
  select * into v_type
  from public.finance_tax_types
  where id=p_tax_type_id and status='active';
  if v_type.id is null then raise exception 'Regra de retenção não encontrada ou inativa.'; end if;
  if not public.is_company_member(v_type.company_id) then raise exception 'Sem acesso à regra tributária.'; end if;

  v_base:=case v_type.due_trigger
    when 'issue_date' then p_issue_date
    when 'competence_date' then coalesce(p_competence_date,p_issue_date)
    when 'first_installment_due_date' then coalesce(p_first_installment_due_date,p_issue_date)
    else p_issue_date end;
  if v_base is null then raise exception 'Não foi possível determinar a data base da retenção %.',v_type.code; end if;

  if v_type.due_rule='days_after_event' then
    v_due:=v_base+v_type.due_days_after_event;
  elsif v_type.due_rule='fixed_day' then
    v_month:=(date_trunc('month',v_base)::date+make_interval(months=>v_type.due_month_offset))::date;
    v_last_day:=extract(day from (v_month+interval '1 month'-interval '1 day'))::integer;
    v_due:=make_date(
      extract(year from v_month)::integer,
      extract(month from v_month)::integer,
      least(v_type.due_day,v_last_day)
    );
  else
    raise exception 'Configure o prazo automático da retenção % antes de lançar a nota.',v_type.code;
  end if;

  return public.finance_adjust_weekend(v_due,v_type.business_day_adjustment);
end;
$$;

create or replace function public.manual_invoice_mutability(
  p_company_id uuid,p_project_id uuid,p_invoice_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_invoice public.finance_manual_invoices%rowtype;
  v_has_payment boolean:=false;
  v_has_receipt boolean:=false;
begin
  if not public.has_company_permission(p_company_id,'finance.manual_invoices.view')
     and not public.has_company_permission(p_company_id,'finance.manual_invoices.manage')
     and not public.has_company_permission(p_company_id,'finance.manual_invoices.cancel') then
    raise exception 'Sem permissão para consultar esta nota manual.';
  end if;

  select * into v_invoice from public.finance_manual_invoices
  where id=p_invoice_id and company_id=p_company_id and project_id=p_project_id;
  if v_invoice.id is null then
    return jsonb_build_object('mutable',false,'reason','Nota manual não encontrada.','has_payment',false,'has_receipt',false);
  end if;

  v_has_receipt:=v_invoice.material_receipt_id is not null;
  select exists(
    select 1 from public.payables p
    where p.company_id=v_invoice.company_id
      and p.source_system='elos_os'
      and p.source_id like 'manual_invoice:'||v_invoice.id::text||':%'
      and (p.status='paid' or p.paid_at is not null)
  ) or exists(
    select 1 from public.finance_tax_obligations o
    left join public.payables p on p.id=o.payable_id
    where o.manual_invoice_id=v_invoice.id
      and (o.status='paid' or p.status='paid' or p.paid_at is not null)
  ) into v_has_payment;

  return jsonb_build_object(
    'mutable',not v_has_payment and not v_has_receipt and v_invoice.status<>'cancelled',
    'has_payment',v_has_payment,
    'has_receipt',v_has_receipt,
    'reason',case
      when v_invoice.status='cancelled' then 'A nota foi cancelada.'
      when v_has_payment then 'A nota possui pagamento do fornecedor ou de imposto vinculado.'
      when v_has_receipt then 'A nota possui recebimento de material vinculado.'
      else null end
  );
end;
$$;

create or replace function public.remove_manual_invoice_generated_finance(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare v_invoice public.finance_manual_invoices%rowtype;
begin
  select * into v_invoice from public.finance_manual_invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Nota manual não encontrada.'; end if;
  if not public.has_company_permission(v_invoice.company_id,'finance.manual_invoices.manage')
     and not public.has_company_permission(v_invoice.company_id,'finance.manual_invoices.cancel') then
    raise exception 'Sem permissão para alterar ou excluir esta nota manual.';
  end if;
  if v_invoice.material_receipt_id is not null then
    raise exception 'A nota possui recebimento de material vinculado e não pode ser alterada ou excluída.';
  end if;

  if exists(
    select 1 from public.payables p
    where p.company_id=v_invoice.company_id and p.source_system='elos_os'
      and p.source_id like 'manual_invoice:'||v_invoice.id::text||':%'
      and (p.status='paid' or p.paid_at is not null)
  ) or exists(
    select 1 from public.finance_tax_obligations o
    left join public.payables p on p.id=o.payable_id
    where o.manual_invoice_id=v_invoice.id
      and (o.status='paid' or p.status='paid' or p.paid_at is not null)
  ) then
    raise exception 'A nota possui pagamento vinculado e não pode ser alterada ou excluída.';
  end if;

  if v_invoice.measurement_id is not null then
    update public.execution_contract_measurements set
      status='approved',invoice_number=null,invoice_date=null,invoice_gross_amount=null,
      payable_id=null,sent_to_finance_at=null,updated_at=now()
    where id=v_invoice.measurement_id and status='invoiced';
  end if;

  delete from public.payables p
  using public.finance_tax_obligations o
  where o.manual_invoice_id=v_invoice.id and p.id=o.payable_id and p.status<>'paid';
  delete from public.finance_tax_obligations where manual_invoice_id=v_invoice.id;

  delete from public.payables
  where company_id=v_invoice.company_id and source_system='elos_os'
    and source_id like 'manual_invoice:'||v_invoice.id::text||':%'
    and status<>'paid';
  update public.finance_manual_invoice_installments set payable_id=null,updated_at=now()
  where invoice_id=v_invoice.id;

  update public.finance_manual_invoices set
    status='draft',approved_by=null,approved_at=null,approval_notes=null,
    posted_by=null,posted_at=null,updated_at=now(),updated_by=auth.uid()
  where id=v_invoice.id;
end;
$$;

create or replace function public.protect_manual_invoice_generated_payable()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status='cancelled' and old.status is distinct from new.status then
    if old.source_system='elos_os' and old.source_id like 'manual_invoice:%' then
      raise exception 'Esta conta foi gerada por uma Nota Manual. Edite ou exclua a nota de origem para alterar os lançamentos.';
    end if;

    if old.source_system='elos_taxes' and exists(
      select 1 from public.finance_tax_obligations o
      where o.payable_id=old.id and o.manual_invoice_id is not null
    ) then
      raise exception 'Esta conta tributária foi gerada por uma Nota Manual. Edite ou exclua a nota de origem para alterar os lançamentos.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payables_protect_manual_invoice_source on public.payables;
create trigger payables_protect_manual_invoice_source
before update of status on public.payables
for each row execute function public.protect_manual_invoice_generated_payable();

-- Funções auxiliares destrutivas são chamadas apenas pelas operações atômicas de
-- salvar e excluir. Elas não ficam expostas como RPC direta ao usuário autenticado.
revoke all on function public.remove_manual_invoice_generated_finance(uuid) from public,authenticated;
revoke all on function public.sync_manual_invoice_retained_taxes(uuid) from public,authenticated;
revoke all on function public.finance_compute_tax_due_date(uuid,date,date,date) from public,authenticated;
grant execute on function public.manual_invoice_mutability(uuid,uuid,uuid) to authenticated;

commit;
