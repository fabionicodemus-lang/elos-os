-- Elos OS — Corretores: correções de vínculo e cancelamento
-- Execute após 20260729_0052a_commercial_brokers_backfill.sql.

begin;

-- Ao editar o nome selecionado, troca também o broker_id correspondente.
-- Se o nome não existir no cadastro, preserva o vínculo técnico já existente.
create or replace function public.commercial_resolve_broker_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_broker public.commercial_brokers%rowtype;
  v_name_changed boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_name_changed := old.broker_name is distinct from new.broker_name;
  end if;

  if nullif(trim(new.broker_name), '') is not null and (new.broker_id is null or v_name_changed) then
    select * into v_broker
    from public.commercial_brokers
    where company_id = new.company_id
      and lower(trim(name)) = lower(trim(new.broker_name))
    limit 1;

    if found then
      new.broker_id := v_broker.id;
      new.broker_name := v_broker.name;
      return new;
    end if;
  end if;

  if new.broker_id is not null then
    select * into v_broker
    from public.commercial_brokers
    where id = new.broker_id and company_id = new.company_id;
    if not found then raise exception 'O corretor informado não pertence à empresa.'; end if;
    new.broker_name := v_broker.name;
  elsif nullif(trim(new.broker_name), '') is null then
    new.broker_name := null;
  end if;

  return new;
end;
$$;

-- Venda cancelada cancela comissões ainda sem conta financeira.
create or replace function public.commercial_sync_sale_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_broker public.commercial_brokers%rowtype;
  v_proposal_id uuid;
begin
  if new.source_system = 'commercial_proposal' then
    select id into v_proposal_id
    from public.commercial_proposals
    where company_id = new.company_id and id::text = new.source_id
    limit 1;
  end if;

  if new.status = 'active' and new.broker_id is not null and new.commission_pct > 0 then
    select * into v_broker
    from public.commercial_brokers
    where id = new.broker_id and company_id = new.company_id;
    if not found then return new; end if;

    insert into public.commercial_sale_commissions(
      company_id, project_id, sale_id, proposal_id, broker_id, role,
      calculation_base, commission_pct, due_date, status, notes,
      source_system, source_id, created_by
    ) values (
      new.company_id, new.project_id, new.id, v_proposal_id, new.broker_id, 'broker',
      new.total_amount, new.commission_pct,
      (new.sale_date + v_broker.payment_due_days)::date,
      'planned', concat('Comissão automática da venda ', new.number),
      'sales', new.id::text, new.created_by
    )
    on conflict(company_id, source_system, source_id) do update set
      project_id = excluded.project_id,
      proposal_id = coalesce(excluded.proposal_id, public.commercial_sale_commissions.proposal_id),
      broker_id = case when public.commercial_sale_commissions.status in ('planned','cancelled') then excluded.broker_id else public.commercial_sale_commissions.broker_id end,
      calculation_base = case when public.commercial_sale_commissions.status in ('planned','cancelled') then excluded.calculation_base else public.commercial_sale_commissions.calculation_base end,
      commission_pct = case when public.commercial_sale_commissions.status in ('planned','cancelled') then excluded.commission_pct else public.commercial_sale_commissions.commission_pct end,
      due_date = case when public.commercial_sale_commissions.status in ('planned','cancelled') then excluded.due_date else public.commercial_sale_commissions.due_date end,
      status = case when public.commercial_sale_commissions.status in ('planned','cancelled') then 'planned' else public.commercial_sale_commissions.status end,
      notes = case when public.commercial_sale_commissions.status in ('planned','cancelled') then excluded.notes else public.commercial_sale_commissions.notes end,
      updated_at = now();
  else
    update public.commercial_sale_commissions
    set status = 'cancelled', approved_by = null, approved_at = null, updated_at = now()
    where company_id = new.company_id
      and source_system = 'sales'
      and source_id = new.id::text
      and payable_id is null
      and status in ('planned','approved');
  end if;

  return new;
end;
$$;

commit;
