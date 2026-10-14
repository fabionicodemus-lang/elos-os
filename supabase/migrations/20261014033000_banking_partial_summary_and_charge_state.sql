-- Elos OS — Banking: resumos compatíveis com baixa parcial e estado de rascunho emitido
begin;

alter table public.finance_collection_drafts
  drop constraint if exists finance_collection_drafts_status_check;
alter table public.finance_collection_drafts
  add constraint finance_collection_drafts_status_check
  check(status in ('draft','issued','cancelled'));

create or replace function public.bank_register_provider_charge(
  p_connection uuid,p_draft uuid,p_external_id text,p_external_reference text,p_billing_type text,
  p_invoice_url text,p_bank_slip_url text,p_pix_payload text,p_pix_expiration_at timestamptz,p_payload jsonb
) returns uuid language plpgsql security invoker set search_path='' as $$
declare c public.finance_bank_connections; d public.finance_collection_drafts; id uuid; begin
  select * into c from public.finance_bank_connections where finance_bank_connections.id=p_connection and status='active';
  if c.id is null or not public.has_company_permission(c.company_id,'receivables.manage') then raise exception 'Conexão indisponível.'; end if;
  select * into d from public.finance_collection_drafts where finance_collection_drafts.id=p_draft and company_id=c.company_id and bank_account_id=c.bank_account_id and status in ('draft','issued') for update;
  if d.id is null then raise exception 'Rascunho indisponível.'; end if;
  if p_billing_type not in ('boleto','pix') or nullif(trim(coalesce(p_external_id,'')),'') is null or nullif(trim(coalesce(p_external_reference,'')),'') is null then raise exception 'Cobrança inválida.'; end if;
  insert into public.finance_collection_charges(company_id,project_id,bank_account_id,connection_id,draft_id,receivable_id,billing_type,provider,external_id,external_reference,status,amount,due_date,invoice_url,bank_slip_url,pix_payload,pix_expiration_at,provider_payload,created_by)
  values(c.company_id,d.project_id,c.bank_account_id,c.id,d.id,d.receivable_id,p_billing_type,c.provider,p_external_id,p_external_reference,'pending',d.amount,d.due_date,p_invoice_url,p_bank_slip_url,p_pix_payload,p_pix_expiration_at,coalesce(p_payload,'{}'::jsonb),auth.uid())
  on conflict(connection_id,external_id) do update set invoice_url=excluded.invoice_url,bank_slip_url=excluded.bank_slip_url,pix_payload=excluded.pix_payload,pix_expiration_at=excluded.pix_expiration_at,provider_payload=excluded.provider_payload,updated_at=now()
  returning finance_collection_charges.id into id;
  update public.finance_collection_drafts set status='issued',updated_at=now() where finance_collection_drafts.id=d.id;
  return id;
end $$;

create or replace function public.payables_summary(
  p_company_id uuid,
  p_project_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb; begin
  if not (
    public.has_company_permission(p_company_id,'payables.view') or
    public.has_company_permission(p_company_id,'payables.manage')
  ) then raise exception 'Você não possui acesso às contas a pagar desta empresa.'; end if;
  select jsonb_build_object(
    'total_count',count(*),
    'open_count',count(*) filter(where status='open'),
    'paid_count',count(*) filter(where status='paid'),
    'cancelled_count',count(*) filter(where status='cancelled'),
    'total_amount',coalesce(sum(amount) filter(where status<>'cancelled'),0),
    'open_amount',coalesce(sum(greatest(amount-coalesce(paid_amount,0),0)) filter(where status='open'),0),
    'paid_amount',coalesce(sum(coalesce(paid_amount,0)) filter(where status<>'cancelled'),0)
  ) into result
  from public.payables
  where company_id=p_company_id and (p_project_id is null or project_id=p_project_id);
  return result;
end $$;

create or replace function public.receivables_summary(
  p_company_id uuid,
  p_project_id uuid default null,
  p_sale_id uuid default null
) returns jsonb
language sql stable security invoker set search_path=public as $$
  with sale_totals as (
    select
      coalesce(sum(sale.total_amount) filter(where sale.status='active'),0) as contracted_amount,
      count(*) filter(where sale.status='active') as active_sales
    from public.sales sale
    where sale.company_id=p_company_id
      and (p_project_id is null or sale.project_id=p_project_id)
      and (p_sale_id is null or sale.id=p_sale_id)
      and (public.has_company_permission(sale.company_id,'receivables.view') or public.has_company_permission(sale.company_id,'receivables.manage'))
  ), receivable_totals as (
    select
      count(*) filter(where receivable.status<>'cancelled') as total_count,
      count(*) filter(where receivable.status='open') as open_count,
      count(*) filter(where receivable.status='paid') as paid_count,
      count(*) filter(where receivable.status='open' and receivable.due_date<current_date) as overdue_count,
      coalesce(sum(receivable.amount) filter(where receivable.status<>'cancelled'),0) as planned_amount,
      coalesce(sum(greatest(coalesce(receivable.adjusted_amount,receivable.amount)-coalesce(receivable.paid_amount,0),0)) filter(where receivable.status='open'),0) as open_amount,
      coalesce(sum(coalesce(receivable.paid_amount,0)) filter(where receivable.status<>'cancelled'),0) as paid_amount
    from public.receivables receivable
    where receivable.company_id=p_company_id
      and (p_project_id is null or receivable.project_id=p_project_id)
      and (p_sale_id is null or receivable.sale_id=p_sale_id)
      and (public.has_company_permission(receivable.company_id,'receivables.view') or public.has_company_permission(receivable.company_id,'receivables.manage'))
  )
  select jsonb_build_object(
    'contracted_amount',sale_totals.contracted_amount,
    'active_sales',sale_totals.active_sales,
    'total_count',receivable_totals.total_count,
    'open_count',receivable_totals.open_count,
    'paid_count',receivable_totals.paid_count,
    'overdue_count',receivable_totals.overdue_count,
    'planned_amount',receivable_totals.planned_amount,
    'open_amount',receivable_totals.open_amount,
    'paid_amount',receivable_totals.paid_amount,
    'unplanned_amount',greatest(sale_totals.contracted_amount-receivable_totals.planned_amount,0)
  ) from sale_totals cross join receivable_totals;
$$;

revoke all on function public.bank_register_provider_charge(uuid,uuid,text,text,text,text,text,text,timestamptz,jsonb) from public,anon;
grant execute on function public.bank_register_provider_charge(uuid,uuid,text,text,text,text,text,text,timestamptz,jsonb) to authenticated;
grant execute on function public.payables_summary(uuid,uuid),public.receivables_summary(uuid,uuid,uuid) to authenticated;

commit;
