begin;

-- Shared official publication cache; contains no tenant or customer data.
create table finance_private.cub_sc_months (
 application_month date primary key check (application_month=date_trunc('month',application_month)::date),
 state text not null default 'searching' check(state in ('searching','completed')),
 reference_month date, residential numeric(18,2), commercial numeric(18,2), source_hash text,
 source_url text not null default 'https://sinduscon-fpolis.org.br/servico/cub-mensal/',
 last_attempt_hour timestamptz, lease_token uuid, lease_until timestamptz,
 attempts integer not null default 0, last_error text, fetched_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table finance_private.cub_sc_months enable row level security;
revoke all on finance_private.cub_sc_months from public,anon,authenticated,service_role;

create table public.cub_sc_automation (
 company_id uuid primary key references public.companies(id),
 correction_index_id uuid not null unique references public.correction_indices(id),
 series text not null check(series in ('residential','commercial')),
 enabled boolean not null default false,
 last_application_month date, last_checked_at timestamptz, last_error text,
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.cub_sc_automation_history (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 correction_index_id uuid not null references public.correction_indices(id),
 application_month date, event text not null, detail jsonb not null default '{}',
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index cub_sc_history_company_date on public.cub_sc_automation_history(company_id,created_at desc);
alter table public.cub_sc_automation enable row level security;
alter table public.cub_sc_automation_history enable row level security;
revoke all on public.cub_sc_automation,public.cub_sc_automation_history from public,anon,authenticated,service_role;
grant select on public.cub_sc_automation,public.cub_sc_automation_history to authenticated;
create policy cub_sc_read on public.cub_sc_automation for select to authenticated using(public.has_company_permission(company_id,'indices.view') or public.has_company_permission(company_id,'indices.manage'));
create policy cub_sc_history_read on public.cub_sc_automation_history for select to authenticated using(public.has_company_permission(company_id,'indices.view') or public.has_company_permission(company_id,'indices.manage'));

create function finance_private.cub_sc_configure(p_company uuid,p_index uuid,p_series text,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_company_permission(p_company,'indices.manage') then raise exception 'Sem permissão para configurar o CUB.'; end if;
 if p_series is null or p_series not in ('residential','commercial') or p_enabled is null then raise exception 'Modalidade inválida.'; end if;
 if not exists(select 1 from public.correction_indices where id=p_index and company_id=p_company and status='active' and value_type='index_number' and code like 'CUB%') then raise exception 'Índice CUB inválido para a empresa.'; end if;
 insert into public.cub_sc_automation(company_id,correction_index_id,series,enabled,created_by)
 values(p_company,p_index,p_series,p_enabled,auth.uid())
 on conflict(company_id) do update set correction_index_id=excluded.correction_index_id,series=excluded.series,enabled=excluded.enabled,last_application_month=case when cub_sc_automation.correction_index_id=excluded.correction_index_id and cub_sc_automation.series=excluded.series then cub_sc_automation.last_application_month else null end,last_error=null,updated_at=now();
 insert into public.cub_sc_automation_history(company_id,correction_index_id,event,detail,created_by)
 values(p_company,p_index,'configured',jsonb_build_object('series',p_series,'enabled',p_enabled),auth.uid());
end $$;
create function public.cub_sc_configure(p_company uuid,p_index uuid,p_series text,p_enabled boolean)
returns void language sql security invoker set search_path='' as $$select finance_private.cub_sc_configure(p_company,p_index,p_series,p_enabled)$$;
revoke all on function finance_private.cub_sc_configure(uuid,uuid,text,boolean),public.cub_sc_configure(uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function finance_private.cub_sc_configure(uuid,uuid,text,boolean),public.cub_sc_configure(uuid,uuid,text,boolean) to authenticated;

-- A caller cannot supply the clock or target month. Row locking and a per-hour
-- reservation prevent simultaneous requests and retries from fetching twice.
create function public.cub_sc_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare local_now timestamp:=now() at time zone 'America/Sao_Paulo'; m date:=date_trunc('month',local_now)::date; r finance_private.cub_sc_months; token uuid;
begin
 if extract(day from local_now)>3 or not exists(select 1 from public.cub_sc_automation where enabled) then return null; end if;
 insert into finance_private.cub_sc_months(application_month) values(m) on conflict do nothing;
 select * into r from finance_private.cub_sc_months where application_month=m for update;
 if r.state='completed' or r.last_attempt_hour=date_trunc('hour',now()) or r.lease_until>now() then return null; end if;
 token:=gen_random_uuid();
 update finance_private.cub_sc_months set last_attempt_hour=date_trunc('hour',now()),lease_token=token,lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now() where application_month=m;
 update public.cub_sc_automation set last_checked_at=now(),updated_at=now() where enabled;
 return jsonb_build_object('month',m,'token',token);
end $$;

create function public.cub_sc_finish(p_month date,p_token uuid,p_publication jsonb,p_failure text)
returns text language plpgsql security definer set search_path='' as $$
declare local_now timestamp:=now() at time zone 'America/Sao_Paulo'; r finance_private.cub_sc_months; previous finance_private.cub_sc_months;
 cfg public.cub_sc_automation; amount numeric; existing numeric; reference date; v_residential numeric; v_commercial numeric; outcome text;
begin
 select * into r from finance_private.cub_sc_months where application_month=p_month for update;
 if r.application_month is null or p_token is null or r.lease_token is distinct from p_token or r.state='completed' or r.lease_until<now() then raise exception 'Reserva da consulta inválida.'; end if;
 if extract(day from local_now)>3 or p_month<>date_trunc('month',local_now)::date then raise exception 'Fora da janela mensal.'; end if;
 if p_publication is null then
   if p_failure is null or p_failure not in ('not_published','invalid_source','source_unavailable') then raise exception 'Resultado inválido.'; end if;
   update finance_private.cub_sc_months set last_error=p_failure,lease_until=null,lease_token=null,updated_at=now() where application_month=p_month;
   update public.cub_sc_automation set last_error=p_failure,updated_at=now() where enabled;
   return p_failure;
 end if;
 if p_failure is not null or (p_publication->>'application_month')::date is distinct from p_month
   or p_publication->>'source_url' is distinct from 'https://sinduscon-fpolis.org.br/servico/cub-mensal/'
   or coalesce(p_publication->>'source_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'Publicação inválida.'; end if;
 reference:=(p_publication->>'reference_month')::date;
 v_residential:=(p_publication->>'residential')::numeric; v_commercial:=(p_publication->>'commercial')::numeric;
 if reference is distinct from (p_month-interval '1 month')::date or v_residential is null or v_commercial is null
   or v_residential not between 0.01 and 999999.99 or v_commercial not between 0.01 and 999999.99
   or v_residential<>round(v_residential,2) or v_commercial<>round(v_commercial,2) then raise exception 'Competência ou valor inválido.'; end if;
 select * into previous from finance_private.cub_sc_months where application_month=reference and state='completed';
 if previous.application_month is not null and (abs(v_residential/previous.residential-1)>0.1 or abs(v_commercial/previous.commercial-1)>0.1) then
   update finance_private.cub_sc_months set last_error='variation_review',lease_until=null,lease_token=null,updated_at=now() where application_month=p_month;
   update public.cub_sc_automation set last_error='variation_review',updated_at=now() where enabled;
   return 'variation_review';
 end if;
 update finance_private.cub_sc_months set state='completed',reference_month=reference,residential=v_residential,commercial=v_commercial,
   source_hash=p_publication->>'source_hash',fetched_at=now(),last_error=null,lease_until=null,lease_token=null,updated_at=now() where application_month=p_month;

 for cfg in select * from public.cub_sc_automation where enabled order by company_id for update loop
  begin
   if not exists(select 1 from public.correction_indices where id=cfg.correction_index_id and company_id=cfg.company_id and status='active' and value_type='index_number' and code like 'CUB%') then raise exception 'inactive_index'; end if;
   amount:=case cfg.series when 'residential' then v_residential else v_commercial end;
   -- Serializes with the index values' unique constraint. Never overwrite a
   -- manually entered month or add a second correction on repeated delivery.
   insert into public.correction_index_values(company_id,correction_index_id,reference_month,value,notes,created_by)
   values(cfg.company_id,cfg.correction_index_id,p_month,amount,
     'CUB automático · Sinduscon Grande Florianópolis · modalidade '||cfg.series||' · referência '||reference||' · uso '||p_month||' · SHA256 '||(p_publication->>'source_hash'),cfg.created_by)
   on conflict(company_id,correction_index_id,reference_month) do nothing;
   select value into existing from public.correction_index_values where company_id=cfg.company_id and correction_index_id=cfg.correction_index_id and reference_month=p_month;
   outcome:=case when existing=amount then 'updated' else 'value_conflict' end;
   update public.cub_sc_automation set last_application_month=case when outcome='updated' then p_month else last_application_month end,
     last_error=case when outcome='updated' then null else outcome end,updated_at=now() where company_id=cfg.company_id;
   insert into public.cub_sc_automation_history(company_id,correction_index_id,application_month,event,detail)
   values(cfg.company_id,cfg.correction_index_id,p_month,outcome,jsonb_build_object('value',amount,'reference_month',reference,'series',cfg.series,'source_url',r.source_url,'source_hash',p_publication->>'source_hash'));
  exception when others then
   -- Per-company subtransaction: a rejected correction cannot partially change
   -- that company's values and cannot block publication for another company.
   update public.cub_sc_automation set last_error='application_failed',updated_at=now() where company_id=cfg.company_id;
   insert into public.cub_sc_automation_history(company_id,correction_index_id,application_month,event) values(cfg.company_id,cfg.correction_index_id,p_month,'application_failed');
  end;
 end loop;
 return 'completed';
end $$;
revoke all on function public.cub_sc_claim(),public.cub_sc_finish(date,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.cub_sc_claim(),public.cub_sc_finish(date,uuid,jsonb,text) to service_role;

-- The normal correction engine still owns contract-specific calculations.
-- Publishing an index never changes an already prepared/registered charge,
-- settled installment, partial receipt, or imported eObra correction.
create or replace function public.refresh_receivables_after_index_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare target_company_id uuid; target_index_id uuid;
begin
 if tg_op='DELETE' then target_company_id:=old.company_id; target_index_id:=old.correction_index_id;
 else target_company_id:=new.company_id; target_index_id:=new.correction_index_id; end if;
 update public.receivables r set updated_at=now()
 where r.company_id=target_company_id and r.correction_index_id=target_index_id and r.status='open'
   and not r.correction_locked and coalesce(r.paid_amount,0)=0 and r.source_system is distinct from 'eobra'
   and not exists(select 1 from public.finance_collections c where c.receivable_id=r.id and c.company_id=r.company_id and c.status<>'cancelled');
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function public.refresh_receivables_after_index_change() from public,anon,authenticated,service_role;

-- Only explicitly identified existing official series are eligible for initial
-- enrollment. Generic 'CUB-SC', R8-N and desonerado are NEVER inferred.
insert into public.cub_sc_automation(company_id,correction_index_id,series,enabled,created_by)
select company_id,id,case name when 'CUB-SC Residencial Médio' then 'residential' else 'commercial' end,true,created_by
from public.correction_indices where status='active' and code='CUB-SC' and value_type='index_number'
 and source_name='Sinduscon Grande Florianópolis' and name in ('CUB-SC Residencial Médio','CUB-SC Comercial Médio');
insert into public.cub_sc_automation_history(company_id,correction_index_id,event,detail,created_by)
select company_id,correction_index_id,'configured',jsonb_build_object('series',series,'enabled',true,'origin','existing_explicit_series'),created_by from public.cub_sc_automation;
commit;
