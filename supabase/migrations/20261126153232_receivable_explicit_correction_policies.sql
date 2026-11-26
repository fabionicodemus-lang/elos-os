-- Explicit per-installment correction. No policy is enabled by this migration.
-- Imported history stays locked against the legacy sale-date/four-month engine.
begin;

create schema if not exists finance_correction_private;
revoke all on schema finance_correction_private from public,anon,authenticated;
grant usage on schema finance_correction_private to authenticated;

-- A transaction-scoped, owner-written capability for the exact computed values.
-- Unlike a session GUC, authenticated clients cannot forge this authorization.
create table finance_correction_private.revaluation_intents(
  transaction_id bigint not null,receivable_id uuid not null references public.receivables(id),
  company_id uuid not null references public.companies(id),project_id uuid not null references public.projects(id),
  correction_amount numeric(16,2) not null,adjusted_amount numeric(16,2) not null,
  reference_month date not null,reference_value numeric(18,6) not null,
  created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  primary key(transaction_id,receivable_id)
);
alter table finance_correction_private.revaluation_intents enable row level security;
revoke all on finance_correction_private.revaluation_intents from public,anon,authenticated;

create table public.correction_index_source_links(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid references public.projects(id),
  source_system text not null check(source_system='eobra_snapshot'),source_index_id uuid not null references public.eobra_source_indices(id),
  correction_index_id uuid not null references public.correction_indices(id),source_host text not null,source_id text not null,
  source_run_id uuid not null references public.eobra_migration_runs(id),source_record_id uuid not null references public.eobra_migration_records(id),
  verified_hash text not null,evidence jsonb not null,
  created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(company_id,source_index_id)
);

create table public.correction_index_value_history(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid references public.projects(id),
  correction_index_id uuid not null references public.correction_indices(id),value_id uuid not null,
  reference_month date not null,operation text not null check(operation in('INSERT','UPDATE','DELETE')),
  old_value numeric(18,6),new_value numeric(18,6),old_details jsonb,new_details jsonb,
  created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index correction_index_value_history_scope_idx on public.correction_index_value_history(company_id,correction_index_id,reference_month,created_at desc);

create table public.receivable_correction_queue(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid references public.projects(id),
  correction_index_id uuid not null references public.correction_indices(id),generation bigint not null default 1,
  reason text not null,last_requested_at timestamptz not null default now(),
  created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(company_id,correction_index_id)
);

create table public.receivable_correction_policies(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid not null references public.projects(id),
  receivable_id uuid not null unique references public.receivables(id),correction_index_id uuid not null references public.correction_indices(id),
  source_link_id uuid not null references public.correction_index_source_links(id),source_record_id uuid not null references public.eobra_migration_records(id),
  source_run_id uuid not null references public.eobra_migration_runs(id),source_rule_id text not null,
  base_month date not null,base_value numeric(18,6) not null check(base_value>0),original_amount numeric(16,2) not null check(original_amount>=0),
  negative_variation_policy text not null check(negative_variation_policy='maximum_of_period'),
  correct_until_settled boolean not null check(correct_until_settled),reference_method text not null check(reference_method='current_month_sao_paulo'),
  snapshot_month date not null,snapshot_current_amount numeric(16,2) not null,snapshot_correction_amount numeric(16,2) not null,
  source_evidence jsonb not null,parity_hash text not null,
  enabled boolean not null,state text not null check(state in('active','blocked','suspended','review_required')),
  last_reference_month date not null,last_reference_value numeric(18,6) not null,
  effective_reference_month date not null,effective_reference_value numeric(18,6) not null,
  last_series_hash text not null,last_checked_month date not null,last_checked_generation bigint not null,
  last_checked_at timestamptz not null default now(),last_error text,
  activated_by uuid not null references auth.users(id),activated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(base_month=date_trunc('month',base_month)::date and snapshot_month=date_trunc('month',snapshot_month)::date and base_month<=snapshot_month)
);
create index receivable_correction_policies_refresh_idx on public.receivable_correction_policies(company_id,correction_index_id,enabled,last_checked_month,last_checked_generation,receivable_id);

create table public.receivable_correction_events(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid not null references public.projects(id),
  policy_id uuid not null references public.receivable_correction_policies(id),receivable_id uuid not null references public.receivables(id),
  event_type text not null check(event_type in('activated','updated','blocked','suspended','review_required')),
  reference_month date not null,old_amount numeric(16,2),new_amount numeric(16,2),details jsonb not null,
  created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index receivable_correction_events_scope_idx on public.receivable_correction_events(company_id,project_id,receivable_id,created_at desc);

do $$ declare t text;begin
  foreach t in array array['correction_index_source_links','correction_index_value_history','receivable_correction_queue','receivable_correction_policies','receivable_correction_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy %I on public.%I for select to authenticated using(public.is_company_member(company_id) and (public.has_company_permission(company_id,''indices.view'') or public.has_company_permission(company_id,''indices.manage'') or public.has_company_permission(company_id,''receivables.view'') or public.has_company_permission(company_id,''receivables.manage'')))',t||'_read',t);
  end loop;
end; $$;

create function finance_correction_private.immutable_evidence() returns trigger language plpgsql security invoker set search_path='' as $$begin
  raise exception 'Evidência de correção é imutável; preserve a revisão em um novo evento.';
end;$$;
create trigger correction_source_link_immutable before update or delete on public.correction_index_source_links for each row execute function finance_correction_private.immutable_evidence();
create trigger correction_value_history_immutable before update or delete on public.correction_index_value_history for each row execute function finance_correction_private.immutable_evidence();
create trigger correction_events_immutable before update or delete on public.receivable_correction_events for each row execute function finance_correction_private.immutable_evidence();

create function finance_correction_private.reference_month(p_at timestamptz) returns date language sql immutable security invoker set search_path='' as $$select date_trunc('month',timezone('America/Sao_Paulo',p_at))::date$$;
create function finance_correction_private.current_month() returns date language sql stable security invoker set search_path='' as $$select finance_correction_private.reference_month(transaction_timestamp())$$;
create function finance_correction_private.hash(p_value jsonb) returns text language sql immutable security invoker set search_path='' as $$select encode(sha256(convert_to(p_value::text,'UTF8')),'hex')$$;
create function finance_correction_private.zero_rate(p_value jsonb) returns boolean language sql immutable security invoker set search_path='' as $$select jsonb_typeof(p_value)='string' and (p_value#>>'{}') ~ '^0(\.0{1,6})?$'$$;
create function finance_correction_private.assert_permission(p_company uuid,p_review boolean) returns void language plpgsql security invoker set search_path='' as $$begin
  if auth.uid() is null or not coalesce(public.is_company_member(p_company),false)
    or (p_review and (not coalesce(public.has_company_permission(p_company,'admin.company.manage'),false) or not coalesce(public.has_company_permission(p_company,'indices.manage'),false) or not coalesce(public.has_company_permission(p_company,'receivables.manage'),false)))
    or (not p_review and not (coalesce(public.has_company_permission(p_company,'indices.manage'),false) or coalesce(public.has_company_permission(p_company,'receivables.manage'),false))) then
    raise exception 'Sem permissão para revisar ou atualizar a correção nesta empresa.';
  end if;
end;$$;

-- All writers of one index share this lock; readers never wait on value rows
-- while holding a title lock. Payment uses the title lock before any policy row.
create function finance_correction_private.index_lock(p_company uuid,p_index uuid) returns void language sql volatile security invoker set search_path='' as $$select pg_advisory_xact_lock(hashtextextended('explicit-correction|'||p_company::text||'|'||p_index::text,0))$$;

create function finance_correction_private.series_hash(p_company uuid,p_index uuid,p_base date,p_reference date)
returns text language sql stable security invoker set search_path='' as $$
  select finance_correction_private.hash(jsonb_build_object('index',p_index,'base',p_base,'reference',p_reference,'points',coalesce(jsonb_agg(jsonb_build_object('month',v.reference_month,'value',v.value::text) order by v.reference_month),'[]'::jsonb)))
  from public.correction_index_values v where v.company_id=p_company and v.correction_index_id=p_index and v.reference_month between p_base and p_reference;
$$;

-- No nominal fallback. Missing/revised months produce a pending result while
-- the caller keeps the last validated title amount.
create function finance_correction_private.evaluate(
  p_company uuid,p_index uuid,p_base date,p_base_value numeric,p_reference date,p_original numeric,
  p_interest numeric,p_penalty numeric,p_other numeric,p_discount numeric
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare idx public.correction_indices%rowtype; e jsonb:='[]';missing jsonb;v_base numeric;v_reference numeric;v_effective numeric;v_effective_month date;v_principal numeric;v_current numeric;v_hash text;v_months integer;v_numerator numeric;v_denominator numeric;
begin
  select * into idx from public.correction_indices where id=p_index and company_id=p_company;
  if not found or idx.value_type<>'index_number' or idx.status<>'active' then e:=e||jsonb_build_array('Índice numérico ativo não encontrado nesta empresa.');end if;
  if p_base is null or p_reference is null or p_base<>date_trunc('month',p_base)::date or p_reference<>date_trunc('month',p_reference)::date or p_base>p_reference then
    return jsonb_build_object('ok',false,'errors',e||jsonb_build_array('Competências de base e referência inválidas.'));
  end if;
  v_months:=(extract(year from p_reference)::int-extract(year from p_base)::int)*12+extract(month from p_reference)::int-extract(month from p_base)::int+1;
  if v_months>1200 then return jsonb_build_object('ok',false,'errors',e||jsonb_build_array('Período de correção excede 1.200 competências.'));end if;
  if p_reference>finance_correction_private.current_month() then e:=e||jsonb_build_array('Índice futuro não pode corrigir uma parcela antes do mês vigente em São Paulo.');end if;
  if p_base_value is null or p_base_value::text in('NaN','Infinity','-Infinity') or p_base_value<=0 or p_base_value<>round(p_base_value,6) then e:=e||jsonb_build_array('Valor-base explícito inválido.');end if;
  if p_original is null or p_interest is null or p_penalty is null or p_other is null or p_discount is null
    or p_original::text in('NaN','Infinity','-Infinity') or p_interest::text in('NaN','Infinity','-Infinity') or p_penalty::text in('NaN','Infinity','-Infinity') or p_other::text in('NaN','Infinity','-Infinity') or p_discount::text in('NaN','Infinity','-Infinity')
    or least(p_original,p_interest,p_penalty,p_other,p_discount)<0 then e:=e||jsonb_build_array('Principal e componentes monetários devem estar explícitos e válidos.');end if;
  select coalesce(jsonb_agg(to_char(m,'YYYY-MM') order by m),'[]'::jsonb) into missing
  from generate_series(p_base::timestamp,p_reference::timestamp,interval '1 month') m
  left join public.correction_index_values v on v.company_id=p_company and v.correction_index_id=p_index and v.reference_month=m::date
  where v.id is null or v.value<=0 or v.value::text in('NaN','Infinity','-Infinity');
  if jsonb_array_length(missing)>0 then e:=e||jsonb_build_array('Série mensal incompleta ou inválida; o último valor foi preservado.');end if;
  select value into v_base from public.correction_index_values where company_id=p_company and correction_index_id=p_index and reference_month=p_base;
  select value into v_reference from public.correction_index_values where company_id=p_company and correction_index_id=p_index and reference_month=p_reference;
  if v_base is distinct from p_base_value then e:=e||jsonb_build_array('Índice da competência-base diverge do valor-base validado.');end if;
  if jsonb_array_length(e)>0 then return jsonb_build_object('ok',false,'errors',e,'missing_months',missing,'reference_month',p_reference);end if;
  select reference_month,value into v_effective_month,v_effective from public.correction_index_values
    where company_id=p_company and correction_index_id=p_index and reference_month between p_base and p_reference
    order by value desc,reference_month desc limit 1;
  -- Integer cents and index millionths: one exact HALF_UP operation, including
  -- amounts beyond JavaScript safe integers; never round the ratio first.
  v_numerator:=(p_original*100)*(v_effective*1000000);v_denominator:=p_base_value*1000000;
  v_principal:=(div(v_numerator,v_denominator)+case when mod(v_numerator,v_denominator)*2>=v_denominator then 1 else 0 end)/100;
  v_current:=v_principal+p_interest+p_penalty+p_other-p_discount;
  if v_current<0 or v_current>99999999999999.99 or abs(v_principal-p_original)>99999999999999.99 then return jsonb_build_object('ok',false,'errors',jsonb_build_array('Valor atualizado fora da precisão financeira suportada.'));end if;
  v_hash:=finance_correction_private.series_hash(p_company,p_index,p_base,p_reference);
  return jsonb_build_object('ok',true,'errors','[]'::jsonb,'missing_months','[]'::jsonb,'base_month',p_base,'base_value',p_base_value::text,
    'reference_month',p_reference,'reference_value',v_reference::text,'effective_reference_month',v_effective_month,'effective_reference_value',v_effective::text,
    'corrected_principal',v_principal::numeric(16,2)::text,'correction_amount',(v_principal-p_original)::numeric(16,2)::text,'current_amount',v_current::numeric(16,2)::text,'series_hash',v_hash,'months',v_months);
end;$$;

create function finance_correction_private.index_preview(p_company uuid,p_source uuid,p_index uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare src public.eobra_source_indices%rowtype;idx public.correction_indices%rowtype;e jsonb:='[]';points jsonb;conflicts jsonb;cnt integer;new_count integer;v_hash text;
begin
  perform finance_correction_private.assert_permission(p_company,true);
  select * into src from public.eobra_source_indices where id=p_source and company_id=p_company and entity='correction_index';
  select * into idx from public.correction_indices where id=p_index and company_id=p_company and value_type='index_number' and status='active';
  if src.id is null or idx.id is null then raise exception 'Índice de origem ou destino indisponível nesta empresa.';end if;
  if src.details->>'value_type' is distinct from 'index_number' then e:=e||jsonb_build_array('A origem não declara índice numérico.');end if;
  if not exists(select 1 from public.eobra_migration_runs r where r.id=src.run_id and r.company_id=p_company and r.status='imported') then e:=e||jsonb_build_array('O pacote de origem ainda não foi promovido.');end if;
  if exists(select 1 from public.correction_index_source_links l where l.company_id=p_company and l.source_index_id=p_source and l.correction_index_id<>p_index) then e:=e||jsonb_build_array('Índice de origem já vinculado a outro índice canônico.');end if;
  select count(*)::int,count(*) filter(where v.id is null)::int,
    coalesce(jsonb_agg(jsonb_build_object('source_record',s.record_id,'source_value_id',s.id,'month',s.reference_month,'source_value',s.index_value::text,'target_value_id',v.id,'target_value',v.value::text) order by s.reference_month,s.id),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('month',s.reference_month,'source_value',s.index_value::text,'target_value',v.value::text) order by s.reference_month) filter(where v.id is not null and v.value is distinct from s.index_value),'[]'::jsonb)
    into cnt,new_count,points,conflicts
  from public.eobra_source_indices s left join public.correction_index_values v on v.company_id=p_company and v.correction_index_id=p_index and v.reference_month=s.reference_month
  where s.company_id=p_company and s.source_host=src.source_host and s.parent_index_id=src.id and s.entity='index_value';
  if cnt=0 or cnt>10000 then e:=e||jsonb_build_array('A série de origem precisa conter entre 1 e 10.000 competências.');end if;
  if jsonb_array_length(conflicts)>0 then e:=e||jsonb_build_array('Há competências com valores diferentes; nenhum valor existente será sobrescrito.');end if;
  if exists(select 1 from public.eobra_source_indices s where s.company_id=p_company and s.parent_index_id=src.id and s.entity='index_value' and
    (s.reference_month is null or s.reference_month<>date_trunc('month',s.reference_month)::date or s.index_value is null or s.index_value<=0 or s.index_value::text in('NaN','Infinity','-Infinity') or s.index_value<>round(s.index_value,6) or abs(s.index_value)>=1000000000000)) then e:=e||jsonb_build_array('Competência ou valor da série não cabe na precisão canônica sem perda.');end if;
  if exists(select 1 from public.eobra_source_indices s where s.company_id=p_company and s.parent_index_id=src.id and s.entity='index_value' group by s.reference_month having count(*)>1) then e:=e||jsonb_build_array('A origem possui competências duplicadas.');end if;
  v_hash:=finance_correction_private.hash(jsonb_build_object('company',p_company,'source',src.id,'source_record',src.record_id,'index',p_index,'index_type',idx.value_type,'index_status',idx.status,'points',points));
  return jsonb_build_object('ok',jsonb_array_length(e)=0,'errors',e,'preview_hash',v_hash,'source_index_id',src.id,'correction_index_id',idx.id,
    'source_name',src.details->>'name','source_host',src.source_host,'target_name',idx.name,'source_count',cnt,'insert_count',new_count,'unchanged_count',cnt-new_count-jsonb_array_length(conflicts),'conflicts',conflicts);
end;$$;

create function finance_correction_private.bind_index(p_company uuid,p_source uuid,p_index uuid,p_hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare preview jsonb;src public.eobra_source_indices%rowtype;existing public.correction_index_source_links%rowtype;result uuid;
begin
  perform finance_correction_private.assert_permission(p_company,true);
  perform finance_correction_private.index_lock(p_company,p_index);
  preview:=finance_correction_private.index_preview(p_company,p_source,p_index);
  if preview->'ok' is distinct from 'true'::jsonb then raise exception '%',preview->'errors';end if;
  select * into existing from public.correction_index_source_links where company_id=p_company and source_index_id=p_source;
  if found then
    if existing.correction_index_id<>p_index then raise exception 'Vínculo de índice divergente.';end if;
    if (preview->>'insert_count')::int=0 then return existing.id;end if;
  end if;
  if p_hash is null or p_hash<>preview->>'preview_hash' then raise exception 'A revisão dos índices mudou; confira novamente.';end if;
  select * into src from public.eobra_source_indices where id=p_source and company_id=p_company;
  insert into public.correction_index_values(company_id,correction_index_id,reference_month,value,notes,created_by)
    select p_company,p_index,s.reference_month,s.index_value,'Valor conferido com pacote de origem; vínculo auditável disponível.',auth.uid()
    from public.eobra_source_indices s where s.company_id=p_company and s.source_host=src.source_host and s.parent_index_id=src.id and s.entity='index_value'
    order by s.reference_month on conflict(company_id,correction_index_id,reference_month) do nothing;
  preview:=finance_correction_private.index_preview(p_company,p_source,p_index);
  if preview->'ok' is distinct from 'true'::jsonb then raise exception 'A série mudou durante o vínculo; nenhuma alteração foi confirmada.';end if;
  if existing.id is not null then return existing.id;end if;
  insert into public.correction_index_source_links(company_id,source_system,source_index_id,correction_index_id,source_host,source_id,source_run_id,source_record_id,verified_hash,evidence,created_by)
    values(p_company,'eobra_snapshot',src.id,p_index,src.source_host,src.source_id,src.run_id,src.record_id,preview->>'preview_hash',preview,auth.uid()) returning id into result;
  return result;
end;$$;

create function finance_correction_private.policy_preview(p_company uuid,p_receivable uuid,p_record uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.receivables%rowtype;s public.eobra_migration_records%rowtype;run public.eobra_migration_runs%rowtype;binding public.correction_index_source_links%rowtype;
  d jsonb;c jsonb;e jsonb:='[]';calc jsonb;ref date;base date;proof jsonb;v_hash text;source_index text;link_count integer;
begin
  perform finance_correction_private.assert_permission(p_company,true);
  select * into r from public.receivables where id=p_receivable and company_id=p_company;
  select * into s from public.eobra_migration_records where id=p_record and company_id=p_company and entity='receivable';
  if r.id is null or s.id is null then raise exception 'Parcela ou registro de origem indisponível nesta empresa.';end if;
  select * into run from public.eobra_migration_runs where id=s.run_id and company_id=p_company;
  if run.status<>'imported' or not exists(select 1 from public.eobra_migration_ledger l where l.company_id=p_company and l.entity='receivable' and l.record_id=s.id and l.run_id=run.id and l.record_hash=s.record_hash and l.targets->>'receivables'=r.id::text and l.disposition='canonical') then e:=e||jsonb_build_array('Parcela não está vinculada a uma promoção concluída e auditada.');end if;
  if r.project_id is distinct from s.project_id or r.source_system is distinct from 'eobra_snapshot' or r.source_id is distinct from run.source_host||'|receivable|'||s.source_id then e:=e||jsonb_build_array('A identidade da parcela não corresponde à origem promovida.');end if;
  d:=s.normalized_data;c:=d->'correction';
  if r.status<>'open' or coalesce(r.paid_amount,0)<>0 or d->>'status' is distinct from 'open' or d->>'paid_amount' is distinct from '0.00' then e:=e||jsonb_build_array('Quitadas, canceladas e parciais permanecem históricas e não habilitam recálculo.');end if;
  if c->>'mode' is distinct from 'index_number' or c->>'negative_variation_policy' is distinct from 'maximum_of_period' or c->'correct_until_settled' is distinct from 'true'::jsonb
    or c->'compound_interest' is distinct from 'false'::jsonb or nullif(btrim(c->>'source_rule_id'),'') is null
    or not coalesce(finance_correction_private.zero_rate(c->'additional_rate'),false) or not coalesce(finance_correction_private.zero_rate(c->'penalty_rate'),false) or not coalesce(finance_correction_private.zero_rate(c->'interest_rate'),false) then
    e:=e||jsonb_build_array('Regra incompleta ou não suportada: confirme índice, máxima do período, até quitar, taxas adicionais zero e ausência de juros compostos.');
  end if;
  if c ? 'lag_months' and c->>'lag_months' is distinct from '0' then e:=e||jsonb_build_array('Defasagem contratual informada ainda não possui motor nesta continuidade.');end if;
  if coalesce(c->>'base_month','') !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' or coalesce(c->>'reference_month','') !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' then e:=e||jsonb_build_array('Base e referência explícitas ausentes ou inválidas.');
  else base:=(c->>'base_month'||'-01')::date;ref:=(c->>'reference_month'||'-01')::date;end if;
  if ref is distinct from date_trunc('month',run.reference_date)::date then e:=e||jsonb_build_array('Referência da parcela não coincide com o mês do corte; a continuidade mensal precisa ser comprovada.');end if;
  if coalesce(c->>'base_value','') !~ '^[0-9]+(\.[0-9]{1,6})?$' or coalesce(c->>'reference_value','') !~ '^[0-9]+(\.[0-9]{1,6})?$' then e:=e||jsonb_build_array('Valores-base e referência explícitos inválidos.');end if;
  select count(*)::int,min(l.target_source_id) into link_count,source_index from public.eobra_migration_relations l where l.record_id=s.id and l.company_id=p_company and l.run_id=s.run_id and l.role='correction_index' and l.target_entity='correction_index';
  if link_count<>1 then e:=e||jsonb_build_array('A parcela precisa de exatamente um vínculo de índice da origem.');end if;
  select b.* into binding from public.correction_index_source_links b join public.eobra_source_indices i on i.id=b.source_index_id and i.company_id=b.company_id
    where b.company_id=p_company and b.source_host=run.source_host and i.source_id=source_index and i.entity='correction_index';
  if binding.id is null then e:=e||jsonb_build_array('Vincule o índice da origem ao cadastro canônico e confira a série antes de ativar.');end if;
  if r.amount::text is distinct from d->>'original_amount' or r.adjusted_amount::text is distinct from d->>'current_amount'
    or r.correction_amount::text is distinct from d->>'correction_amount' or r.installment_interest_amount::text is distinct from d->>'interest_amount'
    or r.late_fee_amount::text is distinct from d->>'penalty_amount' or r.other_accrual_amount::text is distinct from d->>'other_accrual_amount' or r.discount_amount::text is distinct from d->>'discount_amount' then
    e:=e||jsonb_build_array('Os valores atuais da parcela divergem do snapshot; revise a origem e alterações posteriores.');
  end if;
  if jsonb_array_length(e)=0 then
    calc:=finance_correction_private.evaluate(p_company,binding.correction_index_id,base,(c->>'base_value')::numeric,ref,r.amount,r.installment_interest_amount,r.late_fee_amount,r.other_accrual_amount,r.discount_amount);
    if calc->'ok' is distinct from 'true'::jsonb then e:=e||coalesce(calc->'errors','[]');
    elsif (calc->>'reference_value')::numeric<>(c->>'reference_value')::numeric or (calc->>'correction_amount')::numeric<>r.correction_amount or (calc->>'current_amount')::numeric<>r.adjusted_amount then e:=e||jsonb_build_array('A paridade financeira no corte não confere com a regra e a série capturadas.');end if;
    if exists(select 1 from public.correction_index_values v left join public.eobra_source_indices i on i.company_id=p_company and i.parent_index_id=binding.source_index_id and i.entity='index_value' and i.reference_month=v.reference_month and i.index_value=v.value
      where v.company_id=p_company and v.correction_index_id=binding.correction_index_id and v.reference_month between base and ref and i.id is null) then e:=e||jsonb_build_array('A série canônica do período diverge da evidência mensal da origem.');end if;
  end if;
  proof:=jsonb_build_object('company_id',p_company,'receivable_id',r.id,'project_id',r.project_id,'source_record_id',s.id,'source_hash',s.record_hash,'source_run_id',run.id,
    'source_link_id',binding.id,'correction_index_id',binding.correction_index_id,'source_rule',c,'reference_method','current_month_sao_paulo',
    'original_amount',r.amount::text,'current_amount',r.adjusted_amount::text,'correction_amount',r.correction_amount::text,'interest_amount',r.installment_interest_amount::text,'penalty_amount',r.late_fee_amount::text,'other_accrual_amount',r.other_accrual_amount::text,'discount_amount',r.discount_amount::text,'paid_amount',r.paid_amount::text,'status',r.status,'calculation',calc);
  v_hash:=finance_correction_private.hash(proof);
  return proof||jsonb_build_object('ok',jsonb_array_length(e)=0,'errors',e,'preview_hash',v_hash,'description',r.description,'due_date',r.due_date,'source_id',s.source_id,
    'reference_date',run.reference_date,'current_month',finance_correction_private.current_month(),
    'continuity_note','Após aprovação: atualização pelo máximo entre base e mês corrente de São Paulo; mês ausente gera pendência e preserva o último valor.');
end;$$;

create function finance_correction_private.activate(p_company uuid,p_receivable uuid,p_record uuid,p_hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare preview jsonb;r public.receivables%rowtype;c jsonb;calc jsonb;idx uuid;policy_id uuid;generation_value bigint;existing public.receivable_correction_policies%rowtype;
begin
  perform finance_correction_private.assert_permission(p_company,true);
  select * into existing from public.receivable_correction_policies where company_id=p_company and receivable_id=p_receivable;
  if found then
    if existing.source_record_id=p_record and existing.parity_hash=p_hash then return existing.id;end if;
    raise exception 'A parcela já possui outra revisão de política; substituição silenciosa não é permitida.';
  end if;
  preview:=finance_correction_private.policy_preview(p_company,p_receivable,p_record);
  if preview->'ok' is distinct from 'true'::jsonb then raise exception '%',preview->'errors';end if;
  idx:=(preview->>'correction_index_id')::uuid;
  perform finance_correction_private.index_lock(p_company,idx);
  select * into r from public.receivables where id=p_receivable and company_id=p_company for update;
  select * into existing from public.receivable_correction_policies where company_id=p_company and receivable_id=p_receivable;
  if found then
    if existing.source_record_id=p_record and existing.parity_hash=p_hash then return existing.id;end if;
    raise exception 'A parcela foi ativada por outra revisão; confira novamente.';
  end if;
  preview:=finance_correction_private.policy_preview(p_company,p_receivable,p_record);
  if preview->'ok' is distinct from 'true'::jsonb or p_hash is null or p_hash<>preview->>'preview_hash' then raise exception 'A revisão da parcela mudou; confira novamente antes de ativar.';end if;
  select id into policy_id from public.receivable_correction_policies where company_id=p_company and receivable_id=p_receivable;
  if found then raise exception 'A parcela já possui política auditada; não é permitida substituição silenciosa.';end if;
  c:=preview->'source_rule';calc:=preview->'calculation';
  select coalesce(max(generation),0) into generation_value from public.receivable_correction_queue where company_id=p_company and correction_index_id=idx;
  insert into public.receivable_correction_policies(company_id,project_id,receivable_id,correction_index_id,source_link_id,source_record_id,source_run_id,source_rule_id,
    base_month,base_value,original_amount,negative_variation_policy,correct_until_settled,reference_method,snapshot_month,snapshot_current_amount,snapshot_correction_amount,
    source_evidence,parity_hash,enabled,state,last_reference_month,last_reference_value,effective_reference_month,effective_reference_value,last_series_hash,last_checked_month,last_checked_generation,activated_by,created_by)
  values(p_company,r.project_id,r.id,idx,(preview->>'source_link_id')::uuid,p_record,(preview->>'source_run_id')::uuid,c->>'source_rule_id',
    (calc->>'base_month')::date,(calc->>'base_value')::numeric,r.amount,'maximum_of_period',true,'current_month_sao_paulo',(calc->>'reference_month')::date,r.adjusted_amount,r.correction_amount,
    preview,p_hash,true,'active',(calc->>'reference_month')::date,(calc->>'reference_value')::numeric,(calc->>'effective_reference_month')::date,(calc->>'effective_reference_value')::numeric,calc->>'series_hash',(calc->>'reference_month')::date,generation_value,auth.uid(),auth.uid()) returning id into policy_id;
  insert into finance_correction_private.revaluation_intents(transaction_id,receivable_id,company_id,project_id,correction_amount,adjusted_amount,reference_month,reference_value,created_by)
    values(txid_current(),r.id,p_company,r.project_id,r.correction_amount,r.adjusted_amount,(calc->>'effective_reference_month')::date,(calc->>'effective_reference_value')::numeric,auth.uid());
  update public.receivables set correction_locked=true,correction_index_id=idx,correction_base_month=(calc->>'base_month')::date,correction_base_value=(calc->>'base_value')::numeric,
    correction_reference_month=(calc->>'effective_reference_month')::date,correction_reference_value=(calc->>'effective_reference_value')::numeric,updated_at=now() where id=r.id;
  delete from finance_correction_private.revaluation_intents where transaction_id=txid_current() and receivable_id=r.id;
  insert into public.receivable_correction_events(company_id,project_id,policy_id,receivable_id,event_type,reference_month,old_amount,new_amount,details,created_by)
    values(p_company,r.project_id,policy_id,r.id,'activated',(calc->>'reference_month')::date,r.adjusted_amount,r.adjusted_amount,preview,auth.uid());
  return policy_id;
end;$$;

create function finance_correction_private.refresh_one(p_policy uuid,p_reference date,p_generation bigint) returns text language plpgsql security definer set search_path='' as $$
declare p public.receivable_correction_policies%rowtype;r public.receivables%rowtype;calc jsonb;reason text;new_state text;prior_hash text;
begin
  select * into p from public.receivable_correction_policies where id=p_policy;
  if not found then return 'skipped';end if;
  select * into r from public.receivables where id=p.receivable_id and company_id=p.company_id for update;
  select * into p from public.receivable_correction_policies where id=p_policy for update;
  if not p.enabled then return 'skipped';end if;
  if r.id is null or r.project_id<>p.project_id then new_state:='review_required';reason:='Parcela ou obra alterada após a aprovação.';
  elsif r.status<>'open' or coalesce(r.paid_amount,0)>0 then new_state:='suspended';reason:='Histórico recebido, cancelado ou parcial permanece travado; amortização não foi inferida.';
  elsif r.amount<>p.original_amount then new_state:='review_required';reason:='Principal alterado após a aprovação; a base contratual precisa de nova revisão.';
  else
    prior_hash:=finance_correction_private.series_hash(p.company_id,p.correction_index_id,p.base_month,p.last_reference_month);
    if prior_hash<>p.last_series_hash then new_state:='review_required';reason:='Série de uma competência já aplicada foi revisada; valores preservados até revisão explícita.';
    else
      calc:=finance_correction_private.evaluate(p.company_id,p.correction_index_id,p.base_month,p.base_value,p_reference,r.amount,r.installment_interest_amount,r.late_fee_amount,r.other_accrual_amount,r.discount_amount);
      if calc->'ok' is distinct from 'true'::jsonb then new_state:='blocked';reason:=calc->'errors'::text;
      else new_state:='active';end if;
    end if;
  end if;
  if new_state<>'active' then
    update public.receivable_correction_policies set state=new_state,enabled=new_state='blocked',last_error=reason,last_checked_month=p_reference,last_checked_generation=p_generation,last_checked_at=now(),updated_at=now() where id=p.id;
    insert into public.receivable_correction_events(company_id,project_id,policy_id,receivable_id,event_type,reference_month,old_amount,new_amount,details,created_by)
      values(p.company_id,p.project_id,p.id,p.receivable_id,new_state,p_reference,r.adjusted_amount,r.adjusted_amount,jsonb_build_object('reason',reason,'calculation',calc),auth.uid());
    return new_state;
  end if;
  insert into finance_correction_private.revaluation_intents(transaction_id,receivable_id,company_id,project_id,correction_amount,adjusted_amount,reference_month,reference_value,created_by)
    values(txid_current(),r.id,p.company_id,p.project_id,(calc->>'correction_amount')::numeric,(calc->>'current_amount')::numeric,(calc->>'effective_reference_month')::date,(calc->>'effective_reference_value')::numeric,auth.uid());
  update public.receivables set correction_locked=true,correction_index_id=p.correction_index_id,correction_base_month=p.base_month,correction_base_value=p.base_value,
    correction_reference_month=(calc->>'effective_reference_month')::date,correction_reference_value=(calc->>'effective_reference_value')::numeric,
    correction_amount=(calc->>'correction_amount')::numeric,adjusted_amount=(calc->>'current_amount')::numeric,updated_at=now() where id=r.id;
  delete from finance_correction_private.revaluation_intents where transaction_id=txid_current() and receivable_id=r.id;
  update public.receivable_correction_policies set state='active',enabled=true,last_error=null,last_reference_month=p_reference,last_reference_value=(calc->>'reference_value')::numeric,
    effective_reference_month=(calc->>'effective_reference_month')::date,effective_reference_value=(calc->>'effective_reference_value')::numeric,last_series_hash=calc->>'series_hash',
    last_checked_month=p_reference,last_checked_generation=p_generation,last_checked_at=now(),updated_at=now() where id=p.id;
  insert into public.receivable_correction_events(company_id,project_id,policy_id,receivable_id,event_type,reference_month,old_amount,new_amount,details,created_by)
    values(p.company_id,p.project_id,p.id,p.receivable_id,'updated',p_reference,r.adjusted_amount,(calc->>'current_amount')::numeric,calc,auth.uid());
  return 'updated';
end;$$;

create function finance_correction_private.refresh_batch(p_company uuid,p_index uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare idx record;row_value record;result text;processed integer:=0;updated_count integer:=0;blocked_count integer:=0;history_count integer:=0;pending_count integer;total_blocked integer;generation_value bigint;target date:=finance_correction_private.current_month();
begin
  if p_limit is null or p_limit<1 or p_limit>1000 then raise exception 'Atualize entre 1 e 1.000 parcelas por lote.';end if;
  for idx in select distinct correction_index_id from public.receivable_correction_policies where company_id=p_company and enabled and (p_index is null or correction_index_id=p_index) order by correction_index_id loop
    exit when processed>=p_limit;
    if not pg_try_advisory_xact_lock(hashtextextended('explicit-correction|'||p_company::text||'|'||idx.correction_index_id::text,0)) then continue;end if;
    select coalesce(max(generation),0) into generation_value from public.receivable_correction_queue where company_id=p_company and correction_index_id=idx.correction_index_id;
    for row_value in select p.id from public.receivable_correction_policies p join public.receivables r on r.id=p.receivable_id and r.company_id=p.company_id
      where p.company_id=p_company and p.correction_index_id=idx.correction_index_id and p.enabled
        and (p.last_checked_month<target or p.last_checked_generation<generation_value)
      order by p.last_checked_at,p.receivable_id limit (p_limit-processed) for update of r skip locked loop
      result:=finance_correction_private.refresh_one(row_value.id,target,generation_value);processed:=processed+1;
      if result='updated' then updated_count:=updated_count+1;elsif result in('blocked','review_required') then blocked_count:=blocked_count+1;else history_count:=history_count+1;end if;
    end loop;
  end loop;
  select count(*)::int into pending_count from public.receivable_correction_policies p left join public.receivable_correction_queue q on q.company_id=p.company_id and q.correction_index_id=p.correction_index_id
    where p.company_id=p_company and (p_index is null or p.correction_index_id=p_index) and p.enabled and (p.last_checked_month<target or p.last_checked_generation<coalesce(q.generation,0));
  select count(*)::int into total_blocked from public.receivable_correction_policies where company_id=p_company and (p_index is null or correction_index_id=p_index) and state in('blocked','review_required');
  return jsonb_build_object('reference_month',target,'processed',processed,'updated',updated_count,'blocked',blocked_count,'history_preserved',history_count,'pending',pending_count,'total_blocked',total_blocked);
end;$$;

-- A published index starts a bounded batch. The panel/RPC drains any remainder.
-- A new month without an index is checked by the explicit monthly RPC; no cron
-- is created or claimed to exist by this migration.
create function finance_correction_private.value_before() returns trigger language plpgsql security definer set search_path='' as $$
declare company_value uuid;index_value uuid;
begin
  if tg_op='DELETE' then company_value:=old.company_id;index_value:=old.correction_index_id;else company_value:=new.company_id;index_value:=new.correction_index_id;end if;
  if tg_op='UPDATE' and (old.company_id is distinct from new.company_id or old.correction_index_id is distinct from new.correction_index_id or old.reference_month is distinct from new.reference_month)
    and exists(select 1 from public.correction_index_source_links l where l.company_id=old.company_id and l.correction_index_id=old.correction_index_id) then raise exception 'Competência vinculada à origem é imutável; publique outra revisão de valor.';end if;
  perform finance_correction_private.index_lock(company_value,index_value);
  if tg_op='DELETE' then return old;end if;return new;
end;$$;
create function finance_correction_private.value_after() returns trigger language plpgsql security definer set search_path='' as $$
declare company_value uuid;index_value uuid;row_id uuid;month_value date;
begin
  if tg_op='UPDATE' and old.value is not distinct from new.value and old.reference_month is not distinct from new.reference_month and old.correction_index_id is not distinct from new.correction_index_id and old.company_id is not distinct from new.company_id then return new;end if;
  if tg_op='DELETE' then company_value:=old.company_id;index_value:=old.correction_index_id;row_id:=old.id;month_value:=old.reference_month;else company_value:=new.company_id;index_value:=new.correction_index_id;row_id:=new.id;month_value:=new.reference_month;end if;
  insert into public.correction_index_value_history(company_id,correction_index_id,value_id,reference_month,operation,old_value,new_value,old_details,new_details,created_by)
    values(company_value,index_value,row_id,month_value,tg_op,case when tg_op<>'INSERT' then old.value end,case when tg_op<>'DELETE' then new.value end,case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end,auth.uid());
  insert into public.receivable_correction_queue(company_id,correction_index_id,reason,created_by)
    values(company_value,index_value,'index_value_'||lower(tg_op),auth.uid()) on conflict(company_id,correction_index_id) do update set generation=public.receivable_correction_queue.generation+1,reason=excluded.reason,last_requested_at=now(),updated_at=now();
  perform finance_correction_private.refresh_batch(company_value,index_value,100);
  if tg_op='DELETE' then return old;end if;return new;
end;$$;
create trigger finance_explicit_index_lock before insert or update or delete on public.correction_index_values for each row execute function finance_correction_private.value_before();
create trigger finance_explicit_index_refresh after insert or update or delete on public.correction_index_values for each row execute function finance_correction_private.value_after();

create function finance_correction_private.index_metadata_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
  if old.company_id is distinct from new.company_id and exists(select 1 from public.correction_index_source_links where correction_index_id=old.id) then raise exception 'Índice vinculado à origem não pode mudar de empresa.';end if;
  if old.value_type is distinct from new.value_type or old.status is distinct from new.status then
    perform finance_correction_private.index_lock(new.company_id,new.id);
    insert into public.receivable_correction_queue(company_id,correction_index_id,reason,created_by) values(new.company_id,new.id,'index_metadata_changed',auth.uid())
      on conflict(company_id,correction_index_id) do update set generation=public.receivable_correction_queue.generation+1,reason=excluded.reason,last_requested_at=now(),updated_at=now();
    perform finance_correction_private.refresh_batch(new.company_id,new.id,100);
  end if;return new;
end;$$;
create trigger finance_explicit_index_metadata after update on public.correction_indices for each row execute function finance_correction_private.index_metadata_guard();

-- Force the lock before the legacy trigger, even if an old form submits false.
create function finance_correction_private.title_before() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.receivable_correction_policies%rowtype;
begin
  select * into p from public.receivable_correction_policies where receivable_id=new.id;
  if found then
    new.correction_locked:=true;
    if new.company_id<>p.company_id or new.project_id<>p.project_id or new.correction_index_id is distinct from p.correction_index_id or new.correction_base_month is distinct from p.base_month or new.correction_base_value is distinct from p.base_value then
      raise exception 'Obra, índice e base pertencem à política explicitamente revisada; não podem ser substituídos por formulário legado.';
    end if;
    if new.adjusted_amount is distinct from (new.amount+new.correction_amount+new.installment_interest_amount+new.late_fee_amount+new.other_accrual_amount-new.discount_amount) then
      raise exception 'O valor atualizado deve conferir com principal, correção e componentes explícitos.';
    end if;
    if (new.correction_amount is distinct from old.correction_amount or new.correction_reference_month is distinct from old.correction_reference_month or new.correction_reference_value is distinct from old.correction_reference_value
      or (new.adjusted_amount is distinct from old.adjusted_amount and new.amount is not distinct from old.amount and new.installment_interest_amount is not distinct from old.installment_interest_amount and new.late_fee_amount is not distinct from old.late_fee_amount and new.other_accrual_amount is not distinct from old.other_accrual_amount and new.discount_amount is not distinct from old.discount_amount))
      and not exists(select 1 from finance_correction_private.revaluation_intents i where i.transaction_id=txid_current() and i.receivable_id=new.id and i.company_id=new.company_id and i.project_id=new.project_id
        and i.correction_amount=new.correction_amount and i.adjusted_amount=new.adjusted_amount and i.reference_month=new.correction_reference_month and i.reference_value=new.correction_reference_value) then
      raise exception 'Correção e referência de uma política ativa só podem ser alteradas pelo cálculo validado.';
    end if;
  end if;
  return new;
end;$$;
create function finance_correction_private.title_after() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.receivable_correction_policies%rowtype;v_state text;reason text;
begin
  select * into p from public.receivable_correction_policies where receivable_id=new.id and company_id=new.company_id and enabled for update;
  if not found then return new;end if;
  if new.status<>'open' or coalesce(new.paid_amount,0)>0 then v_state:='suspended';reason:='Baixa ou cancelamento preservado; atualização automática suspensa para proteger o histórico.';
  elsif new.amount is distinct from old.amount then v_state:='review_required';reason:='Principal alterado; política precisa de revisão contratual.';
  else return new;end if;
  update public.receivable_correction_policies set enabled=false,state=v_state,last_error=reason,updated_at=now() where id=p.id;
  insert into public.receivable_correction_events(company_id,project_id,policy_id,receivable_id,event_type,reference_month,old_amount,new_amount,details,created_by)
    values(p.company_id,p.project_id,p.id,new.id,v_state,finance_correction_private.current_month(),old.adjusted_amount,new.adjusted_amount,jsonb_build_object('reason',reason),auth.uid());
  return new;
end;$$;
create trigger finance_explicit_correction_guard before update on public.receivables for each row execute function finance_correction_private.title_before();
create trigger finance_explicit_correction_history after update on public.receivables for each row execute function finance_correction_private.title_after();

create function finance_correction_private.refresh_authorized(p_company uuid,p_index uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$begin
  perform finance_correction_private.assert_permission(p_company,false);
  if p_index is not null and not exists(select 1 from public.correction_indices where id=p_index and company_id=p_company) then raise exception 'Índice fora da empresa.';end if;
  return finance_correction_private.refresh_batch(p_company,p_index,p_limit);
end;$$;

create function finance_correction_private.overview(p_company uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;target date:=finance_correction_private.current_month();
begin
  perform finance_correction_private.assert_permission(p_company,false);
  select jsonb_build_object('reference_month',target,'total',count(*),'active',count(*) filter(where p.state='active'),'blocked',count(*) filter(where p.state in('blocked','review_required')),'history_preserved',count(*) filter(where p.state='suspended'),
    'pending',count(*) filter(where p.enabled and (p.last_checked_month<target or p.last_checked_generation<coalesce(q.generation,0))),'scheduler_configured',false)
    into result from public.receivable_correction_policies p left join public.receivable_correction_queue q on q.company_id=p.company_id and q.correction_index_id=p.correction_index_id where p.company_id=p_company;
  return result;
end;$$;

create function finance_correction_private.candidates(p_company uuid,p_limit integer,p_offset integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;total integer;
begin
  perform finance_correction_private.assert_permission(p_company,false);
  if not (coalesce(public.has_company_permission(p_company,'receivables.view'),false) or coalesce(public.has_company_permission(p_company,'receivables.manage'),false)) then raise exception 'Sem permissão para consultar as parcelas desta empresa.';end if;
  if p_limit is null or p_offset is null or p_limit<1 or p_limit>100 or p_offset<0 or p_offset>1000000 then raise exception 'Paginação inválida.';end if;
  select count(*)::int into total from public.eobra_migration_ledger l join public.receivables r on r.id::text=l.targets->>'receivables' and r.company_id=l.company_id
    where l.company_id=p_company and l.entity='receivable' and l.disposition='canonical';
  select coalesce(jsonb_agg(to_jsonb(x) order by x.due_date,x.receivable_id),'[]'::jsonb) into result from (
    select r.id receivable_id,l.record_id source_record_id,r.description,r.due_date,r.amount::text original_amount,r.adjusted_amount::text current_amount,r.paid_amount::text paid_amount,r.status,
      pr.name project_name,u.code unit_code,p.id policy_id,p.state policy_state,p.last_error,p.last_reference_month,p.last_checked_month
    from public.eobra_migration_ledger l join public.receivables r on r.id::text=l.targets->>'receivables' and r.company_id=l.company_id
      join public.projects pr on pr.id=r.project_id and pr.company_id=r.company_id left join public.units u on u.id=r.unit_id and u.company_id=r.company_id
      left join public.receivable_correction_policies p on p.receivable_id=r.id and p.company_id=r.company_id
    where l.company_id=p_company and l.entity='receivable' and l.disposition='canonical'
    order by r.due_date,r.id limit p_limit offset p_offset
  )x;
  return jsonb_build_object('total',total,'rows',result);
end;$$;

-- Optional scheduler entry point: owner-only, unexposed schema, not scheduled.
-- A separately approved pg_cron job may call this later. No JWT impersonation.
create function finance_correction_private.refresh_due_all(p_limit integer default 500) returns jsonb language plpgsql security definer set search_path='' as $$
declare c record;result jsonb:='[]';begin
  if p_limit<1 or p_limit>1000 then raise exception 'Lote inválido.';end if;
  for c in select distinct company_id from public.receivable_correction_policies where enabled order by company_id loop
    result:=result||jsonb_build_array(jsonb_build_object('company_id',c.company_id,'result',finance_correction_private.refresh_batch(c.company_id,null,p_limit)));
  end loop;return result;
end;$$;

-- Exposed RPCs are invoker wrappers. Only their checked private entry points
-- have EXECUTE grants; internal workers/triggers remain owner-only.
create function public.preview_eobra_correction_index(p_company_id uuid,p_source_index_id uuid,p_correction_index_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select finance_correction_private.index_preview(p_company_id,p_source_index_id,p_correction_index_id)$$;
create function public.bind_eobra_correction_index(p_company_id uuid,p_source_index_id uuid,p_correction_index_id uuid,p_preview_hash text) returns uuid language sql security invoker set search_path='' as $$select finance_correction_private.bind_index(p_company_id,p_source_index_id,p_correction_index_id,p_preview_hash)$$;
create function public.preview_eobra_receivable_correction(p_company_id uuid,p_receivable_id uuid,p_source_record_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select finance_correction_private.policy_preview(p_company_id,p_receivable_id,p_source_record_id)$$;
create function public.activate_eobra_receivable_correction(p_company_id uuid,p_receivable_id uuid,p_source_record_id uuid,p_preview_hash text) returns uuid language sql security invoker set search_path='' as $$select finance_correction_private.activate(p_company_id,p_receivable_id,p_source_record_id,p_preview_hash)$$;
create function public.refresh_receivable_correction_policies(p_company_id uuid,p_correction_index_id uuid default null,p_limit integer default 500) returns jsonb language sql security invoker set search_path='' as $$select finance_correction_private.refresh_authorized(p_company_id,p_correction_index_id,p_limit)$$;
create function public.receivable_correction_overview(p_company_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select finance_correction_private.overview(p_company_id)$$;
create function public.eobra_receivable_correction_candidates(p_company_id uuid,p_limit integer default 20,p_offset integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$select finance_correction_private.candidates(p_company_id,p_limit,p_offset)$$;

revoke all on all functions in schema finance_correction_private from public,anon,authenticated;
grant execute on function finance_correction_private.index_preview(uuid,uuid,uuid),finance_correction_private.bind_index(uuid,uuid,uuid,text),finance_correction_private.policy_preview(uuid,uuid,uuid),finance_correction_private.activate(uuid,uuid,uuid,text),finance_correction_private.refresh_authorized(uuid,uuid,integer),finance_correction_private.overview(uuid),finance_correction_private.candidates(uuid,integer,integer) to authenticated;
revoke all on function public.preview_eobra_correction_index(uuid,uuid,uuid),public.bind_eobra_correction_index(uuid,uuid,uuid,text),public.preview_eobra_receivable_correction(uuid,uuid,uuid),public.activate_eobra_receivable_correction(uuid,uuid,uuid,text),public.refresh_receivable_correction_policies(uuid,uuid,integer),public.receivable_correction_overview(uuid),public.eobra_receivable_correction_candidates(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.preview_eobra_correction_index(uuid,uuid,uuid),public.bind_eobra_correction_index(uuid,uuid,uuid,text),public.preview_eobra_receivable_correction(uuid,uuid,uuid),public.activate_eobra_receivable_correction(uuid,uuid,uuid,text),public.refresh_receivable_correction_policies(uuid,uuid,integer),public.receivable_correction_overview(uuid),public.eobra_receivable_correction_candidates(uuid,integer,integer) to authenticated;

commit;
