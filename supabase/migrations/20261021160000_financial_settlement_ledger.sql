-- Etapa 7 — candidata, sem backfill nem execução produtiva.
begin;
-- A title may have many settlement transactions; legacy writers retain their guard.
drop index public.finance_bank_transactions_payable_unique_idx;
drop index public.finance_bank_transactions_receivable_unique_idx;
create unique index finance_bank_transactions_payable_unique_idx on public.finance_bank_transactions(payable_id) where payable_id is not null and status<>'cancelled' and source_system is distinct from 'elos_settlement';
create unique index finance_bank_transactions_receivable_unique_idx on public.finance_bank_transactions(receivable_id) where receivable_id is not null and status<>'cancelled' and source_system is distinct from 'elos_settlement';
create index finance_bank_transactions_title_events on public.finance_bank_transactions(company_id,payable_id,receivable_id);
create table public.finance_settlement_events (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid references public.projects(id), legal_entity_id uuid not null references public.legal_entities(id),
 title_type text not null check(title_type in('AP','AR')), command_id uuid not null, kind text not null check(kind in('payment','receipt','reversal')),
 reversal_of uuid unique references public.finance_settlement_events(id),
 bank_account_id uuid references public.finance_bank_accounts(id), bank_transaction_id uuid references public.finance_bank_transactions(id),
 effective_date date not null, cash_amount numeric(16,2) not null check(cash_amount>=0),
 refund_amount numeric(16,2) not null default 0 check(refund_amount>=0),
 request jsonb not null, reason text not null check(length(btrim(reason))>=5),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(company_id,command_id)
);
create table public.finance_settlement_lines (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 project_id uuid not null references public.projects(id), event_id uuid not null references public.finance_settlement_events(id),
 title_type text not null check(title_type in('AP','AR')), title_id uuid not null,
 principal numeric(16,2) not null default 0,interest numeric(16,2) not null default 0,discount numeric(16,2) not null default 0,
 noncash numeric(16,2) not null default 0,fee numeric(16,2) not null default 0,excess_credit numeric(16,2) not null default 0,
 advance_source uuid references public.finance_settlement_lines(id),scope_ref text,
 noncash_kind text,credit_class text,credit_evidence text,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check(least(principal,interest,discount,noncash,fee,excess_credit)>=0),unique(event_id,title_type,title_id)
);
create table public.finance_title_charges (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid not null references public.projects(id),
 title_type text not null check(title_type in('AP','AR')),title_id uuid not null,command_id uuid not null,
 amount numeric(16,2) not null check(amount>0),effective_date date not null,reason text not null check(length(btrim(reason))>=5),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),unique(company_id,command_id)
);
alter table public.payables
 add column finance_managed boolean not null default false,
 add column finance_principal_paid numeric(16,2) not null default 0,
 add column finance_interest_due numeric(16,2) not null default 0,
 add column finance_interest_paid numeric(16,2) not null default 0,
 add column finance_discount numeric(16,2) not null default 0,
 add column finance_noncash numeric(16,2) not null default 0,
 add column finance_advance_applied numeric(16,2) not null default 0,
 add column finance_cash_gross numeric(16,2) not null default 0,
 add column finance_cash_refunded numeric(16,2) not null default 0,
 add column finance_cash_pending numeric(16,2) not null default 0,
 add column finance_open_amount numeric(16,2) generated always as (
  case when status='cancelled' then 0 when not finance_managed then case when status='paid' then 0 else amount end
  else amount-finance_principal_paid-finance_discount-finance_noncash+finance_interest_due-finance_interest_paid end
 ) stored,
 add constraint payables_settlement_nonnegative check(not finance_managed or (amount-finance_principal_paid-finance_discount-finance_noncash>=0 and finance_interest_due-finance_interest_paid>=0));
alter table public.receivables
 add column finance_managed boolean not null default false,
 add column finance_principal_paid numeric(16,2) not null default 0,
 add column finance_interest_due numeric(16,2) not null default 0,
 add column finance_interest_paid numeric(16,2) not null default 0,
 add column finance_discount numeric(16,2) not null default 0,
 add column finance_noncash numeric(16,2) not null default 0,
 add column finance_advance_applied numeric(16,2) not null default 0,
 add column finance_cash_gross numeric(16,2) not null default 0,
 add column finance_cash_refunded numeric(16,2) not null default 0,
 add column finance_cash_pending numeric(16,2) not null default 0,
 add column finance_open_amount numeric(16,2) generated always as (
  case when status='cancelled' then 0 when not finance_managed then case when status='paid' then 0 else coalesce(adjusted_amount,amount) end
  else coalesce(adjusted_amount,amount)-finance_principal_paid-finance_discount-finance_noncash+finance_interest_due-finance_interest_paid end
 ) stored,
 add constraint receivables_settlement_nonnegative check(not finance_managed or (coalesce(adjusted_amount,amount)-finance_principal_paid-finance_discount-finance_noncash>=0 and finance_interest_due-finance_interest_paid>=0));

-- Immutable evidence. RLS is applied to each business table, including lines.
do $$declare t text;begin
 foreach t in array array['finance_settlement_events','finance_settlement_lines','finance_title_charges'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  if t='finance_settlement_events' then
   execute format('create policy settlement_read on public.%I for select to authenticated using(public.finance_entity_scope(company_id,legal_entity_id,false) and public.has_company_permission(company_id,case title_type when ''AP'' then ''payables.view'' else ''receivables.view'' end))',t);
  else
   execute format('create policy settlement_read on public.%I for select to authenticated using(public.finance_entity_scope(company_id,(select legal_entity_id from public.projects where id=project_id),false) and public.has_company_permission(company_id,case title_type when ''AP'' then ''payables.view'' else ''receivables.view'' end))',t);
  end if;
  execute format('create trigger settlement_immutable before update or delete on public.%I for each row execute function finance_private.immutable_audit()',t);
 end loop;
end $$;
-- Exact-cent allocation of grouped refunds. No per-line independent rounding.
create view public.finance_settlement_cash_rows with(security_invoker=true) as
 with refunds as (
  select e.id as event_id,e.company_id,l.project_id,l.title_type,l.title_id,e.effective_date,e.created_at,
   e.refund_amount*100 as total_cents,
   coalesce(e.refund_amount*100*(l.principal+l.interest-l.fee+l.excess_credit)/nullif(o.cash_amount,0),0) as raw_cents
  from public.finance_settlement_events e join public.finance_settlement_events o on o.id=e.reversal_of
  join public.finance_settlement_lines l on l.event_id=o.id where e.kind='reversal'
 ), ranked as (
  select *,floor(raw_cents) as base_cents,sum(floor(raw_cents)) over(partition by event_id) as used_cents,
   row_number() over(partition by event_id order by raw_cents-floor(raw_cents) desc,title_id) as residual_rank from refunds
 )
 select e.id as event_id,e.company_id,l.project_id,l.title_type,l.title_id,e.effective_date,e.created_at,
  l.principal+l.interest-l.fee+l.excess_credit as cash_signed,'settlement'::text as cash_kind
 from public.finance_settlement_events e join public.finance_settlement_lines l on l.event_id=e.id where e.kind<>'reversal'
 union all select event_id,company_id,project_id,title_type,title_id,effective_date,created_at,
  -(base_cents+case when residual_rank<=total_cents-used_cents then 1 else 0 end)/100,'refund'::text from ranked;
grant select on public.finance_settlement_cash_rows to authenticated;

create function finance_private.title(p_company uuid,p_type text,p_title uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t jsonb; entity uuid;begin
 if p_type not in('AP','AR') then raise exception 'Tipo financeiro inválido.';end if;
 if not coalesce(public.has_company_permission(p_company,case p_type when 'AP' then 'payables.manage' else 'receivables.manage' end),false) then raise exception 'Sem permissão financeira.';end if;
 execute format('select to_jsonb(t) from public.%I t where id=$1 and company_id=$2 for update',case p_type when 'AP' then 'payables' else 'receivables' end) into t using p_title,p_company;
 select legal_entity_id into entity from public.projects where id=(t->>'project_id')::uuid;
 if t is null or not public.finance_entity_scope(p_company,entity,true) then raise exception 'Título indisponível ou sem autorização.';end if;
 return t;
end $$;
create function finance_private.require_clean_open(t jsonb) returns void language plpgsql set search_path='' as $$begin
 if exists(select 1 from elos_import.financial_objects f where f.target_id=(t->>'id')::uuid and f.pending&&array['declared_settlement_requires_ledger','reversal_requires_original_and_ledger','unknown_settlement']) then raise exception 'Baixa declarada da origem em apuração; impedir pagamento duplicado.';end if;
 if t->>'status'<>'open' then raise exception 'Título não disponível para liquidação.';end if;
 if not (t->>'finance_managed')::boolean and ((t->>'paid_amount')::numeric>0 or t->>'bank_transaction_id' is not null) then raise exception 'Baixa histórica exige reconciliação de abertura, sem sobrescrita.';end if;
end $$;
create function finance_private.refresh_title(p_company uuid,p_type text,p_title uuid,p_reason text,p_date date) returns void
language plpgsql security definer set search_path='' as $$
declare principal numeric;interest numeric;discount numeric;noncash numeric;gross numeric;refunded numeric;pending_cash numeric;advance_amount numeric;charges numeric;tx uuid;paid_day date;base numeric;account uuid;account_name text;begin
 select coalesce(sum(l.principal*case e.kind when 'reversal' then -1 else 1 end),0),
 coalesce(sum(l.interest*case e.kind when 'reversal' then -1 else 1 end),0),
 coalesce(sum(l.discount*case e.kind when 'reversal' then -1 else 1 end),0),
 coalesce(sum(l.noncash*case e.kind when 'reversal' then -1 else 1 end),0),
 coalesce(sum(l.principal+l.interest-l.fee+l.excess_credit) filter(where e.kind<>'reversal'),0),
 max(e.effective_date) filter(where e.kind<>'reversal')
 into principal,interest,discount,noncash,gross,paid_day
 from public.finance_settlement_lines l join public.finance_settlement_events e on e.id=l.event_id
 where l.title_type=p_type and l.title_id=p_title and l.company_id=p_company;
 select coalesce(-sum(cash_signed) filter(where cash_kind='refund'),0) into refunded from public.finance_settlement_cash_rows
 where company_id=p_company and title_type=p_type and title_id=p_title;
 select coalesce(sum(l.principal+l.interest-l.fee+l.excess_credit),0)-refunded into pending_cash
 from public.finance_settlement_lines l where l.company_id=p_company and l.title_type=p_type and l.title_id=p_title
 and exists(select 1 from public.finance_settlement_events r where r.reversal_of=l.event_id);
 select coalesce(sum(l.noncash*case e.kind when 'reversal' then -1 else 1 end),0) into advance_amount from public.finance_settlement_lines l join public.finance_settlement_events e on e.id=l.event_id where l.title_type=p_type and l.title_id=p_title and l.noncash_kind='advance_application';
 select coalesce(sum(amount),0) into charges from public.finance_title_charges where company_id=p_company and title_type=p_type and title_id=p_title;
 select e.bank_transaction_id,e.bank_account_id,a.label into tx,account,account_name from public.finance_settlement_events e left join public.finance_bank_accounts a on a.id=e.bank_account_id join public.finance_settlement_lines l on l.event_id=e.id
 where l.title_type=p_type and l.title_id=p_title and e.kind<>'reversal' and e.company_id=p_company order by e.created_at desc limit 1;
 perform set_config('finance.reason',p_reason,true);perform set_config('finance.effective_date',p_date::text,true);
 execute format('update public.%I set finance_managed=true,finance_principal_paid=$1,finance_interest_paid=$2,finance_discount=$3,finance_noncash=$4,finance_cash_gross=$5,finance_cash_refunded=$6,finance_cash_pending=$7,finance_interest_due=$8,finance_advance_applied=$13,bank_account_id=$14,paid_account_name=$15,paid_amount=$5-$6,paid_at=$9,bank_transaction_id=$10,status=case when %s-$1-$3-$4+$8-$2=0 then ''paid'' else ''open'' end,updated_at=clock_timestamp() where id=$11 and company_id=$12',
 case p_type when 'AP' then 'payables' else 'receivables' end,case p_type when 'AP' then 'amount' else 'coalesce(adjusted_amount,amount)' end)
 using principal,interest,discount,noncash,gross,round(refunded,2),round(pending_cash,2),charges,paid_day,tx,p_title,p_company,advance_amount,account,account_name;
 if p_type='AR' and principal+interest+discount+noncash>0 then update public.receivables set correction_locked=true where id=p_title;end if;
end $$;
create function public.settle_finance_titles(p_company uuid,p_command uuid,p_account uuid,p_date date,p_lines jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cached public.finance_settlement_events;t jsonb;l jsonb;req jsonb;entity uuid;project uuid;kind text;first_type text; first_entity uuid;
 a public.finance_bank_accounts;event uuid;tx uuid;cash numeric:=0;line_cash numeric;pr numeric;it numeric;di numeric;nc numeric;fee numeric;cr numeric;v numeric;field text;credit public.finance_settlement_lines;origin jsonb;available numeric;begin
 if p_date>(clock_timestamp() at time zone 'America/Sao_Paulo')::date then raise exception 'Agendamento não é liquidação executada.';end if;
 if auth.uid() is null or p_command is null or p_date is null or length(btrim(coalesce(p_reason,'')))<5 or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)=0 then raise exception 'Liquidação exige comando, data, linhas e motivo.';end if;
 -- Lock namespace is shared with reversals/charges to prevent command reuse.
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,716));
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_command::text,7));
 req:=jsonb_build_object('account',p_account,'date',p_date,'lines',p_lines,'reason',p_reason);
 select * into cached from public.finance_settlement_events where company_id=p_company and command_id=p_command;
 for l in select value from jsonb_array_elements(p_lines) order by value->>'type',value->>'title_id' loop
  if exists(select 1 from jsonb_object_keys(l) k where k not in('type','title_id','principal','interest','discount','noncash','fee','excess_credit','noncash_kind','credit_class','evidence','scope_ref','credit_line_id')) then raise exception 'Componente não implementado exige pendência explícita.';end if;
  t:=finance_private.title(p_company,l->>'type',(l->>'title_id')::uuid);
  if cached.id is not null then continue;end if;
  perform finance_private.require_clean_open(t);
  select legal_entity_id into entity from public.projects where id=(t->>'project_id')::uuid;
  if first_type is null then first_type:=l->>'type';first_entity:=entity;project:=(t->>'project_id')::uuid;end if;
  if entity is distinct from first_entity then raise exception 'Entidades distintas não podem compartilhar liquidação.';end if;
  if first_type<>l->>'type' then raise exception 'Não misturar pagar e receber no mesmo evento.';end if;
  foreach field in array array['principal','interest','discount','noncash','fee','excess_credit'] loop
   if l ? field and jsonb_typeof(l->field)<>'number' then raise exception 'Componente desconhecido ou tipo inválido.';end if;
   v:=coalesce((l->>field)::numeric,0);
   if v='NaN'::numeric or v<0 or v<>round(v,2) then raise exception 'Componente financeiro exige valor exato não negativo.';end if;
  end loop;
  pr:=coalesce((l->>'principal')::numeric,0);it:=coalesce((l->>'interest')::numeric,0);di:=coalesce((l->>'discount')::numeric,0);nc:=coalesce((l->>'noncash')::numeric,0);fee:=coalesce((l->>'fee')::numeric,0);cr:=coalesce((l->>'excess_credit')::numeric,0);
  v:=case l->>'type' when 'AP' then (t->>'amount')::numeric else coalesce((t->>'adjusted_amount')::numeric,(t->>'amount')::numeric) end;
  if pr+di+nc>v-(t->>'finance_principal_paid')::numeric-(t->>'finance_discount')::numeric-(t->>'finance_noncash')::numeric or it>(t->>'finance_interest_due')::numeric-(t->>'finance_interest_paid')::numeric then raise exception 'Liquidação superior ao saldo do componente.';end if;
  if pr+it+di+nc+cr=0 or fee>pr or (first_type='AP' and fee<>0) then raise exception 'Composição financeira inválida.';end if;
  if (di>0 or nc>0 or fee>0 or cr>0) and nullif(btrim(l->>'evidence'),'') is null then raise exception 'Componente sem caixa/excedente exige documento.';end if;
  if nc>0 and (l->>'noncash_kind' is null or l->>'noncash_kind' not in('barter','documented_credit','advance_application')) then raise exception 'Aplicação de adiantamento exige vínculo próprio; não compensar crédito genérico.';end if;
  if cr>0 and (l->>'credit_class' is null or l->>'credit_class' not in('refund_receivable','supplier_advance','customer_advance')) then raise exception 'Excedente exige classificação identificada.';end if;
  if l->>'credit_class' is not null and nullif(btrim(l->>'evidence'),'') is null then raise exception 'Crédito exige evidência.';end if;
  if l->>'credit_class'='supplier_advance' and first_type<>'AP' or l->>'credit_class'='customer_advance' and first_type<>'AR' then raise exception 'Direção de adiantamento incompatível.';end if;
  if l->>'credit_class' in('supplier_advance','customer_advance') and nullif(btrim(l->>'scope_ref'),'') is null then raise exception 'Adiantamento exige escopo documental.';end if;
  if l->>'noncash_kind'='advance_application' then
   select * into credit from public.finance_settlement_lines where id=(l->>'credit_line_id')::uuid and company_id=p_company for update;
   if credit.id is null or credit.credit_class<>(case first_type when 'AP' then 'supplier_advance' else 'customer_advance' end) or credit.scope_ref is distinct from nullif(l->>'scope_ref','') then raise exception 'Crédito de adiantamento/escopo incompatível.';end if;
   origin:=finance_private.title(p_company,credit.title_type,credit.title_id);
   if (select legal_entity_id from public.projects where id=(origin->>'project_id')::uuid) is distinct from entity then raise exception 'Adiantamento de outra entidade.';end if;
   if first_type='AP' and origin->>'supplier_id' is null or first_type='AR' and origin->>'client_id' is null then raise exception 'Adiantamento sem contraparte identificada.';end if;
   if first_type='AP' and origin->>'supplier_id' is distinct from t->>'supplier_id' or first_type='AR' and origin->>'client_id' is distinct from t->>'client_id' then raise exception 'Contraparte do adiantamento incompatível.';end if;
   if exists(select 1 from public.finance_settlement_events where reversal_of=credit.event_id) then raise exception 'Crédito de origem estornado.';end if;
   select credit.principal+credit.excess_credit-coalesce(sum(x.noncash*case e.kind when 'reversal' then -1 else 1 end),0) into available
   from public.finance_settlement_lines x join public.finance_settlement_events e on e.id=x.event_id where x.advance_source=credit.id;
   if nc>available then raise exception 'Aplicação superior ao crédito disponível.';end if;
  end if;
  line_cash:=pr+it-fee+cr;cash:=cash+line_cash;
 end loop;
 if cached.id is not null then
  if cached.request<>req then raise exception 'Comando reutilizado com conteúdo diferente.';end if;
  return jsonb_build_object('event_id',cached.id,'bank_transaction_id',cached.bank_transaction_id,'replayed',true);
 end if;
 if exists(select 1 from public.finance_title_charges where company_id=p_company and command_id=p_command) then raise exception 'Comando reutilizado.';end if;
 if exists(select 1 from jsonb_array_elements(p_lines) x group by x->>'type',x->>'title_id' having count(*)>1) then raise exception 'Título repetido no mesmo evento.';end if;
 if p_account is not null then
  a:=finance_private.account(p_account,'finance.bank_accounts.view');
  if a.company_id<>p_company or not public.finance_entity_scope(p_company,a.legal_entity_id,true) then raise exception 'Conta fora da organização ou entidade autorizada.';end if;
 end if;
 for l in select value from jsonb_array_elements(p_lines) loop
  t:=finance_private.title(p_company,l->>'type',(l->>'title_id')::uuid);
  select legal_entity_id into entity from public.projects where id=(t->>'project_id')::uuid;
  if p_account is not null and entity is distinct from a.legal_entity_id then raise exception 'Conta pertence a outra entidade.';end if;
  if (t->>'project_id')::uuid is distinct from project then project:=null;end if;
 end loop;
 if entity is null then raise exception 'Entidade financeira não identificada.';end if;
 if cash>0 and first_type='AP' and not a.allow_negative and public.finance_bank_account_balance(a.id,p_date)<cash then raise exception 'Saldo insuficiente.';end if;
 event:=gen_random_uuid();
 if cash>0 and p_account is null then raise exception 'Caixa exige conta identificada.';end if;
 if cash>0 then
  insert into public.finance_bank_transactions(company_id,project_id,legal_entity_id,bank_account_id,transaction_date,direction,transaction_type,description,amount,status,
   payable_id,receivable_id,source_system,source_id,created_by)
  values(p_company,project,entity,p_account,p_date,case first_type when 'AP' then 'debit' else 'credit' end,case first_type when 'AP' then 'payment' else 'receipt' end,p_reason,cash,'posted',
   case when first_type='AP' and jsonb_array_length(p_lines)=1 then (p_lines->0->>'title_id')::uuid end,
   case when first_type='AR' and jsonb_array_length(p_lines)=1 then (p_lines->0->>'title_id')::uuid end,'elos_settlement',p_command::text,auth.uid()) returning id into tx;
 end if;
 insert into public.finance_settlement_events(id,company_id,project_id,legal_entity_id,title_type,command_id,kind,bank_account_id,bank_transaction_id,effective_date,cash_amount,request,reason,created_by)
 values(event,p_company,project,entity,first_type,p_command,case first_type when 'AP' then 'payment' else 'receipt' end,p_account,tx,p_date,cash,req,p_reason,auth.uid());
 for l in select value from jsonb_array_elements(p_lines) loop
  t:=finance_private.title(p_company,l->>'type',(l->>'title_id')::uuid);
  insert into public.finance_settlement_lines(company_id,project_id,event_id,title_type,title_id,principal,interest,discount,noncash,fee,excess_credit,advance_source,scope_ref,noncash_kind,credit_class,credit_evidence,created_by)
  values(p_company,(t->>'project_id')::uuid,event,l->>'type',(l->>'title_id')::uuid,coalesce((l->>'principal')::numeric,0),coalesce((l->>'interest')::numeric,0),coalesce((l->>'discount')::numeric,0),coalesce((l->>'noncash')::numeric,0),coalesce((l->>'fee')::numeric,0),coalesce((l->>'excess_credit')::numeric,0),(l->>'credit_line_id')::uuid,l->>'scope_ref',l->>'noncash_kind',l->>'credit_class',l->>'evidence',auth.uid());
  perform finance_private.refresh_title(p_company,l->>'type',(l->>'title_id')::uuid,p_reason,p_date);
 end loop;
 return jsonb_build_object('event_id',event,'bank_transaction_id',tx,'replayed',false);
end $$;
create function public.add_finance_title_interest(p_company uuid,p_type text,p_title uuid,p_command uuid,p_amount numeric,p_date date,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare t jsonb;c public.finance_title_charges;id uuid;begin
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,716));
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_command::text,7));
 t:=finance_private.title(p_company,p_type,p_title);
 if p_command is null or p_date is null or p_amount is null or p_amount='NaN'::numeric or p_amount<=0 or p_amount<>round(p_amount,2) or length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Encargo exige valor exato, data, comando e motivo.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,716));
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_command::text,7));
 select * into c from public.finance_title_charges where company_id=p_company and command_id=p_command;
 if c.id is not null then
  if c.title_id<>p_title or c.title_type<>p_type or c.amount<>p_amount or c.effective_date<>p_date or c.reason<>p_reason then raise exception 'Comando reutilizado.';end if;return c.id;
 end if;
 if exists(select 1 from public.finance_settlement_events where company_id=p_company and command_id=p_command) then raise exception 'Comando reutilizado.';end if;
 perform finance_private.require_clean_open(t);
 insert into public.finance_title_charges(company_id,project_id,title_type,title_id,command_id,amount,effective_date,reason,created_by)
 values(p_company,(t->>'project_id')::uuid,p_type,p_title,p_command,p_amount,p_date,p_reason,auth.uid()) returning finance_title_charges.id into id;
 perform finance_private.refresh_title(p_company,p_type,p_title,p_reason,p_date);return id;
end $$;

create function public.reverse_finance_settlement(p_company uuid,p_event uuid,p_command uuid,p_date date,p_reason text,p_keep_discount boolean,p_confirmed_refund numeric default 0,p_evidence text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.finance_settlement_events;cached public.finance_settlement_events;l public.finance_settlement_lines;req jsonb;t jsonb;rev uuid;tx uuid;a public.finance_bank_accounts;begin
 if auth.uid() is null or p_command is null or p_date is null or p_keep_discount is null or length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Estorno exige comando, data, motivo e condição de desconto.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,716));
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_command::text,7));
 -- Same title lock order as settlement.
 select * into e from public.finance_settlement_events where id=p_event and company_id=p_company;
 if e.id is null or e.kind='reversal' then raise exception 'Evento original indisponível.';end if;
 for l in select * from public.finance_settlement_lines where event_id=e.id order by title_type,title_id loop
  t:=finance_private.title(p_company,l.title_type,l.title_id);
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,716));
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_command::text,7));
 req:=jsonb_build_object('event',p_event,'date',p_date,'reason',p_reason,'keep_discount',p_keep_discount,'refund',p_confirmed_refund,'evidence',p_evidence);
 select * into cached from public.finance_settlement_events where company_id=p_company and command_id=p_command;
 if cached.id is not null then
  if cached.request<>req then raise exception 'Comando reutilizado com conteúdo diferente.';end if;
  return jsonb_build_object('event_id',cached.id,'bank_transaction_id',cached.bank_transaction_id,'replayed',true);
 end if;
 if exists(select 1 from public.finance_settlement_events where reversal_of=p_event) then raise exception 'Evento já estornado.';end if;
 if p_date<e.effective_date or p_date>(clock_timestamp() at time zone 'America/Sao_Paulo')::date then raise exception 'Data de reversão incompatível.';end if;
 if p_confirmed_refund is null or p_confirmed_refund<0 or p_confirmed_refund<>round(p_confirmed_refund,2) or p_confirmed_refund>e.cash_amount then raise exception 'Devolução deve ser explícita e não exceder o caixa original.';end if;
 if p_confirmed_refund>0 and nullif(btrim(p_evidence),'') is null then raise exception 'Devolução exige evidência bancária.';end if;
 if exists(select 1 from public.finance_settlement_lines source join public.finance_settlement_lines applied on applied.advance_source=source.id join public.finance_settlement_events ae on ae.id=applied.event_id where source.event_id=e.id and ae.kind<>'reversal' and not exists(select 1 from public.finance_settlement_events re where re.reversal_of=ae.id)) then raise exception 'Estorne as aplicações antes do crédito de origem.';end if;
 if e.bank_account_id is not null then
  a:=finance_private.account(e.bank_account_id,'finance.bank_accounts.view');
  if e.effective_date<=a.closed_through or p_date<=a.closed_through then raise exception 'Período bancário encerrado.';end if;
 end if;
 if p_confirmed_refund>0 and e.kind='receipt' and not a.allow_negative and public.finance_bank_account_balance(a.id,p_date)<p_confirmed_refund then raise exception 'Saldo insuficiente para devolução.';end if;
 if p_confirmed_refund>0 then
  insert into public.finance_bank_transactions(company_id,project_id,legal_entity_id,bank_account_id,transaction_date,direction,transaction_type,description,amount,status,source_system,source_id,created_by)
  values(p_company,e.project_id,e.legal_entity_id,e.bank_account_id,p_date,case e.kind when 'payment' then 'credit' else 'debit' end,'refund',p_reason,p_confirmed_refund,'posted','elos_settlement',p_command::text,auth.uid()) returning id into tx;
 end if;
 insert into public.finance_settlement_events(company_id,project_id,legal_entity_id,title_type,command_id,kind,reversal_of,bank_account_id,bank_transaction_id,effective_date,cash_amount,refund_amount,request,reason,created_by)
 values(p_company,e.project_id,e.legal_entity_id,e.title_type,p_command,'reversal',e.id,e.bank_account_id,tx,p_date,0,p_confirmed_refund,req,p_reason,auth.uid()) returning id into rev;
 for l in select * from public.finance_settlement_lines where event_id=e.id order by title_type,title_id loop
  insert into public.finance_settlement_lines(company_id,project_id,event_id,title_type,title_id,principal,interest,discount,noncash,fee,excess_credit,advance_source,scope_ref,noncash_kind,credit_class,credit_evidence,created_by)
  values(p_company,l.project_id,rev,l.title_type,l.title_id,l.principal,l.interest,case when p_keep_discount then 0 else l.discount end,l.noncash,l.fee,l.excess_credit,l.advance_source,l.scope_ref,l.noncash_kind,l.credit_class,p_evidence,auth.uid());
  perform finance_private.refresh_title(p_company,l.title_type,l.title_id,p_reason,p_date);
 end loop;
 return jsonb_build_object('event_id',rev,'bank_transaction_id',tx,'replayed',false);
end $$;

-- Legacy signature is preserved. Callers with a true command use the N:M RPC.
-- A repeated legacy tuple is rejected rather than inventing a second payment.
create or replace function public.pay_finance_payable(p_company_id uuid,p_project_id uuid,p_payable_id uuid,p_account_id uuid,p_paid_at date,p_paid_amount numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare t jsonb;r jsonb;cmd uuid;begin
 cmd:=md5(jsonb_build_array('legacy-AP',p_company_id,p_payable_id,p_account_id,p_paid_at,p_paid_amount)::text)::uuid;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,716));
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||cmd::text,7));
 t:=finance_private.title(p_company_id,'AP',p_payable_id);
 if (t->>'project_id')::uuid is distinct from p_project_id then raise exception 'Obra incompatível.';end if;
 r:=public.settle_finance_titles(p_company_id,cmd,p_account_id,p_paid_at,jsonb_build_array(jsonb_build_object('type','AP','title_id',p_payable_id,'principal',p_paid_amount)),'Pagamento registrado pela operação financeira');
 if (r->>'replayed')::boolean then raise exception 'Operação já processada; use o comando original para replay.';end if;
 return (r->>'bank_transaction_id')::uuid;
end $$;
create or replace function public.receive_finance_receivable(p_company_id uuid,p_project_id uuid,p_receivable_id uuid,p_account_id uuid,p_paid_at date,p_paid_amount numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare t jsonb;r jsonb;cmd uuid;begin
 cmd:=md5(jsonb_build_array('legacy-AR',p_company_id,p_receivable_id,p_account_id,p_paid_at,p_paid_amount)::text)::uuid;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,716));
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||cmd::text,7));
 t:=finance_private.title(p_company_id,'AR',p_receivable_id);
 if (t->>'project_id')::uuid is distinct from p_project_id then raise exception 'Obra incompatível.';end if;
 r:=public.settle_finance_titles(p_company_id,cmd,p_account_id,p_paid_at,jsonb_build_array(jsonb_build_object('type','AR','title_id',p_receivable_id,'principal',p_paid_amount)),'Recebimento registrado pela operação financeira');
 if (r->>'replayed')::boolean then raise exception 'Operação já processada; use o comando original para replay.';end if;
 return (r->>'bank_transaction_id')::uuid;
end $$;

create function finance_private.protect_title_settlement() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' then
  if old.finance_managed then raise exception 'Título com liquidação possui histórico; não excluir.';end if;return old;
 end if;
 if tg_op='INSERT' and current_user in('authenticated','anon') and (new.finance_managed or new.status='paid' or
  new.finance_principal_paid<>0 or new.finance_interest_due<>0 or new.finance_interest_paid<>0 or new.finance_discount<>0 or new.finance_noncash<>0 or new.finance_advance_applied<>0 or new.finance_cash_gross<>0 or new.finance_cash_refunded<>0 or new.finance_cash_pending<>0)
 then raise exception 'Use a operação de liquidação.';end if;
 if tg_op='UPDATE' then
  if current_user in('authenticated','anon') and new.status='paid' and old.status<>'paid' then raise exception 'Use a operação de liquidação.';end if;
  if current_user in('authenticated','anon') and (
   (select jsonb_object_agg(k,v) from jsonb_each(to_jsonb(new)) x(k,v) where k like 'finance_%' and k<>'finance_open_amount') is distinct from
   (select jsonb_object_agg(k,v) from jsonb_each(to_jsonb(old)) x(k,v) where k like 'finance_%' and k<>'finance_open_amount')
   or (old.finance_managed and (new.paid_amount is distinct from old.paid_amount or new.paid_at is distinct from old.paid_at or new.status is distinct from old.status or new.bank_account_id is distinct from old.bank_account_id or new.bank_transaction_id is distinct from old.bank_transaction_id or new.paid_account_name is distinct from old.paid_account_name)))
  then raise exception 'Use operação financeira com autoria e motivo.';end if;
  if old.finance_managed and (new.amount is distinct from old.amount or new.project_id is distinct from old.project_id or new.company_id is distinct from old.company_id) then raise exception 'Revisão de título com liquidação exige revisão de componentes.';end if;
  if old.finance_managed and new.status='cancelled' then raise exception 'Cancelamento com liquidação exige consequência econômica documentada.';end if;
 end if;return new;
end $$;
create trigger title_settlement_guard before insert or update or delete on public.payables for each row execute function finance_private.protect_title_settlement();
create trigger title_settlement_guard before insert or update or delete on public.receivables for each row execute function finance_private.protect_title_settlement();

create or replace function public.payables_summary(p_company_id uuid,p_project_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;begin
 if not (public.has_company_permission(p_company_id,'payables.view') or public.has_company_permission(p_company_id,'payables.manage')) then raise exception 'Sem permissão.';end if;
 select jsonb_build_object('total_count',count(*),'open_count',count(*) filter(where status='open'),'paid_count',count(*) filter(where status='paid'),'cancelled_count',count(*) filter(where status='cancelled'),
 'total_amount',coalesce(sum(amount) filter(where status<>'cancelled'),0),'open_amount',coalesce(sum(finance_open_amount),0),
 'paid_amount',coalesce(sum(case when finance_managed then finance_cash_gross-finance_cash_refunded when status='paid' then coalesce(paid_amount,amount) else 0 end),0)) into result
 from public.payables where company_id=p_company_id and (p_project_id is null or project_id=p_project_id);return result;
end $$;
create or replace function public.receivables_summary(p_company_id uuid,p_project_id uuid default null,p_sale_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r jsonb;begin
 if not(public.has_company_permission(p_company_id,'receivables.view') or public.has_company_permission(p_company_id,'receivables.manage')) then raise exception 'Sem permissão.';end if;
 select jsonb_build_object('total_count',count(*),'open_count',count(*) filter(where status='open'),'paid_count',count(*) filter(where status='paid'),
 'overdue_count',count(*) filter(where status='open' and due_date<current_date),'base_amount',coalesce(sum(amount) filter(where status<>'cancelled'),0),
 'updated_amount',coalesce(sum(coalesce(adjusted_amount,amount)) filter(where status<>'cancelled'),0),
 'correction_amount',coalesce(sum(coalesce(adjusted_amount,amount)-amount) filter(where status<>'cancelled'),0),
 'open_amount',coalesce(sum(finance_open_amount),0),'paid_amount',coalesce(sum(case when finance_managed then finance_cash_gross-finance_cash_refunded when status='paid' then coalesce(paid_amount,adjusted_amount,amount) else 0 end),0),
 'open_correction_amount',coalesce(sum(coalesce(adjusted_amount,amount)-amount) filter(where status='open'),0)) into r
 from public.receivables where company_id=p_company_id and (p_project_id is null or project_id=p_project_id) and (p_sale_id is null or sale_id=p_sale_id);
 return r||jsonb_build_object('active_sales',(select count(*) from public.sales s join public.projects p on p.id=s.project_id where s.company_id=p_company_id and s.status='active' and (p_project_id is null or s.project_id=p_project_id) and (p_sale_id is null or s.id=p_sale_id) and public.finance_entity_scope(s.company_id,p.legal_entity_id,false)),
 'registered_sale_amount',(select coalesce(sum(s.total_amount),0) from public.sales s join public.projects p on p.id=s.project_id where s.company_id=p_company_id and s.status='active' and (p_project_id is null or s.project_id=p_project_id) and (p_sale_id is null or s.id=p_sale_id) and public.finance_entity_scope(s.company_id,p.legal_entity_id,false)));
end $$;
revoke all on function finance_private.title(uuid,text,uuid),finance_private.require_clean_open(jsonb),finance_private.refresh_title(uuid,text,uuid,text,date),finance_private.protect_title_settlement() from public,anon,authenticated;
revoke all on function public.settle_finance_titles(uuid,uuid,uuid,date,jsonb,text),public.add_finance_title_interest(uuid,text,uuid,uuid,numeric,date,text),public.reverse_finance_settlement(uuid,uuid,uuid,date,text,boolean,numeric,text) from public,anon;
grant execute on function public.settle_finance_titles(uuid,uuid,uuid,date,jsonb,text),public.add_finance_title_interest(uuid,text,uuid,uuid,numeric,date,text),public.reverse_finance_settlement(uuid,uuid,uuid,date,text,boolean,numeric,text) to authenticated;
revoke all on function public.pay_finance_payable(uuid,uuid,uuid,uuid,date,numeric),public.receive_finance_receivable(uuid,uuid,uuid,uuid,date,numeric) from public,anon;
commit;
