begin;

-- Defaults are opt-in and are copied only into new native records.
create table public.project_adjustment_settings (
 project_id uuid primary key references public.projects(id), company_id uuid not null references public.companies(id),
 budget_enabled boolean not null, budget_index_id uuid references public.correction_indices(id), budget_base_month date,
 installments_enabled boolean not null, created_by uuid references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (not budget_enabled or budget_index_id is not null),
 check (budget_base_month is null or budget_base_month=date_trunc('month',budget_base_month)::date)
);
create table public.contract_adjustment_versions (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid not null references public.projects(id), sale_id uuid not null references public.sales(id),
 mode text not null check(mode in ('pending','none','phased')),
 base_month date not null check(base_month=date_trunc('month',base_month)::date),
 keys_month date check(keys_month=date_trunc('month',keys_month)::date),
 start_month integer not null default 0 check(start_month between 0 and 60),
 limit_rule text not null default 'current_month' check(limit_rule in ('current_month','due_month')),
 pre_index_id uuid references public.correction_indices(id), post_index_id uuid references public.correction_indices(id),
 pre_interval integer not null default 1 check(pre_interval in (1,12)), post_interval integer not null default 1 check(post_interval in (1,12)),
 pre_lag integer not null default 0 check(pre_lag between 0 and 2), post_lag integer not null default 0 check(post_lag between 0 and 2),
 reason text not null, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (mode<>'phased' or keys_month>=base_month and keys_month is not null),
 check (mode='phased' or pre_index_id is null and post_index_id is null)
);
create index contract_adjustment_sale_idx on public.contract_adjustment_versions(company_id,sale_id,created_at desc);
create table public.adjustment_policy_events (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid not null references public.projects(id), sale_id uuid references public.sales(id),
 event text not null, detail jsonb not null default '{}', created_by uuid references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index adjustment_policy_events_scope_idx on public.adjustment_policy_events(company_id,project_id,created_at desc);
alter table public.sales add column adjustment_policy_id uuid references public.contract_adjustment_versions(id);
alter table public.receivables add column adjustment_policy_id uuid references public.contract_adjustment_versions(id), add column adjustment_calculation jsonb;
create index receivables_adjustment_policy_idx on public.receivables(adjustment_policy_id) where adjustment_policy_id is not null;
alter table public.project_adjustment_settings enable row level security;
alter table public.contract_adjustment_versions enable row level security;
alter table public.adjustment_policy_events enable row level security;
revoke all on public.project_adjustment_settings,public.contract_adjustment_versions,public.adjustment_policy_events from public,anon,authenticated,service_role;
grant select on public.project_adjustment_settings,public.contract_adjustment_versions,public.adjustment_policy_events to authenticated;
create policy project_adjustment_read on public.project_adjustment_settings for select to authenticated using(public.has_company_permission(company_id,'projects.view') or public.has_company_permission(company_id,'sales.view') or public.has_company_permission(company_id,'budgets.view'));
create policy contract_adjustment_read on public.contract_adjustment_versions for select to authenticated using(public.has_company_permission(company_id,'sales.view') or public.has_company_permission(company_id,'receivables.view'));
create policy adjustment_events_read on public.adjustment_policy_events for select to authenticated using(public.has_company_permission(company_id,'projects.view') or public.has_company_permission(company_id,'sales.view'));

create function finance_private.save_project_adjustment(p_company uuid,p_project uuid,p_budget boolean,p_index uuid,p_base date,p_installments boolean,p_apply_budgets boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer:=0;
begin
 if auth.uid() is null or not public.has_company_permission(p_company,'projects.manage') or not public.has_company_permission(p_company,'budgets.manage') or not public.has_company_permission(p_company,'sales.manage') then raise exception 'Sem permissão para configurar os reajustes do empreendimento.'; end if;
 perform 1 from public.projects where id=p_project and company_id=p_company for update;
 if not found then raise exception 'Empreendimento inválido.'; end if;
 if p_budget is null or p_installments is null or p_apply_budgets is null then raise exception 'Escolha as opções de reajuste.'; end if;
 if p_budget and not exists(select 1 from public.correction_indices where id=p_index and company_id=p_company and status='active') then raise exception 'Índice do orçamento inválido para a construtora.'; end if;
 if p_base is not null and p_base<>date_trunc('month',p_base)::date then raise exception 'Competência-base inválida.'; end if;
 insert into public.project_adjustment_settings(company_id,project_id,budget_enabled,budget_index_id,budget_base_month,installments_enabled,created_by)
 values(p_company,p_project,p_budget,case when p_budget then p_index end,case when p_budget then p_base end,p_installments,auth.uid())
 on conflict(project_id) do update set budget_enabled=excluded.budget_enabled,budget_index_id=excluded.budget_index_id,budget_base_month=excluded.budget_base_month,installments_enabled=excluded.installments_enabled,updated_at=now();
 if p_apply_budgets then
  update public.engineering_budgets set adjustment_enabled=p_budget,correction_index_id=case when p_budget then p_index end,
   correction_base_month=case when p_budget then coalesce(p_base,date_trunc('month',reference_date)::date,date_trunc('month',now() at time zone 'America/Sao_Paulo')::date) end,
   correction_base_value=null,updated_at=now() where company_id=p_company and project_id=p_project and status<>'archived';
  get diagnostics n=row_count;
 end if;
 insert into public.adjustment_policy_events(company_id,project_id,event,detail,created_by) values(p_company,p_project,'project_defaults',jsonb_build_object('budget_enabled',p_budget,'budget_index_id',p_index,'budget_base_month',p_base,'installments_enabled',p_installments,'updated_budgets',n),auth.uid());
 return n;
end $$;
create function public.save_project_adjustment(p_company uuid,p_project uuid,p_budget boolean,p_index uuid,p_base date,p_installments boolean,p_apply_budgets boolean)
returns integer language sql security invoker set search_path='' as $$select finance_private.save_project_adjustment(p_company,p_project,p_budget,p_index,p_base,p_installments,p_apply_budgets)$$;

create function finance_private.inherit_project_budget_adjustment() returns trigger language plpgsql security definer set search_path='' as $$
declare cfg public.project_adjustment_settings;
begin
 if coalesce(new.source_system,'elos_os') not in ('elos_os','manual') or new.adjustment_enabled then return new; end if;
 select * into cfg from public.project_adjustment_settings where project_id=new.project_id and company_id=new.company_id;
 if found then
  new.adjustment_enabled:=cfg.budget_enabled; new.correction_index_id:=cfg.budget_index_id;
  new.correction_base_month:=coalesce(cfg.budget_base_month,date_trunc('month',new.reference_date)::date,date_trunc('month',now() at time zone 'America/Sao_Paulo')::date);
 end if;
 return new;
end $$;
create trigger a_inherit_project_budget_adjustment before insert on public.engineering_budgets for each row execute function finance_private.inherit_project_budget_adjustment();

create function finance_private.inherit_project_sale_adjustment() returns trigger language plpgsql security definer set search_path='' as $$
declare cfg public.project_adjustment_settings; v uuid;
begin
 if coalesce(new.source_system,'elos_os') not in ('elos_os','manual') then return new; end if;
 select * into cfg from public.project_adjustment_settings where project_id=new.project_id and company_id=new.company_id;
 if not found then return new; end if;
 insert into public.contract_adjustment_versions(company_id,project_id,sale_id,mode,base_month,reason,created_by)
 values(new.company_id,new.project_id,new.id,case when cfg.installments_enabled=false then 'none' else 'pending' end,date_trunc('month',new.sale_date)::date,'Padrão do empreendimento na criação; condições específicas dependem da negociação.',new.created_by) returning id into v;
 update public.sales set adjustment_policy_id=v where id=new.id;
 return new;
end $$;
create trigger sale_inherit_adjustment after insert on public.sales for each row execute function finance_private.inherit_project_sale_adjustment();
create function finance_private.validate_sale_adjustment_link() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.adjustment_policy_id is not null and new.adjustment_policy_id is null then raise exception 'Crie uma revisão sem reajuste para desativar a regra do contrato.'; end if;
 if new.adjustment_policy_id is not null and not exists(select 1 from public.contract_adjustment_versions where id=new.adjustment_policy_id and company_id=new.company_id and project_id=new.project_id and sale_id=new.id) then raise exception 'Regra de reajuste fora do contrato.'; end if;
 return new;
end $$;
create trigger sale_validate_adjustment_link before insert or update on public.sales for each row execute function finance_private.validate_sale_adjustment_link();

-- Returns a factor only when the precise competencies required by the contract exist.
create function finance_private.contract_phase_factor(p_company uuid,p_index uuid,p_base date,p_target date,p_interval integer,p_lag integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare idx public.correction_indices; b date; t date; months integer; bv numeric; tv numeric; factor numeric; n integer; values_used jsonb;
begin
 months:=greatest(0,(extract(year from p_target)::int-extract(year from p_base)::int)*12+extract(month from p_target)::int-extract(month from p_base)::int);
 b:=(p_base-make_interval(months=>p_lag))::date;
 t:=(p_base+make_interval(months=>(months/p_interval)*p_interval-p_lag))::date;
 if p_index is null or t<=b then return jsonb_build_object('ready',true,'factor',1,'index_id',p_index,'base_month',b,'target_month',t); end if;
 select * into idx from public.correction_indices where id=p_index and company_id=p_company;
 if idx.id is null then return jsonb_build_object('ready',false,'reason','Índice não localizado na construtora.'); end if;
 if idx.value_type='index_number' then
  select value into bv from public.correction_index_values where company_id=p_company and correction_index_id=p_index and reference_month=b;
  select value into tv from public.correction_index_values where company_id=p_company and correction_index_id=p_index and reference_month=t;
  if bv is null or tv is null or bv<=0 or tv<=0 then return jsonb_build_object('ready',false,'reason','Índice-base ou índice da competência pendente.','index_id',p_index,'base_month',b,'target_month',t); end if;
  factor:=tv/bv; values_used:=jsonb_build_object('base',bv,'target',tv);
 else
  select count(*),exp(sum(ln(1+value/100))),jsonb_agg(jsonb_build_object('month',reference_month,'value',value) order by reference_month) into n,factor,values_used
   from public.correction_index_values where company_id=p_company and correction_index_id=p_index and reference_month>b and reference_month<=t and value>-100;
  if n<>(extract(year from t)::int-extract(year from b)::int)*12+extract(month from t)::int-extract(month from b)::int then return jsonb_build_object('ready',false,'reason','Série mensal incompleta para o período.','index_id',p_index,'base_month',b,'target_month',t); end if;
 end if;
 return jsonb_build_object('ready',true,'factor',factor,'index_id',p_index,'code',idx.code,'base_month',b,'target_month',t,'values',values_used);
end $$;

create function finance_private.calculate_contract_adjustment(p_policy uuid,p_company uuid,p_project uuid,p_sale uuid,p_due date,p_amount numeric)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cfg public.contract_adjustment_versions; target date:=date_trunc('month',now() at time zone 'America/Sao_Paulo')::date; pre jsonb; post jsonb; f numeric; due_month date:=date_trunc('month',p_due)::date;
begin
 select * into cfg from public.contract_adjustment_versions where id=p_policy and company_id=p_company and project_id=p_project and sale_id=p_sale;
 if cfg.id is null then raise exception 'Regra de reajuste fora do contrato.'; end if;
 if cfg.mode='pending' then return jsonb_build_object('ready',false,'policy_id',cfg.id,'reason','Defina os reajustes negociados neste contrato.'); end if;
 if cfg.limit_rule='due_month' then target:=least(target,due_month); end if;
 if cfg.mode='none' or due_month<(cfg.base_month+make_interval(months=>cfg.start_month))::date or target<cfg.base_month then
  return jsonb_build_object('ready',true,'policy_id',cfg.id,'factor',1,'amount',round(p_amount,2),'target_month',target,'mode',cfg.mode);
 end if;
 pre:=finance_private.contract_phase_factor(p_company,cfg.pre_index_id,cfg.base_month,least(target,cfg.keys_month),cfg.pre_interval,cfg.pre_lag);
 post:=finance_private.contract_phase_factor(p_company,cfg.post_index_id,cfg.keys_month,greatest(target,cfg.keys_month),cfg.post_interval,cfg.post_lag);
 if not (pre->>'ready')::boolean or not (post->>'ready')::boolean then return jsonb_build_object('ready',false,'policy_id',cfg.id,'reason','Publicações pendentes; confira a memória por fase.','pre',pre,'post',post,'target_month',target); end if;
 f:=(pre->>'factor')::numeric*(post->>'factor')::numeric;
 return jsonb_build_object('ready',true,'policy_id',cfg.id,'mode',cfg.mode,'factor',f,'amount',round(p_amount*f,2),'pre',pre,'post',post,'target_month',target);
end $$;

create function finance_private.apply_contract_adjustment(r public.receivables) returns public.receivables language plpgsql security definer set search_path='' as $$
declare calc jsonb; cfg public.contract_adjustment_versions;
begin
 select * into cfg from public.contract_adjustment_versions where id=r.adjustment_policy_id and company_id=r.company_id and project_id=r.project_id and sale_id=r.sale_id;
 if cfg.id is null then raise exception 'Regra de reajuste fora da parcela.'; end if;
 if r.correction_locked or r.status<>'open' or coalesce(r.paid_amount,0)>0 or r.source_system='eobra' then return r; end if;
 if exists(select 1 from public.finance_collections where receivable_id=r.id and company_id=r.company_id and status<>'cancelled') then return r; end if;
 calc:=finance_private.calculate_contract_adjustment(cfg.id,r.company_id,r.project_id,r.sale_id,r.due_date,r.amount);
 r.adjustment_calculation:=calc;
 if not (calc->>'ready')::boolean then
  if coalesce(r.adjusted_amount,0)=0 then r.adjusted_amount:=r.amount+coalesce(r.installment_interest_amount,0)+coalesce(r.late_fee_amount,0)+coalesce(r.other_accrual_amount,0)-coalesce(r.discount_amount,0); end if;
  return r;
 end if;
 r.correction_amount:=(calc->>'amount')::numeric-r.amount;
 r.adjusted_amount:=(calc->>'amount')::numeric+coalesce(r.installment_interest_amount,0)+coalesce(r.late_fee_amount,0)+coalesce(r.other_accrual_amount,0)-coalesce(r.discount_amount,0);
 r.adjustment_index:=case when cfg.mode='none' then null else concat(coalesce(calc->'pre'->>'code','Sem índice'),' / ',coalesce(calc->'post'->>'code','Sem índice')) end;
 r.correction_index_id:=case when (calc->>'target_month')::date>cfg.keys_month then cfg.post_index_id else cfg.pre_index_id end;
 r.correction_base_month:=cfg.base_month; r.correction_reference_month:=(calc->>'target_month')::date;
 -- Different series cannot share a single scalar base/reference. Full memory is in the JSON snapshot.
 r.correction_base_value:=null; r.correction_reference_value:=null;
 return r;
end $$;

create function finance_private.save_contract_adjustment(p_company uuid,p_sale uuid,p_policy jsonb,p_apply boolean,p_expected uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.sales; v uuid; n integer:=0; cfg public.contract_adjustment_versions;
begin
 if auth.uid() is null or not public.has_company_permission(p_company,'sales.manage') or (p_apply and not public.has_company_permission(p_company,'receivables.manage')) then raise exception 'Sem permissão para revisar o reajuste do contrato.'; end if;
 select * into s from public.sales where id=p_sale and company_id=p_company and status='active' for update;
 if s.id is null then raise exception 'Contrato indisponível.'; end if;
 if s.adjustment_policy_id is distinct from p_expected then raise exception 'A regra foi alterada por outra pessoa. Reabra o contrato.'; end if;
 if p_apply is null or p_policy->>'mode' is null or p_policy->>'mode' not in ('none','phased') or length(trim(coalesce(p_policy->>'reason','')))<5 then raise exception 'Informe a escolha de reajuste e o motivo da revisão.'; end if;
 cfg.mode:=p_policy->>'mode';cfg.pre_index_id:=nullif(p_policy->>'pre_index_id','')::uuid;cfg.post_index_id:=nullif(p_policy->>'post_index_id','')::uuid;
 if cfg.mode='none' then cfg.pre_index_id:=null;cfg.post_index_id:=null; end if;
 if exists(select 1 from unnest(array[cfg.pre_index_id,cfg.post_index_id]) x where x is not null and not exists(select 1 from public.correction_indices where id=x and company_id=p_company and status='active')) then raise exception 'Índice inválido para a construtora.'; end if;
 insert into public.contract_adjustment_versions(company_id,project_id,sale_id,mode,base_month,keys_month,start_month,limit_rule,pre_index_id,post_index_id,pre_interval,post_interval,pre_lag,post_lag,reason,created_by)
 values(p_company,s.project_id,s.id,cfg.mode,(p_policy->>'base_month')::date,nullif(p_policy->>'keys_month','')::date,coalesce((p_policy->>'start_month')::integer,0),coalesce(p_policy->>'limit_rule','current_month'),cfg.pre_index_id,cfg.post_index_id,coalesce((p_policy->>'pre_interval')::integer,1),coalesce((p_policy->>'post_interval')::integer,1),coalesce((p_policy->>'pre_lag')::integer,0),coalesce((p_policy->>'post_lag')::integer,0),trim(p_policy->>'reason'),auth.uid()) returning id into v;
 update public.sales set adjustment_policy_id=v,updated_at=now() where id=s.id;
 if p_apply then
  update public.receivables r set adjustment_policy_id=v,updated_at=now() where company_id=p_company and sale_id=s.id and project_id=s.project_id and status='open' and not correction_locked and coalesce(paid_amount,0)=0 and source_system is distinct from 'eobra'
   and not exists(select 1 from public.finance_collections c where c.receivable_id=r.id and c.company_id=r.company_id and c.status<>'cancelled');
  get diagnostics n=row_count;
 end if;
 insert into public.adjustment_policy_events(company_id,project_id,sale_id,event,detail,created_by) values(p_company,s.project_id,s.id,'contract_revision',jsonb_build_object('previous_policy_id',s.adjustment_policy_id,'policy_id',v,'updated_installments',n),auth.uid());
 return jsonb_build_object('policy_id',v,'updated_installments',n);
end $$;
create function public.save_contract_adjustment(p_company uuid,p_sale uuid,p_policy jsonb,p_apply boolean,p_expected uuid)
returns jsonb language sql security invoker set search_path='' as $$select finance_private.save_contract_adjustment(p_company,p_sale,p_policy,p_apply,p_expected)$$;

-- Preserve the existing legacy engine byte-for-byte; only versioned native installments
-- enter the new branch. Link validation runs before any legacy fallback.
do $$ declare def text; prefix text; begin
 def:=pg_get_functiondef('public.set_receivable_automatic_correction()'::regprocedure);
 prefix:=$code$begin
  if TG_OP='INSERT' and new.adjustment_policy_id is null and coalesce(new.source_system,'elos_os') in ('elos_os','manual') then
    select adjustment_policy_id into new.adjustment_policy_id from public.sales where id=new.sale_id and company_id=new.company_id and project_id=new.project_id;
  end if;
  if TG_OP='UPDATE' and old.adjustment_policy_id is not null and new.adjustment_policy_id is null then raise exception 'A regra contratual não pode ser removida da parcela.'; end if;
  if TG_OP='UPDATE' and new.adjustment_policy_id is distinct from old.adjustment_policy_id and
    (old.correction_locked or old.status<>'open' or coalesce(old.paid_amount,0)>0 or old.source_system='eobra' or exists(select 1 from public.finance_collections where receivable_id=old.id and status<>'cancelled')) then raise exception 'Parcela protegida não pode trocar de regra.'; end if;
  if new.adjustment_policy_id is not null then return finance_private.apply_contract_adjustment(new); end if;
$code$;
 if position('finance_private.apply_contract_adjustment' in def)>0 then raise exception 'Motor já adaptado; revisar migration.'; end if;
 if def !~* '\mbegin\M' then raise exception 'Motor de correção indisponível.'; end if;
 execute regexp_replace(def,'\mbegin\M',prefix,'i');
end $$;

create or replace function public.refresh_receivables_after_index_change() returns trigger language plpgsql security definer set search_path='' as $$
declare c uuid; i uuid;
begin
 if tg_op='DELETE' then c:=old.company_id;i:=old.correction_index_id; else c:=new.company_id;i:=new.correction_index_id; end if;
 update public.receivables r set updated_at=now() where r.company_id=c and r.status='open' and not r.correction_locked and coalesce(r.paid_amount,0)=0 and r.source_system is distinct from 'eobra'
 and (r.correction_index_id=i or exists(select 1 from public.contract_adjustment_versions p where p.id=r.adjustment_policy_id and p.company_id=c and (p.pre_index_id=i or p.post_index_id=i)))
 and not exists(select 1 from public.finance_collections f where f.receivable_id=r.id and f.company_id=c and f.status<>'cancelled');
 if tg_op='DELETE' then return old; end if;return new;
end $$;

-- Recompute with the exact version before preparing a bank charge, and snapshot both phases.
do $$ declare def text; anchor text:='select * into r from public.receivables where id=p_receivable and company_id=p_company for update;'; begin
 def:=pg_get_functiondef('finance_private.collection_prepare(uuid,uuid)'::regprocedure);
 if position(anchor in def)=0 then raise exception 'Preparação de cobrança mudou; adaptar integração antes de implantar.'; end if;
 def:=replace(def,anchor,anchor||$code$
 if r.adjustment_policy_id is not null and not exists(select 1 from public.finance_collections where receivable_id=r.id and status<>'cancelled') then
  update public.receivables set updated_at=now() where id=r.id;
  select * into r from public.receivables where id=p_receivable and company_id=p_company;
  if coalesce((r.adjustment_calculation->>'ready')::boolean,false)=false then raise exception 'Reajuste contratual pendente. Confira índices e regras antes de emitir.'; end if;
 end if;
$code$);
 if position($anchor$'locked',r.correction_locked$anchor$ in def)=0 then raise exception 'Snapshot de cobrança mudou; adaptar integração.'; end if;
 def:=replace(def,$anchor$'locked',r.correction_locked$anchor$,$anchor$'contract_policy_id',r.adjustment_policy_id,'contract_calculation',r.adjustment_calculation,'locked',r.correction_locked$anchor$);
 execute def;
end $$;

revoke all on function finance_private.save_project_adjustment(uuid,uuid,boolean,uuid,date,boolean,boolean),public.save_project_adjustment(uuid,uuid,boolean,uuid,date,boolean,boolean),finance_private.save_contract_adjustment(uuid,uuid,jsonb,boolean,uuid),public.save_contract_adjustment(uuid,uuid,jsonb,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.save_project_adjustment(uuid,uuid,boolean,uuid,date,boolean,boolean),public.save_project_adjustment(uuid,uuid,boolean,uuid,date,boolean,boolean),finance_private.save_contract_adjustment(uuid,uuid,jsonb,boolean,uuid),public.save_contract_adjustment(uuid,uuid,jsonb,boolean,uuid) to authenticated;
revoke all on function finance_private.inherit_project_budget_adjustment(),finance_private.inherit_project_sale_adjustment(),finance_private.validate_sale_adjustment_link(),finance_private.contract_phase_factor(uuid,uuid,date,date,integer,integer),finance_private.calculate_contract_adjustment(uuid,uuid,uuid,uuid,date,numeric),finance_private.apply_contract_adjustment(public.receivables),public.set_receivable_automatic_correction(),public.refresh_receivables_after_index_change() from public,anon,authenticated,service_role;
-- Missing publications are pending, never a fabricated zero adjustment.
create or replace function public.engineering_correction_factor(p_company_id uuid,p_index_id uuid,p_base_month date,p_target_month date default current_date,p_base_value numeric default null)
returns numeric language plpgsql stable security invoker set search_path='' as $$
declare typ text; b date:=date_trunc('month',p_base_month)::date; t date:=date_trunc('month',coalesce(p_target_month,(now() at time zone 'America/Sao_Paulo')::date))::date; bv numeric; tv numeric; n integer; f numeric;
begin
 if p_index_id is null or b is null then return null; end if;
 select value_type into typ from public.correction_indices where company_id=p_company_id and id=p_index_id;
 if typ is null then return null; end if;
 if t<=b then return 1; end if;
 if typ='index_number' then
  select value into bv from public.correction_index_values where company_id=p_company_id and correction_index_id=p_index_id and reference_month=b;
  select value into tv from public.correction_index_values where company_id=p_company_id and correction_index_id=p_index_id and reference_month=t;
  bv:=coalesce(p_base_value,bv);
  if bv is null or bv<=0 or tv is null or tv<=0 then return null; end if;
  return tv/bv;
 end if;
 select count(*),exp(sum(ln(1+value/100))) into n,f from public.correction_index_values where company_id=p_company_id and correction_index_id=p_index_id and reference_month>b and reference_month<=t and value>-100;
 if n<>(extract(year from t)::int-extract(year from b)::int)*12+extract(month from t)::int-extract(month from b)::int then return null; end if;
 return f;
end $$;
-- Keep the existing budget module, tightening only the competency lookup for new configurations.
do $$ declare def text; fn text; begin
 foreach fn in array array['public.prepare_engineering_budget_adjustment()','public.validate_engineering_budget_amendment()'] loop
  def:=pg_get_functiondef(fn::regprocedure);
  if position('reference_month <= new.correction_base_month' in def)=0 then raise exception 'Revisar preparação de índice-base do orçamento.'; end if;
  execute replace(def,'reference_month <= new.correction_base_month','reference_month = new.correction_base_month');
 end loop;
end $$;

-- Hardening of the reused budget adjustment module's helper routines.
revoke all on function public.prepare_engineering_budget_adjustment(),public.validate_engineering_budget_amendment(),public.validate_engineering_budget_amendment_item(),public.guard_engineering_budget_amendment_after_approval() from public,anon,authenticated,service_role;
revoke all on function public.engineering_correction_factor(uuid,uuid,date,date,numeric) from public,anon,service_role;
grant execute on function public.engineering_correction_factor(uuid,uuid,date,date,numeric) to authenticated;
commit;
