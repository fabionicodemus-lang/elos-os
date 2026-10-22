-- Candidate only: verified obligations can be paid by entity while appropriation remains pending.
-- No backfill, import automation, or change to AR sale/work identity.
begin;
alter table public.payables add column legal_entity_id uuid;
alter table public.payables add constraint payable_entity_fk foreign key(company_id,legal_entity_id) references public.legal_entities(company_id,id);
alter table public.payables alter column project_id drop not null;
alter table public.payables add constraint payable_identified_owner check(project_id is not null or legal_entity_id is not null);
alter table public.finance_settlement_lines alter column project_id drop not null;
alter table public.finance_title_charges alter column project_id drop not null;
create table public.finance_obligation_validations (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid references public.projects(id),legal_entity_id uuid not null,object_id uuid not null references elos_import.financial_objects(id),
 title_id uuid not null references public.payables(id),command_id uuid not null,source_version bigint not null,
 competence_date date,economic_amount numeric(16,2) check(economic_amount>=0),check((economic_amount is null and competence_date is null) or (economic_amount is not null and competence_date is not null)),evidence text not null,reason text not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,legal_entity_id) references public.legal_entities(company_id,id), unique(company_id,command_id),unique(object_id),unique(title_id)
);
alter table public.finance_obligation_validations enable row level security;
revoke all on public.finance_obligation_validations from public,anon,authenticated;
grant select on public.finance_obligation_validations to authenticated;
create policy read_validated_obligations on public.finance_obligation_validations for select to authenticated using(public.has_company_permission(company_id,'payables.view') and public.finance_entity_scope(company_id,legal_entity_id,false));
create trigger obligation_validation_immutable before update or delete on public.finance_obligation_validations for each row execute function finance_private.immutable_audit();
create or replace function finance_private.check_title_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare entity uuid; prior_entity uuid; begin
 if tg_table_name='payables' and new.project_id is null then
   entity:=(to_jsonb(new)->>'legal_entity_id')::uuid;
   if entity is null or not exists(select 1 from public.legal_entities where id=entity and company_id=new.company_id) then raise exception 'Entidade comprovada obrigatória.';end if;
   if session_user<>'postgres' and current_user in('authenticated','anon') then raise exception 'Obrigação sem obra exige validação explícita.';end if;
 else
   select legal_entity_id into entity from public.projects where id=new.project_id and company_id=new.company_id;
   if not found then raise exception 'Obra fora da organização.';end if;
   if tg_table_name='payables' and (to_jsonb(new)->>'legal_entity_id') is not null and (to_jsonb(new)->>'legal_entity_id')::uuid<>entity then raise exception 'Entidade incompatível com obra.';end if;
 end if;
 if tg_table_name='payables' then
   if new.supplier_id is not null and not exists(select 1 from public.suppliers where id=new.supplier_id and company_id=new.company_id)
   then raise exception 'Fornecedor fora da organização.'; end if;
 else
   if not exists(select 1 from public.sales where id=new.sale_id and company_id=new.company_id and project_id=new.project_id and client_id=new.client_id and unit_id=new.unit_id)
   then raise exception 'Venda, cliente ou unidade incompatíveis.'; end if;
 end if;
 if tg_op='UPDATE' and (new.company_id is distinct from old.company_id or new.source_system is distinct from old.source_system or new.source_id is distinct from old.source_id)
 then raise exception 'Identidade de origem imutável; requer reconciliação explícita.'; end if;
 if tg_op='UPDATE' and tg_table_name='payables' and (to_jsonb(new)->>'legal_entity_id') is distinct from (to_jsonb(old)->>'legal_entity_id') then raise exception 'Titular jurídico imutável; requer revisão documentada.';end if;
 if tg_op='UPDATE' and new.created_by is distinct from old.created_by then raise exception 'Autoria de origem imutável.'; end if;
 if tg_op='INSERT' and auth.uid() is not null then new.created_by:=auth.uid(); end if;
 if exists(select 1 from public.finance_company_controls where company_id=new.company_id and entity_scope_enabled) then
   if not public.finance_entity_scope(new.company_id,entity,true) then raise exception 'Entidade sem autorização de escrita.'; end if;
   if tg_op='UPDATE' then
     select legal_entity_id into prior_entity from public.projects where id=old.project_id;
     if tg_table_name='payables' then prior_entity:=coalesce((to_jsonb(old)->>'legal_entity_id')::uuid,prior_entity);end if;
     if not public.finance_entity_scope(old.company_id,prior_entity,true) then raise exception 'Origem sem autorização de escrita.'; end if;
   end if;
 end if;
 return new;
end $$;
drop policy finance_payable_entity on public.payables;
create policy finance_payable_entity on public.payables as restrictive for all to authenticated
 using(public.finance_entity_scope(company_id,coalesce(legal_entity_id,(select p.legal_entity_id from public.projects p where p.id=project_id)),false))
 with check(public.finance_entity_scope(company_id,coalesce(legal_entity_id,(select p.legal_entity_id from public.projects p where p.id=project_id)),true) and (project_id is not null or exists(select 1 from public.finance_obligation_validations v where v.title_id=payables.id and v.company_id=payables.company_id)));
create or replace function finance_private.audit_title() returns trigger
language plpgsql security definer set search_path='' as $$
declare entity uuid; reason text; before_value jsonb; effective date; begin
 if tg_op='UPDATE' then
   if new.finance_version=old.finance_version then return new; end if;
   before_value:=to_jsonb(old);
 end if;
 reason:=nullif(btrim(current_setting('finance.reason',true)),'');
 if tg_op='INSERT' then reason:=coalesce(reason,'Criação do título');
 elsif new.bank_transaction_id is not null and new.bank_transaction_id is distinct from old.bank_transaction_id then
   reason:=coalesce(reason,'Baixa vinculada ao movimento '||new.bank_transaction_id);
 end if;
 if exists(select 1 from public.finance_company_controls where company_id=new.company_id and entity_scope_enabled)
   and (reason is null or auth.uid() is null) then raise exception 'Alteração exige autoria e motivo.'; end if;
 effective:=nullif(current_setting('finance.effective_date',true),'')::date;
 select legal_entity_id into entity from public.projects where id=new.project_id;
 if tg_table_name='payables' then entity:=coalesce((to_jsonb(new)->>'legal_entity_id')::uuid,entity);end if;
 insert into public.finance_title_audit(company_id,legal_entity_id,title_id,title_type,version,previous_value,new_value,actor_id,reason,effective_date)
 values(new.company_id,entity,new.id,tg_table_name,new.finance_version,before_value,to_jsonb(new),auth.uid(),reason,effective);
 return new;
end $$;
create or replace function finance_private.title(p_company uuid,p_type text,p_title uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t jsonb; entity uuid;begin
 if p_type not in('AP','AR') then raise exception 'Tipo financeiro inválido.';end if;
 if not coalesce(public.has_company_permission(p_company,case p_type when 'AP' then 'payables.manage' else 'receivables.manage' end),false) then raise exception 'Sem permissão financeira.';end if;
 execute format('select to_jsonb(t) from public.%I t where id=$1 and company_id=$2 for update',case p_type when 'AP' then 'payables' else 'receivables' end) into t using p_title,p_company;
 select legal_entity_id into entity from public.projects where id=(t->>'project_id')::uuid;
 entity:=coalesce((t->>'legal_entity_id')::uuid,entity);
 if t is null or not public.finance_entity_scope(p_company,entity,true) then raise exception 'Título indisponível ou sem autorização.';end if;
 return t;
end $$;
create or replace function public.settle_finance_titles(p_company uuid,p_command uuid,p_account uuid,p_date date,p_lines jsonb,p_reason text)
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
 entity:=coalesce((t->>'legal_entity_id')::uuid,entity);
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
 entity:=coalesce((t->>'legal_entity_id')::uuid,entity);
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
create or replace function finance_private.check_bank_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.finance_bank_accounts; begin
 select * into a from public.finance_bank_accounts where id=new.bank_account_id;
 if a.id is null or new.company_id is distinct from a.company_id or new.legal_entity_id is distinct from a.legal_entity_id
 then raise exception 'Titular ou organização bancária incompatível.'; end if;
 if new.project_id is not null and not exists(select 1 from public.projects where id=new.project_id and company_id=new.company_id and (a.legal_entity_id is null or legal_entity_id=a.legal_entity_id))
 then raise exception 'Obra incompatível com a conta.'; end if;
 if new.payable_id is not null and not exists(select 1 from public.payables where id=new.payable_id and company_id=new.company_id and project_id is not distinct from new.project_id and (legal_entity_id is null or legal_entity_id=a.legal_entity_id))
 then raise exception 'Título incompatível com movimento.'; end if;
 if new.receivable_id is not null and not exists(select 1 from public.receivables where id=new.receivable_id and company_id=new.company_id and project_id is not distinct from new.project_id)
 then raise exception 'Recebível incompatível com movimento.'; end if;
 if exists(select 1 from public.finance_company_controls where company_id=new.company_id and entity_scope_enabled)
   and not public.finance_entity_scope(new.company_id,a.legal_entity_id,true) then raise exception 'Conta sem autorização de escrita.'; end if;
 return new;
end $$;
drop policy settlement_read on public.finance_settlement_lines;
create policy settlement_read on public.finance_settlement_lines for select to authenticated using(public.has_company_permission(company_id,case title_type when 'AP' then 'payables.view' else 'receivables.view' end) and exists(select 1 from public.finance_settlement_events e where e.id=event_id and e.company_id=finance_settlement_lines.company_id and public.finance_entity_scope(e.company_id,e.legal_entity_id,false)));
drop policy settlement_read on public.finance_title_charges;
create policy settlement_read on public.finance_title_charges for select to authenticated using(public.has_company_permission(company_id,case title_type when 'AP' then 'payables.view' else 'receivables.view' end) and ((title_type='AP' and exists(select 1 from public.payables p where p.id=title_id and p.company_id=finance_title_charges.company_id)) or (title_type='AR' and exists(select 1 from public.receivables r where r.id=title_id and r.company_id=finance_title_charges.company_id))));
create function public.validate_unassigned_obligation(p_company uuid,p_object uuid,p_command uuid,p_competence date,p_evidence text,p_reason text,p_economic_amount numeric default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare o elos_import.financial_objects;prior public.finance_obligation_validations;t uuid;r jsonb;begin
 if not coalesce(public.has_company_permission(p_company,'payables.manage'),false) then raise exception 'Sem permissão.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,716));
 select * into o from elos_import.financial_objects where id=p_object and company_id=p_company for update;
 if o.id is null or not public.finance_entity_scope(p_company,o.legal_entity_id,true) then raise exception 'Obrigação indisponível.';end if;
 if p_command is null or p_economic_amount is null and p_competence is not null or p_economic_amount is not null and (p_competence is null or p_competence>(now() at time zone 'America/Sao_Paulo')::date or p_economic_amount<0 or p_economic_amount='NaN'::numeric or p_economic_amount<>round(p_economic_amount,2)) or length(btrim(coalesce(p_evidence,'')))<5 or length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Validação exige documento econômico, competência, comando e motivo.';end if;
 select * into prior from public.finance_obligation_validations where company_id=p_company and (object_id=p_object or command_id=p_command);
 if prior.id is not null then
  if prior.command_id<>p_command or prior.object_id<>p_object or prior.competence_date is distinct from p_competence or prior.economic_amount is distinct from p_economic_amount or prior.evidence<>p_evidence or prior.reason<>p_reason then raise exception 'Validação existente ou comando diferente.';end if;return prior.title_id;
 end if;
 if o.project_id is not null or o.legal_entity_id is null or o.target_id is not null or o.pending && array['without_entity','obligation_not_proven','grouping_requires_value_links','declared_settlement_requires_ledger','reversal_requires_original_and_ledger','unknown_settlement','settlement_components_review'] then raise exception 'Fonte não comprova obrigação aberta válida sem obra.';end if;
 r:=o.snapshot;
 if r->>'effective_date' is null or (r->>'effective_date')::date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Data efetiva da obrigação exige validação.';end if;
 if r->>'source_status'<>'Pendente' or coalesce((r->>'reported_paid_cents')::bigint,0)<>0 or nullif(r->>'supplier_id','') is null or nullif(r->>'obligation_evidence','') is null then raise exception 'Documento/fornecedor/baixa requer apuração.';end if;
 perform set_config('finance.reason',p_reason,true);perform set_config('finance.effective_date',r->>'effective_date',true);
 insert into public.payables(company_id,project_id,legal_entity_id,supplier_id,document,due_date,amount,status,source_system,source_id,created_by)
 values(p_company,null,o.legal_entity_id,(r->>'supplier_id')::uuid,r->>'document',(r->>'due_date')::date,(r->>'principal_cents')::numeric/100,'open','elos_validated',o.id::text,auth.uid()) returning id into t;
 insert into public.finance_obligation_validations(company_id,legal_entity_id,object_id,title_id,command_id,source_version,competence_date,economic_amount,evidence,reason,created_by)
 values(p_company,o.legal_entity_id,o.id,t,p_command,o.version,p_competence,p_economic_amount,p_evidence,p_reason,auth.uid());
 update elos_import.financial_objects set target_id=t,applied_snapshot=snapshot,updated_at=clock_timestamp() where id=o.id;
 return t;
end $$;
revoke all on function public.validate_unassigned_obligation(uuid,uuid,uuid,date,text,text,numeric) from public,anon;
grant execute on function public.validate_unassigned_obligation(uuid,uuid,uuid,date,text,text,numeric) to authenticated;
create function public.list_unassigned_obligations(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not coalesce(public.has_company_permission(p_company,'payables.view'),false) then raise exception 'Sem permissão.';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('object_id',f.id,'target_id',f.target_id,'legal_entity_id',f.legal_entity_id,'external_id',f.external_id,'document',f.snapshot->>'document','principal_cents',f.snapshot->'principal_cents','reported_paid_cents',f.snapshot->'reported_paid_cents','source_evidence',f.snapshot->>'obligation_evidence','pending',f.pending,'economic_pending',v.id is not null and v.economic_amount is null,'validated_economic_cents',v.economic_amount*100,'operational_open_cents',p.finance_open_amount*100,'version',f.version)),'[]')
 from elos_import.financial_objects f left join public.payables p on p.id=f.target_id and p.company_id=f.company_id
 left join public.finance_obligation_validations v on v.title_id=f.target_id and v.company_id=f.company_id
 where f.company_id=p_company and f.project_id is null and ((f.legal_entity_id is not null and public.finance_entity_scope(p_company,f.legal_entity_id,false)) or (f.legal_entity_id is null and public.has_company_permission(p_company,'cashflow.manage'))));
end $$;
revoke all on function public.list_unassigned_obligations(uuid) from public,anon;
grant execute on function public.list_unassigned_obligations(uuid) to authenticated;
commit;
