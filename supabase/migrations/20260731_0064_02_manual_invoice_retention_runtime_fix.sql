-- Elos OS — Correções de runtime do lançamento direto das Notas Manuais
-- Executar depois da migration principal 0064.

begin;

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

grant execute on function public.finance_compute_tax_due_date(uuid,date,date,date) to authenticated;

commit;
