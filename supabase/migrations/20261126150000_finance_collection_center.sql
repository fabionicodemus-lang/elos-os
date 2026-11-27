-- Additive collection workflow. No external integration is enabled by this migration.
begin;

create table public.finance_collection_configs (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid not null references public.projects(id), sale_id uuid references public.sales(id),
 legal_entity_id uuid not null references public.legal_entities(id), bank_account_id uuid not null references public.finance_bank_accounts(id),
 provider text not null check(length(trim(provider)) between 1 and 80), agreement text not null check(length(trim(agreement)) between 1 and 120),
 exception_reason text, email_enabled boolean not null default false, whatsapp_enabled boolean not null default false,
 email_sender text, whatsapp_sender text, reminder_time time not null default '09:00',
 bank_verified boolean not null default false, email_verified boolean not null default false, whatsapp_verified boolean not null default false,
 reconciliation_checked_at timestamptz, enabled boolean not null default true,
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(sale_id is null or length(trim(coalesce(exception_reason,'')))>=5)
);
create unique index collection_default_config on public.finance_collection_configs(company_id,project_id) where sale_id is null and enabled;
create unique index collection_sale_config on public.finance_collection_configs(company_id,sale_id) where sale_id is not null and enabled;

create table public.finance_collections (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid not null references public.projects(id), receivable_id uuid not null references public.receivables(id),
 config_id uuid not null references public.finance_collection_configs(id), bank_account_id uuid not null references public.finance_bank_accounts(id),
 legal_entity_id uuid not null references public.legal_entities(id), beneficiary_name text not null, beneficiary_cnpj text not null,
 account_snapshot jsonb not null, correction_snapshot jsonb not null, provider text not null, agreement text not null,
 amount numeric(16,2) not null check(amount>0), due_date date not null,
 status text not null default 'prepared' check(status in ('prepared','registration_requested','registered','failed','cancellation_requested','cancelled')),
 bank_identifier text, document_ref text, suspended boolean not null default false,
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(status<>'registered' or (bank_identifier is not null and document_ref is not null))
);
create unique index collection_one_live on public.finance_collections(receivable_id) where status<>'cancelled';
create unique index collection_bank_identifier on public.finance_collections(bank_account_id,provider,agreement,bank_identifier) where bank_identifier is not null;
create index collection_list on public.finance_collections(company_id,project_id,due_date,id);

create table public.finance_collection_history (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), project_id uuid not null references public.projects(id),
 collection_id uuid not null references public.finance_collections(id), event text not null, detail text,
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index collection_history_idx on public.finance_collection_history(company_id,collection_id,created_at);

create table public.finance_collection_messages (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), project_id uuid not null references public.projects(id),
 collection_id uuid not null references public.finance_collections(id), channel text not null check(channel in ('email','whatsapp')),
 purpose text not null check(purpose in ('initial','d-1','d0')), due_date date not null, scheduled_at timestamptz not null,
 recipient text not null, sender text not null, status text not null default 'pending' check(status in ('pending','dispatching','sent','failed','cancelled')),
 provider_message_id text, failure_reason text, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(collection_id,channel,purpose,due_date)
);
create index collection_message_queue on public.finance_collection_messages(scheduled_at,id) where status='pending';
create index collection_message_history on public.finance_collection_messages(company_id,collection_id);
create table public.finance_collection_message_events (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), project_id uuid not null references public.projects(id),
 message_id uuid not null references public.finance_collection_messages(id), provider_event_id text not null,
 event text not null check(event in ('sent','delivered','opened','read','failed')), occurred_at timestamptz not null, automatic_open boolean, reason text,
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(message_id,provider_event_id)
);
create index collection_message_event_idx on public.finance_collection_message_events(company_id,message_id,occurred_at);

-- A payment allocation must reference an existing active bank reconciliation link.
-- Surplus stays as unapplied credit, not an inflated receivable payment.
create table public.finance_collection_allocations (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), project_id uuid not null references public.projects(id),
 collection_id uuid not null references public.finance_collections(id), reconciliation_id uuid not null unique references public.finance_reconciliation_links(id),
 fee_reconciliation_id uuid unique references public.finance_reconciliation_links(id), gross_amount numeric(16,2) not null check(gross_amount>0),
 net_amount numeric(16,2) not null check(net_amount>0), fee_amount numeric(16,2) not null check(fee_amount>=0),
 applied_amount numeric(16,2) not null check(applied_amount>=0), available_credit numeric(16,2) not null check(available_credit>=0),
 reversal_of uuid unique references public.finance_collection_allocations(id), reason text not null,
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(gross_amount=net_amount+fee_amount and gross_amount=applied_amount+available_credit),
 check(fee_reconciliation_id is null or fee_reconciliation_id<>reconciliation_id)
);
create index collection_allocation_idx on public.finance_collection_allocations(company_id,collection_id);

-- Existing imports preserve their correction lock. No new registration until reviewed.
create table public.finance_collection_import_reviews (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), project_id uuid not null references public.projects(id),
 receivable_id uuid not null unique references public.receivables(id), reason text not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

do $$ declare t text; begin
 foreach t in array array['finance_collection_configs','finance_collections','finance_collection_history','finance_collection_messages','finance_collection_message_events','finance_collection_allocations','finance_collection_import_reviews'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated,service_role',t);
  execute format('create policy collection_read on public.%I for select to authenticated using (public.has_company_permission(company_id,''receivables.view''))',t);
 end loop;
end $$;

create function finance_private.collection_permission(p_company uuid,p_perm text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.has_company_permission(p_company,p_perm),false) then raise exception 'Sem permissão na empresa.' using errcode='42501'; end if;
end $$;

create function finance_private.collection_config(p_company uuid,p_project uuid,p_sale uuid,p_account uuid,p_provider text,p_agreement text,p_reason text,p_email text,p_whatsapp text,p_time time) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.finance_bank_accounts; p public.projects; e public.legal_entities; v uuid;
begin
 perform finance_private.collection_permission(p_company,'receivables.manage');
 perform finance_private.collection_permission(p_company,'finance.bank_accounts.manage');
 select * into p from public.projects where id=p_project and company_id=p_company for update;
 select * into a from public.finance_bank_accounts where id=p_account and company_id=p_company and status='active' and currency_code='BRL';
 select * into e from public.legal_entities where id=a.legal_entity_id and company_id=p_company and status='active';
 if p.id is null or a.id is null or e.id is null or e.cnpj is null or not public.is_valid_cnpj(e.cnpj) then raise exception 'Conta/SPE/CNPJ inválido.'; end if;
 if p_sale is null and p.legal_entity_id is distinct from e.id then raise exception 'Conta fora da SPE do empreendimento.'; end if;
 if p_sale is not null and (length(trim(coalesce(p_reason,'')))<5 or not exists(select 1 from public.sales where id=p_sale and company_id=p_company and project_id=p_project and status='active')) then raise exception 'Exceção contratual inválida.'; end if;
 if p_time is null or nullif(trim(p_provider),'') is null or nullif(trim(p_agreement),'') is null then raise exception 'Convênio, provedor e horário obrigatórios.'; end if;
 update public.finance_collection_configs set enabled=false,updated_at=now() where company_id=p_company and project_id=p_project and sale_id is not distinct from p_sale and enabled;
 insert into public.finance_collection_configs(company_id,project_id,sale_id,legal_entity_id,bank_account_id,provider,agreement,exception_reason,email_enabled,whatsapp_enabled,email_sender,whatsapp_sender,reminder_time,created_by)
 values(p_company,p_project,p_sale,e.id,a.id,trim(p_provider),trim(p_agreement),p_reason,nullif(trim(p_email),'') is not null,nullif(trim(p_whatsapp),'') is not null,nullif(trim(p_email),''),nullif(trim(p_whatsapp),''),p_time,auth.uid()) returning id into v;
 return v;
end $$;

create function finance_private.collection_prepare(p_company uuid,p_receivable uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.receivables; c public.finance_collection_configs; a public.finance_bank_accounts; e public.legal_entities; v uuid;
begin
 perform finance_private.collection_permission(p_company,'receivables.manage');
 select * into r from public.receivables where id=p_receivable and company_id=p_company for update;
 if r.id is null or r.status<>'open' or coalesce(r.adjusted_amount,r.amount)<=coalesce(r.paid_amount,0) or coalesce(r.paid_amount,0)<>finance_private.collection_paid(r.id) or not exists(select 1 from public.sales where id=r.sale_id and company_id=r.company_id and project_id=r.project_id and status='active') then raise exception 'Parcela indisponível ou com pagamento anterior não conciliado; revisar.'; end if;
 if r.source_system='eobra' and not exists(select 1 from public.finance_collection_import_reviews where receivable_id=r.id) then raise exception 'Conferir boleto existente no eObra antes de emitir.'; end if;
 if exists(select 1 from public.finance_collection_drafts where receivable_id=r.id and status='draft') then raise exception 'Existe preparação bancária anterior; revisar.'; end if;
 select * into c from public.finance_collection_configs where company_id=r.company_id and project_id=r.project_id and enabled and (sale_id=r.sale_id or sale_id is null) order by sale_id nulls last limit 1;
 select * into a from public.finance_bank_accounts where id=c.bank_account_id and company_id=r.company_id and legal_entity_id=c.legal_entity_id and status='active' and currency_code='BRL';
 select * into e from public.legal_entities where id=c.legal_entity_id and company_id=r.company_id and status='active';
 if c.id is null or a.id is null or e.id is null or e.cnpj is null or not public.is_valid_cnpj(e.cnpj) or (c.sale_id is null and not exists(select 1 from public.projects where id=r.project_id and company_id=r.company_id and legal_entity_id=e.id)) then raise exception 'Configuração válida de cobrança/SPE não encontrada.'; end if;
 select id into v from public.finance_collections where receivable_id=r.id and status<>'cancelled'; if v is not null then return v; end if;
 insert into public.finance_collections(company_id,project_id,receivable_id,config_id,bank_account_id,legal_entity_id,beneficiary_name,beneficiary_cnpj,account_snapshot,correction_snapshot,provider,agreement,amount,due_date,created_by)
 values(r.company_id,r.project_id,r.id,c.id,a.id,e.id,e.legal_name,e.cnpj,jsonb_build_object('bank',a.bank_code,'agency',a.agency,'account',a.account_number,'digit',a.account_digit),
 jsonb_build_object('base',r.amount,'adjusted',r.adjusted_amount,'correction',r.correction_amount,'index',r.adjustment_index,'base_month',r.correction_base_month,'base_value',r.correction_base_value,'reference_month',r.correction_reference_month,'reference_value',r.correction_reference_value,'locked',r.correction_locked,'source',r.source_system,'paid',coalesce(r.paid_amount,0)),c.provider,c.agreement,coalesce(r.adjusted_amount,r.amount)-coalesce(r.paid_amount,0),r.due_date,auth.uid()) returning id into v;
 insert into public.finance_collection_history(company_id,project_id,collection_id,event,created_by) values(r.company_id,r.project_id,v,'prepared',auth.uid());
 return v;
end $$;

create function finance_private.collection_review_import(p_company uuid,p_receivable uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare r public.receivables;
begin
 perform finance_private.collection_permission(p_company,'receivables.manage');
 select * into r from public.receivables where id=p_receivable and company_id=p_company and source_system='eobra' and status='open' for update;
 if r.id is null or length(trim(coalesce(p_reason,'')))<15 then raise exception 'Informe evidência de que não existe boleto ativo na origem.'; end if;
 if exists(select 1 from public.integration_import_records i join public.integration_import_rows x on x.id=i.row_id where i.company_id=p_company and i.entity_kind='receivable' and i.target_id=r.id and nullif(x.normalized_data->>'bank_identifier','') is not null) then raise exception 'Identificador bancário importado: exige vinculação/homologação, não nova emissão.'; end if;
 insert into public.finance_collection_import_reviews(company_id,project_id,receivable_id,reason,created_by) values(p_company,r.project_id,r.id,p_reason,auth.uid()) on conflict(receivable_id) do nothing;
end $$;

create function finance_private.collection_eligible(c public.finance_collections) returns boolean language sql stable security definer set search_path='' as $$
 select not c.suspended and exists(select 1 from public.receivables r join public.sales s on s.id=r.sale_id and s.company_id=r.company_id and s.project_id=r.project_id join public.finance_collection_configs f on f.id=c.config_id join public.finance_bank_accounts a on a.id=c.bank_account_id join public.legal_entities e on e.id=c.legal_entity_id
 where r.id=c.receivable_id and r.company_id=c.company_id and r.project_id=c.project_id and s.status='active' and r.status='open' and r.due_date=c.due_date and coalesce(r.adjusted_amount,r.amount)-coalesce(r.paid_amount,0)=c.amount and f.enabled and f.bank_verified and f.id=(select x.id from public.finance_collection_configs x where x.company_id=r.company_id and x.project_id=r.project_id and x.enabled and (x.sale_id=r.sale_id or x.sale_id is null) order by x.sale_id nulls last limit 1) and a.company_id=c.company_id and a.legal_entity_id=e.id and a.status='active' and e.company_id=c.company_id and e.status='active' and e.cnpj=c.beneficiary_cnpj and (f.sale_id is not null or exists(select 1 from public.projects p where p.id=r.project_id and p.company_id=r.company_id and p.legal_entity_id=e.id)) and c.account_snapshot=jsonb_build_object('bank',a.bank_code,'agency',a.agency,'account',a.account_number,'digit',a.account_digit))
$$;

create function finance_private.collection_command(p_company uuid,p_id uuid,p_action text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare c public.finance_collections;
begin
 perform finance_private.collection_permission(p_company,'receivables.manage');
 select * into c from public.finance_collections where id=p_id and company_id=p_company for update;
 if c.id is null then raise exception 'Cobrança indisponível.'; end if;
 if p_action='request' and c.status='prepared' and finance_private.collection_eligible(c) then
  update public.finance_collections set status='registration_requested',updated_at=now() where id=c.id;
 elsif p_action='suspend' and c.status<>'cancelled' and length(trim(coalesce(p_reason,'')))>=5 then
  update public.finance_collections set suspended=true,updated_at=now() where id=c.id;
 elsif p_action='cancel' and c.status in ('prepared','registered','registration_requested','failed') and length(trim(coalesce(p_reason,'')))>=5 then
  update public.finance_collections set status=case when c.status='prepared' then 'cancelled' else 'cancellation_requested' end,suspended=true,updated_at=now() where id=c.id;
 else raise exception 'Operação indisponível; verifique configuração homologada, saldo e vencimento.'; end if;
 if p_action in ('suspend','cancel') then update public.finance_collection_messages set status='cancelled',updated_at=now() where collection_id=c.id and status='pending'; end if;
 insert into public.finance_collection_history(company_id,project_id,collection_id,event,detail,created_by) values(c.company_id,c.project_id,c.id,p_action,p_reason,auth.uid());
end $$;

-- Only trusted server integrations can confirm registrations or failures.
create function public.collection_bank_result(p_id uuid,p_status text,p_identifier text,p_document_ref text,p_detail text) returns void language plpgsql security definer set search_path='' as $$
declare c public.finance_collections;
begin
 select * into c from public.finance_collections where id=p_id for update;
 if c.id is null then raise exception 'Cobrança não encontrada.'; end if;
 if c.status=p_status and c.bank_identifier is not distinct from p_identifier and c.document_ref is not distinct from p_document_ref then return; end if;
 if not ((c.status='registration_requested' and p_status in ('registered','failed')) or (c.status='cancellation_requested' and p_status='cancelled')) then raise exception 'Transição bancária inválida.'; end if;
 if p_status='registered' and (nullif(trim(p_identifier),'') is null or nullif(trim(p_document_ref),'') is null) then raise exception 'Registro sem documento/identificador.'; end if;
 update public.finance_collections set status=p_status,bank_identifier=coalesce(p_identifier,bank_identifier),document_ref=coalesce(p_document_ref,document_ref),updated_at=now() where id=c.id;
 insert into public.finance_collection_history(company_id,project_id,collection_id,event,detail) values(c.company_id,c.project_id,c.id,p_status,p_detail);
end $$;

-- Activation and feed freshness are server only, never a user checkbox.
create function public.collection_verify_config(p_id uuid,p_bank boolean,p_email boolean,p_whatsapp boolean,p_checked_at timestamptz) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_checked_at>now() then raise exception 'Data de conciliação inválida.'; end if;
 update public.finance_collection_configs set bank_verified=p_bank,email_verified=p_email,whatsapp_verified=p_whatsapp,reconciliation_checked_at=p_checked_at,updated_at=now() where id=p_id and enabled;
end $$;

create function public.collection_mark_reconciled(p_id uuid) returns void language sql security definer set search_path='' as $$
 update public.finance_collection_configs set reconciliation_checked_at=now(),updated_at=now() where id=p_id and enabled and bank_verified
$$;

create function public.collection_schedule(p_id uuid) returns integer language plpgsql security definer set search_path='' as $$
declare c public.finance_collections; f public.finance_collection_configs; r public.receivables; cl public.clients; n integer;
begin
 select * into c from public.finance_collections where id=p_id for update;
 if c.id is null then return 0; end if;
 if c.status<>'registered' or not finance_private.collection_eligible(c) then
  update public.finance_collection_messages set status='cancelled',updated_at=now() where collection_id=c.id and status='pending'; return 0;
 end if;
 select * into f from public.finance_collection_configs where id=c.config_id;
 select * into r from public.receivables where id=c.receivable_id;
 select * into cl from public.clients where id=r.client_id and company_id=c.company_id;
 insert into public.finance_collection_messages(company_id,project_id,collection_id,channel,purpose,due_date,scheduled_at,recipient,sender)
 select c.company_id,c.project_id,c.id,ch.channel,d.purpose,c.due_date,d.scheduled,ch.recipient,ch.sender
 from (values ('email',cl.email,f.email_sender,f.email_enabled and f.email_verified),('whatsapp',cl.phone,f.whatsapp_sender,f.whatsapp_enabled and f.whatsapp_verified)) ch(channel,recipient,sender,enabled)
 cross join (values ('initial',now()),('d-1',((c.due_date-1)+f.reminder_time) at time zone 'America/Sao_Paulo'),('d0',(c.due_date+f.reminder_time) at time zone 'America/Sao_Paulo')) d(purpose,scheduled)
 where ch.enabled and nullif(trim(ch.recipient),'') is not null and nullif(trim(ch.sender),'') is not null and (d.purpose='initial' or d.scheduled>=now())
 on conflict(collection_id,channel,purpose,due_date) do nothing;
 get diagnostics n=row_count; return n;
end $$;

-- Atomic claim before external send. Unknown outcome stays dispatching for review (no blind retry).
create function public.collection_claim_message(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.finance_collection_messages; c public.finance_collections; f public.finance_collection_configs; recipient_now text; context jsonb;
begin
 select collection_id into m.collection_id from public.finance_collection_messages where id=p_id;
 select * into c from public.finance_collections where id=m.collection_id for update;
 select * into m from public.finance_collection_messages where id=p_id for update;
 if m.id is null or m.status<>'pending' or m.scheduled_at>now() then return null; end if;
 select * into f from public.finance_collection_configs where id=c.config_id;
 if c.status<>'registered' or not finance_private.collection_eligible(c) then update public.finance_collection_messages set status='cancelled',updated_at=now() where id=m.id; return null; end if;
 if (m.channel='email' and not f.email_verified) or (m.channel='whatsapp' and not f.whatsapp_verified) or f.reconciliation_checked_at is null or f.reconciliation_checked_at<now()-interval '30 minutes' then return null; end if;
 select case when m.channel='email' then cl.email else cl.phone end,jsonb_build_object('project',p.name,'unit',u.code,'customer',cl.name,'installment',r.description) into recipient_now,context from public.receivables r join public.clients cl on cl.id=r.client_id and cl.company_id=r.company_id join public.projects p on p.id=r.project_id and p.company_id=r.company_id join public.units u on u.id=r.unit_id and u.company_id=r.company_id and u.project_id=r.project_id where r.id=c.receivable_id;
 if recipient_now is distinct from m.recipient or context is null then update public.finance_collection_messages set status='cancelled',failure_reason='Destinatário alterado; conferir cadastro.',updated_at=now() where id=m.id; return null; end if;
 if m.purpose<>'initial' and (m.scheduled_at at time zone 'America/Sao_Paulo')::date<>(now() at time zone 'America/Sao_Paulo')::date then update public.finance_collection_messages set status='cancelled',updated_at=now() where id=m.id; return null; end if;
 update public.finance_collection_messages set status='dispatching',updated_at=now() where id=m.id;
 return jsonb_build_object('message',to_jsonb(m),'collection',to_jsonb(c),'context',context);
end $$;

create function public.collection_registration_ready(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select status='registration_requested' and finance_private.collection_eligible(c) from public.finance_collections c where c.id=p_id),false)
$$;

create function public.collection_message_event(p_id uuid,p_event_id text,p_event text,p_occurred timestamptz,p_automatic boolean,p_reason text,p_provider_id text) returns void language plpgsql security definer set search_path='' as $$
declare m public.finance_collection_messages;
begin
 select * into m from public.finance_collection_messages where id=p_id for update;
 if m.id is null or m.status not in ('dispatching','sent','failed') or nullif(trim(p_event_id),'') is null or p_occurred is null or (p_event='opened' and m.channel<>'email') or (p_event='read' and m.channel<>'whatsapp') then raise exception 'Evento de comunicação inválido.'; end if;
 if m.provider_message_id is not null and m.provider_message_id is distinct from p_provider_id then raise exception 'Identificador da mensagem divergente.'; end if;
 insert into public.finance_collection_message_events(company_id,project_id,message_id,provider_event_id,event,occurred_at,automatic_open,reason) values(m.company_id,m.project_id,m.id,p_event_id,p_event,p_occurred,case when p_event='opened' then p_automatic end,p_reason) on conflict(message_id,provider_event_id) do nothing;
 if not found then return; end if;
 update public.finance_collection_messages set provider_message_id=coalesce(provider_message_id,p_provider_id),status=case when p_event='failed' then 'failed' else 'sent' end,failure_reason=case when p_event='failed' then p_reason else failure_reason end,updated_at=now() where id=m.id;
end $$;

-- Active reconciliation evidence is the only source of the payment projection.
create function finance_private.collection_paid(p_receivable uuid) returns numeric language sql stable security definer set search_path='' as $$
 select coalesce(sum(case when a.reversal_of is null then a.applied_amount else -a.applied_amount end),0)
 from public.finance_collection_allocations a join public.finance_collections c on c.id=a.collection_id join public.finance_reconciliation_links l on l.id=a.reconciliation_id
 where c.receivable_id=p_receivable and l.reversed_at is null
 and (a.reversal_of is null or exists(select 1 from public.finance_collection_allocations orig join public.finance_reconciliation_links ol on ol.id=orig.reconciliation_id where orig.id=a.reversal_of and ol.reversed_at is null))
$$;

create function finance_private.collection_sync(p_receivable uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.receivables; v numeric; c public.finance_collections; received_on date;
begin
 select * into r from public.receivables where id=p_receivable for update;
 v:=finance_private.collection_paid(r.id);
 if r.status='cancelled' then return; end if;
 select max(e.transaction_date) into received_on from public.finance_collection_allocations a join public.finance_collections x on x.id=a.collection_id join public.finance_reconciliation_links l on l.id=a.reconciliation_id join public.finance_statement_entries e on e.id=l.entry_id where x.receivable_id=r.id and l.reversed_at is null and a.reversal_of is null;
 update public.receivables set paid_amount=v,status=case when v>=coalesce(adjusted_amount,amount) then 'paid' else 'open' end,paid_at=case when v>=coalesce(adjusted_amount,amount) then received_on else null end,updated_at=now() where id=r.id;
 for c in select * from public.finance_collections where receivable_id=r.id loop
  if v>0 or r.status='paid' then update public.finance_collection_messages set status='cancelled',updated_at=now() where collection_id=c.id and status='pending'; end if;
 end loop;
end $$;

create function finance_private.collection_allocate_impl(p_company uuid,p_id uuid,p_link uuid,p_fee uuid,p_reversal uuid,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.finance_collections; r public.receivables; l public.finance_reconciliation_links; t public.finance_bank_transactions; e public.finance_statement_entries; fl public.finance_reconciliation_links; ft public.finance_bank_transactions; fe public.finance_statement_entries; orig public.finance_collection_allocations; v uuid; gross numeric; applied numeric; fee numeric:=0;
begin
 select * into c from public.finance_collections where id=p_id and company_id=p_company for update;
 if c.id is null or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Cobrança ou justificativa inválida.'; end if;
 select * into r from public.receivables where id=c.receivable_id for update;
 if r.status='cancelled' then raise exception 'Parcela cancelada; tratar crédito em conferência.'; end if;
 select * into l from public.finance_reconciliation_links where id=p_link for update;
 select * into t from public.finance_bank_transactions where id=l.transaction_id;
 select * into e from public.finance_statement_entries where id=l.entry_id;
 if l.id is null or l.reversed_at is not null or l.company_id<>p_company or t.company_id<>p_company or e.company_id<>p_company or t.bank_account_id<>c.bank_account_id or e.bank_account_id<>c.bank_account_id or t.legal_entity_id is distinct from c.legal_entity_id or (t.project_id is not null and t.project_id<>c.project_id) or (t.receivable_id is not null and t.receivable_id<>r.id) or t.status<>'reconciled' then raise exception 'Evidência bancária não conciliada ou incompatível.'; end if;
 select id into v from public.finance_collection_allocations where reconciliation_id=p_link and collection_id=c.id; if v is not null then return v; end if;
 if exists(select 1 from public.finance_collection_allocations where reconciliation_id=p_link or fee_reconciliation_id=p_link) then raise exception 'Conciliação já utilizada.'; end if;
 if p_reversal is null then
  if t.direction<>'credit' or e.amount<=0 or t.transaction_type<>'receipt' then raise exception 'Recebimento exige crédito bancário.'; end if;
  if p_fee is not null then
   select * into fl from public.finance_reconciliation_links where id=p_fee for update;
   select * into ft from public.finance_bank_transactions where id=fl.transaction_id;
   select * into fe from public.finance_statement_entries where id=fl.entry_id;
   if fl.id is null or fl.reversed_at is not null or fl.company_id<>p_company or ft.company_id<>p_company or fe.company_id<>p_company or ft.bank_account_id<>c.bank_account_id or fe.bank_account_id<>c.bank_account_id or ft.legal_entity_id is distinct from c.legal_entity_id or ft.direction<>'debit' or ft.transaction_type<>'fee' or ft.status<>'reconciled' or fe.amount>=0 or exists(select 1 from public.finance_collection_allocations where reconciliation_id=p_fee or fee_reconciliation_id=p_fee) then raise exception 'Tarifa sem evidência conciliada válida.'; end if;
   fee:=fl.amount;
  end if;
  -- A separate fee debit reduces cash, not the amount paid by the client.
  gross:=l.amount; if fee>=gross then raise exception 'Tarifa deve ser inferior ao crédito.'; end if;
  applied:=least(gross,greatest(coalesce(r.adjusted_amount,r.amount)-finance_private.collection_paid(r.id),0));
 else
  select * into orig from public.finance_collection_allocations where id=p_reversal and collection_id=c.id and reversal_of is null;
  if orig.id is null or p_fee is not null or t.direction<>'debit' or t.transaction_type<>'refund' or e.amount>=0 or l.amount<>orig.gross_amount or exists(select 1 from public.finance_collection_allocations where reversal_of=orig.id) then raise exception 'Estorno exige débito conciliado igual ao recebimento original; diferenças para conferência.'; end if;
  gross:=l.amount; applied:=orig.applied_amount;
 end if;
 insert into public.finance_collection_allocations(company_id,project_id,collection_id,reconciliation_id,fee_reconciliation_id,gross_amount,net_amount,fee_amount,applied_amount,available_credit,reversal_of,reason,created_by)
 values(c.company_id,c.project_id,c.id,l.id,p_fee,gross,gross-fee,fee,applied,gross-applied,p_reversal,p_reason,auth.uid()) returning id into v;
 perform finance_private.collection_sync(r.id);
 insert into public.finance_collection_history(company_id,project_id,collection_id,event,detail,created_by) values(c.company_id,c.project_id,c.id,case when p_reversal is null then 'reconciled_receipt' else 'reconciled_refund' end,p_reason,auth.uid());
 return v;
end $$;

create function finance_private.collection_allocate(p_company uuid,p_id uuid,p_link uuid,p_fee uuid,p_reversal uuid,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform finance_private.collection_permission(p_company,'receivables.manage'); perform finance_private.collection_permission(p_company,'finance.bank_accounts.reconcile');
 return finance_private.collection_allocate_impl(p_company,p_id,p_link,p_fee,p_reversal,p_reason);
end $$;

-- Adapter supplies an authenticated bank identifier; only exact account + provider +
-- agreement + identifier match is accepted. Unknown identifiers stay in bank reconciliation.
create function public.collection_match_receipt(p_account uuid,p_provider text,p_agreement text,p_identifier text,p_link uuid,p_fee uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.finance_collections;
begin
 select x.* into c from public.finance_collections x join public.finance_collection_configs f on f.id=x.config_id where x.bank_account_id=p_account and x.provider=p_provider and x.agreement=p_agreement and x.bank_identifier=p_identifier and f.bank_verified;
 if c.id is null then return null; end if;
 return finance_private.collection_allocate_impl(c.company_id,c.id,p_link,p_fee,null,'Identificador bancário exato confirmado pelo adaptador');
end $$;

create function finance_private.collection_payment_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare v numeric;
begin
 if exists(select 1 from public.finance_collections where receivable_id=old.id) then
  if new.company_id<>old.company_id or new.project_id<>old.project_id or new.sale_id<>old.sale_id or new.client_id<>old.client_id or new.unit_id<>old.unit_id then raise exception 'Parcela de cobrança não pode trocar vínculos.'; end if;
  if new.paid_amount is distinct from old.paid_amount or new.status='paid' or old.status='paid' and new.status<>'paid' or new.paid_at is distinct from old.paid_at or new.bank_transaction_id is distinct from old.bank_transaction_id or new.bank_account_id is distinct from old.bank_account_id then
   v:=finance_private.collection_paid(old.id);
   if coalesce(new.paid_amount,0)<>v or (new.status='paid') is distinct from (v>=coalesce(new.adjusted_amount,new.amount)) or new.bank_transaction_id is distinct from old.bank_transaction_id or new.bank_account_id is distinct from old.bank_account_id then raise exception 'Baixa exige recebimento bancário conciliado.'; end if;
  end if;
 end if; return new;
end $$;
create trigger zz_collection_payment_guard before update on public.receivables for each row execute function finance_private.collection_payment_guard();

create function finance_private.collection_reverse_link() returns trigger language plpgsql security definer set search_path='' as $$
declare r uuid;
begin
 if new.reversed_at is distinct from old.reversed_at then
  for r in select distinct c.receivable_id from public.finance_collection_allocations a join public.finance_collections c on c.id=a.collection_id where a.reconciliation_id=new.id or a.fee_reconciliation_id=new.id loop perform finance_private.collection_sync(r); end loop;
 end if; return new;
end $$;
create trigger collection_reconciliation_reversed after update of reversed_at on public.finance_reconciliation_links for each row execute function finance_private.collection_reverse_link();

-- Cancel queued communications immediately on title changes. A changed boleto must be
-- cancelled/registered again; never send a document with its old value or due date.
create function finance_private.collection_title_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'open' or new.due_date is distinct from old.due_date or new.adjusted_amount is distinct from old.adjusted_amount or new.paid_amount is distinct from old.paid_amount then
  update public.finance_collection_messages set status='cancelled',updated_at=now() where status='pending' and collection_id in(select id from public.finance_collections where receivable_id=new.id);
 end if;
 if new.status='cancelled' or (new.status='open' and (new.due_date is distinct from old.due_date or new.adjusted_amount is distinct from old.adjusted_amount or coalesce(new.paid_amount,0)<>coalesce(old.paid_amount,0))) then
  insert into public.finance_collection_history(company_id,project_id,collection_id,event,detail) select company_id,project_id,id,'reissue_required','Vencimento, valor ou saldo mudou; cancelar o boleto anterior antes de emitir outro.' from public.finance_collections where receivable_id=new.id and status in ('prepared','registration_requested','registered','failed');
  update public.finance_collections set status=case when status='prepared' then 'cancelled' else 'cancellation_requested' end,suspended=true,updated_at=now() where receivable_id=new.id and status in ('prepared','registration_requested','registered','failed');
 end if;
 return new;
end $$;
create trigger collection_title_changed after update on public.receivables for each row execute function finance_private.collection_title_change();

-- Keep legacy Financeiro summary consistent with the same residual balance used
-- by the existing delinquency report; preserve all existing response keys.
create or replace function public.receivables_summary(p_company_id uuid,p_project_id uuid default null,p_sale_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 with s as (select count(*) filter(where status='active') active_sales,coalesce(sum(total_amount) filter(where status='active'),0) registered_sale_amount from public.sales where company_id=p_company_id and (p_project_id is null or project_id=p_project_id) and (p_sale_id is null or id=p_sale_id) and (public.has_company_permission(company_id,'receivables.view') or public.has_company_permission(company_id,'receivables.manage'))),
 r as (select count(*) filter(where status<>'cancelled') total_count,count(*) filter(where status='open') open_count,count(*) filter(where status='paid') paid_count,count(*) filter(where status='open' and due_date<(now() at time zone 'America/Sao_Paulo')::date) overdue_count,
 coalesce(sum(amount) filter(where status<>'cancelled'),0) base_amount,coalesce(sum(coalesce(adjusted_amount,amount)) filter(where status<>'cancelled'),0) updated_amount,coalesce(sum(correction_amount) filter(where status<>'cancelled'),0) correction_amount,
 coalesce(sum(greatest(coalesce(adjusted_amount,amount)-coalesce(paid_amount,0),0)) filter(where status='open'),0) open_amount,
 coalesce(sum(coalesce(paid_amount,case when status='paid' then coalesce(adjusted_amount,amount) else 0 end)) filter(where status<>'cancelled'),0) paid_amount,
 coalesce(sum(correction_amount) filter(where status='open'),0) open_correction_amount
 from public.receivables where company_id=p_company_id and (p_project_id is null or project_id=p_project_id) and (p_sale_id is null or sale_id=p_sale_id) and (public.has_company_permission(company_id,'receivables.view') or public.has_company_permission(company_id,'receivables.manage')))
 select to_jsonb(r)||to_jsonb(s)||jsonb_build_object('contracted_amount',r.base_amount,'planned_amount',r.base_amount,'unplanned_amount',greatest(s.registered_sale_amount-r.base_amount,0)) from r cross join s
$$;
revoke all on function public.receivables_summary(uuid,uuid,uuid) from public,anon;
grant execute on function public.receivables_summary(uuid,uuid,uuid) to authenticated;

create function finance_private.collection_legacy_draft_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.finance_collections where receivable_id=new.receivable_id) then raise exception 'Use a Central de Cobrança para esta parcela.'; end if;
 return new;
end $$;
create trigger collection_legacy_draft_guard before insert on public.finance_collection_drafts for each row execute function finance_private.collection_legacy_draft_guard();

create view public.finance_collection_center with (security_invoker=true) as
select r.id as receivable_id,r.company_id,r.project_id,r.sale_id,r.client_id,r.unit_id,r.description,r.due_date,r.status as receivable_status,r.source_system,
 r.amount as base_amount,r.adjusted_amount,coalesce(r.paid_amount,0) as paid_amount,greatest(coalesce(r.adjusted_amount,r.amount)-coalesce(r.paid_amount,0),0) as balance,
 cl.name as client_name,u.code as unit_code,p.name as project_name,c.id as collection_id,c.bank_account_id,c.status as collection_status,c.suspended,c.bank_identifier,c.beneficiary_name,c.beneficiary_cnpj,c.amount as issued_amount,c.due_date as issued_due_date,
 exists(select 1 from public.finance_collection_import_reviews x where x.receivable_id=r.id) as import_reviewed
from public.receivables r join public.projects p on p.id=r.project_id and p.company_id=r.company_id
left join public.clients cl on cl.id=r.client_id and cl.company_id=r.company_id
left join public.units u on u.id=r.unit_id and u.company_id=r.company_id and u.project_id=r.project_id
left join lateral(select * from public.finance_collections x where x.receivable_id=r.id and x.company_id=r.company_id order by (x.status<>'cancelled') desc,x.created_at desc,x.id desc limit 1) c on true;
revoke all on public.finance_collection_center from public,anon,authenticated,service_role;
grant select on public.finance_collection_center to authenticated;

-- Checked private implementations; public RPCs are invokers.
create function public.collection_config(p_company uuid,p_project uuid,p_sale uuid,p_account uuid,p_provider text,p_agreement text,p_reason text,p_email text,p_whatsapp text,p_time time) returns uuid language sql security invoker set search_path='' as $$select finance_private.collection_config(p_company,p_project,p_sale,p_account,p_provider,p_agreement,p_reason,p_email,p_whatsapp,p_time)$$;
create function public.collection_prepare(p_company uuid,p_receivable uuid) returns uuid language sql security invoker set search_path='' as $$select finance_private.collection_prepare(p_company,p_receivable)$$;
create function public.collection_review_import(p_company uuid,p_receivable uuid,p_reason text) returns void language sql security invoker set search_path='' as $$select finance_private.collection_review_import(p_company,p_receivable,p_reason)$$;
create function public.collection_command(p_company uuid,p_id uuid,p_action text,p_reason text) returns void language sql security invoker set search_path='' as $$select finance_private.collection_command(p_company,p_id,p_action,p_reason)$$;
create function public.collection_allocate(p_company uuid,p_id uuid,p_link uuid,p_fee uuid,p_reversal uuid,p_reason text) returns uuid language sql security invoker set search_path='' as $$select finance_private.collection_allocate(p_company,p_id,p_link,p_fee,p_reversal,p_reason)$$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig,n.nspname as schema_name,p.proname as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','finance_private') and p.proname like 'collection_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
  if f.name in ('collection_config','collection_prepare','collection_review_import','collection_command','collection_allocate') then execute format('grant execute on function %s to authenticated',f.sig);
  elsif f.schema_name='public' then execute format('grant execute on function %s to service_role',f.sig); end if;
 end loop;
end $$;
commit;
