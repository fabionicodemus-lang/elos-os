-- Elos OS — Financeiro · Impostos
-- Cadastro fiscal, agenda de obrigações, geração no Contas a Pagar e sincronização do pagamento.

begin;

create table if not exists public.finance_tax_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  jurisdiction text not null default 'federal' check(jurisdiction in ('federal','state','municipal','labor','other')),
  calculation_method text not null default 'manual' check(calculation_method in ('manual','percentage','withholding')),
  default_rate numeric(9,4) not null default 0 check(default_rate>=0),
  due_day integer check(due_day between 1 and 31),
  supplier_id uuid references public.suppliers(id) on delete restrict,
  status text not null default 'active' check(status in ('active','inactive')),
  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_tax_type_code_check check(nullif(trim(code),'') is not null),
  constraint finance_tax_type_name_check check(nullif(trim(name),'') is not null)
);

create unique index if not exists finance_tax_types_company_code_unique_idx
  on public.finance_tax_types(company_id,lower(code));
create index if not exists finance_tax_types_company_status_idx
  on public.finance_tax_types(company_id,status,jurisdiction,name);

create table if not exists public.finance_tax_obligations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete restrict,
  legal_entity_id uuid references public.legal_entities(id) on delete restrict,
  tax_type_id uuid not null references public.finance_tax_types(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  competence date not null,
  due_date date not null,
  principal_amount numeric(18,2) not null default 0,
  penalty_amount numeric(18,2) not null default 0,
  interest_amount numeric(18,2) not null default 0,
  other_amount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  document_number text,
  barcode text,
  source_type text not null default 'manual',
  source_id text,
  status text not null default 'draft' check(status in ('draft','open','paid','cancelled')),
  payable_id uuid references public.payables(id) on delete restrict,
  paid_at date,
  notes text,
  cancellation_reason text,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_tax_obligation_values_check check(
    principal_amount>=0 and penalty_amount>=0 and interest_amount>=0 and other_amount>=0 and
    total_amount=round(principal_amount+penalty_amount+interest_amount+other_amount,2) and total_amount>0
  ),
  constraint finance_tax_obligation_competence_check check(competence=date_trunc('month',competence)::date),
  constraint finance_tax_obligation_paid_check check(status<>'paid' or (payable_id is not null and paid_at is not null)),
  constraint finance_tax_obligation_cancel_check check(status<>'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null)
);

create unique index if not exists finance_tax_obligations_source_unique_idx
  on public.finance_tax_obligations(company_id,source_type,source_id)
  where source_id is not null and status<>'cancelled';
create unique index if not exists finance_tax_obligations_payable_unique_idx
  on public.finance_tax_obligations(payable_id) where payable_id is not null;
create index if not exists finance_tax_obligations_company_due_idx
  on public.finance_tax_obligations(company_id,status,due_date);
create index if not exists finance_tax_obligations_project_competence_idx
  on public.finance_tax_obligations(company_id,project_id,competence desc);
create index if not exists finance_tax_obligations_entity_competence_idx
  on public.finance_tax_obligations(company_id,legal_entity_id,competence desc);

insert into public.permissions(key,module,action,description) values
  ('finance.taxes.view','finance_taxes','view','Visualizar cadastro fiscal e obrigações tributárias'),
  ('finance.taxes.manage','finance_taxes','manage','Cadastrar tributos e preparar obrigações fiscais'),
  ('finance.taxes.approve','finance_taxes','approve','Enviar obrigações fiscais ao Contas a Pagar'),
  ('finance.taxes.cancel','finance_taxes','cancel','Cancelar obrigações fiscais com rastreabilidade')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true
from public.roles r
cross join(values
  ('finance.taxes.view'),('finance.taxes.manage'),('finance.taxes.approve'),('finance.taxes.cancel')
)p(permission_key)
where r.key in('owner','admin','director','finance')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'finance.taxes.view',true
from public.roles r
where r.key in('engineering','viewer')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.finance_tax_types(company_id,code,name,jurisdiction,calculation_method,default_rate,status)
select c.id,v.code,v.name,v.jurisdiction,v.method,0,'active'
from public.companies c
cross join(values
  ('ISS','Imposto Sobre Serviços','municipal','withholding'),
  ('INSS','Contribuição Previdenciária','labor','withholding'),
  ('IRRF','Imposto de Renda Retido na Fonte','federal','withholding'),
  ('PIS','Programa de Integração Social','federal','withholding'),
  ('COFINS','Contribuição para Financiamento da Seguridade Social','federal','withholding'),
  ('CSLL','Contribuição Social sobre o Lucro Líquido','federal','withholding'),
  ('FGTS','Fundo de Garantia do Tempo de Serviço','labor','manual'),
  ('ICMS','Imposto sobre Circulação de Mercadorias e Serviços','state','manual'),
  ('DAS','Documento de Arrecadação do Simples Nacional','federal','manual')
)v(code,name,jurisdiction,method)
on conflict(company_id,lower(code)) do nothing;

alter table public.finance_tax_types enable row level security;
alter table public.finance_tax_obligations enable row level security;

drop policy if exists finance_tax_types_select on public.finance_tax_types;
create policy finance_tax_types_select on public.finance_tax_types for select to authenticated
using(
  public.has_company_permission(company_id,'finance.taxes.view') or
  public.has_company_permission(company_id,'finance.taxes.manage')
);

drop policy if exists finance_tax_types_write on public.finance_tax_types;
create policy finance_tax_types_write on public.finance_tax_types for all to authenticated
using(public.has_company_permission(company_id,'finance.taxes.manage'))
with check(public.has_company_permission(company_id,'finance.taxes.manage'));

drop policy if exists finance_tax_obligations_select on public.finance_tax_obligations;
create policy finance_tax_obligations_select on public.finance_tax_obligations for select to authenticated
using(
  public.has_company_permission(company_id,'finance.taxes.view') or
  public.has_company_permission(company_id,'finance.taxes.manage') or
  public.has_company_permission(company_id,'finance.taxes.approve')
);

drop policy if exists finance_tax_obligations_write on public.finance_tax_obligations;
create policy finance_tax_obligations_write on public.finance_tax_obligations for all to authenticated
using(
  public.has_company_permission(company_id,'finance.taxes.manage') or
  public.has_company_permission(company_id,'finance.taxes.approve') or
  public.has_company_permission(company_id,'finance.taxes.cancel')
)
with check(
  public.has_company_permission(company_id,'finance.taxes.manage') or
  public.has_company_permission(company_id,'finance.taxes.approve') or
  public.has_company_permission(company_id,'finance.taxes.cancel')
);

create or replace function public.save_finance_tax_type(
  p_company_id uuid,p_tax_type_id uuid,p_code text,p_name text,p_jurisdiction text,p_calculation_method text,
  p_default_rate numeric,p_due_day integer,p_supplier_id uuid,p_status text,p_notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; begin
  if not public.has_company_permission(p_company_id,'finance.taxes.manage') then raise exception 'Sem permissão para gerenciar impostos.'; end if;
  if nullif(trim(coalesce(p_code,'')),'') is null or nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Informe código e nome do tributo.'; end if;
  if p_jurisdiction not in('federal','state','municipal','labor','other') then raise exception 'Esfera fiscal inválida.'; end if;
  if p_calculation_method not in('manual','percentage','withholding') then raise exception 'Forma de cálculo inválida.'; end if;
  if p_status not in('active','inactive') then raise exception 'Status inválido.'; end if;
  if coalesce(p_default_rate,0)<0 then raise exception 'A alíquota não pode ser negativa.'; end if;
  if p_due_day is not null and (p_due_day<1 or p_due_day>31) then raise exception 'O dia de referência deve ficar entre 1 e 31.'; end if;
  if p_supplier_id is not null and not exists(select 1 from public.suppliers where id=p_supplier_id and company_id=p_company_id) then raise exception 'O favorecido não pertence à empresa ativa.'; end if;

  if p_tax_type_id is null then
    insert into public.finance_tax_types(company_id,code,name,jurisdiction,calculation_method,default_rate,due_day,supplier_id,status,notes,created_by,updated_by)
    values(p_company_id,upper(trim(p_code)),trim(p_name),p_jurisdiction,p_calculation_method,coalesce(p_default_rate,0),p_due_day,p_supplier_id,p_status,nullif(trim(coalesce(p_notes,'')),''),auth.uid(),auth.uid())
    returning id into v_id;
  else
    update public.finance_tax_types set
      code=upper(trim(p_code)),name=trim(p_name),jurisdiction=p_jurisdiction,calculation_method=p_calculation_method,
      default_rate=coalesce(p_default_rate,0),due_day=p_due_day,supplier_id=p_supplier_id,status=p_status,
      notes=nullif(trim(coalesce(p_notes,'')),''),updated_by=auth.uid(),updated_at=now()
    where id=p_tax_type_id and company_id=p_company_id returning id into v_id;
    if v_id is null then raise exception 'Tributo não encontrado.'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.save_finance_tax_obligation(
  p_company_id uuid,p_obligation_id uuid,p_project_id uuid,p_legal_entity_id uuid,p_tax_type_id uuid,p_supplier_id uuid,
  p_competence date,p_due_date date,p_principal_amount numeric,p_penalty_amount numeric,p_interest_amount numeric,p_other_amount numeric,
  p_document_number text,p_barcode text,p_source_type text,p_source_id text,p_notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_total numeric(18,2); v_existing public.finance_tax_obligations%rowtype; begin
  if not public.has_company_permission(p_company_id,'finance.taxes.manage') then raise exception 'Sem permissão para preparar obrigações fiscais.'; end if;
  if p_competence is null or p_due_date is null then raise exception 'Informe competência e vencimento.'; end if;
  p_competence:=date_trunc('month',p_competence)::date;
  v_total:=round(coalesce(p_principal_amount,0)+coalesce(p_penalty_amount,0)+coalesce(p_interest_amount,0)+coalesce(p_other_amount,0),2);
  if coalesce(p_principal_amount,0)<0 or coalesce(p_penalty_amount,0)<0 or coalesce(p_interest_amount,0)<0 or coalesce(p_other_amount,0)<0 or v_total<=0 then raise exception 'Os valores da obrigação são inválidos.'; end if;
  if not exists(select 1 from public.finance_tax_types where id=p_tax_type_id and company_id=p_company_id and status='active') then raise exception 'Tributo inválido ou inativo.'; end if;
  if not exists(select 1 from public.suppliers where id=p_supplier_id and company_id=p_company_id and status='active') then raise exception 'Órgão ou favorecido inválido.'; end if;
  if p_project_id is not null and not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id and status<>'archived') then raise exception 'Empreendimento inválido.'; end if;
  if p_legal_entity_id is not null and not exists(select 1 from public.legal_entities where id=p_legal_entity_id and company_id=p_company_id and status='active') then raise exception 'Empresa ou SPE inválida.'; end if;

  if p_obligation_id is null then
    insert into public.finance_tax_obligations(
      company_id,project_id,legal_entity_id,tax_type_id,supplier_id,competence,due_date,
      principal_amount,penalty_amount,interest_amount,other_amount,total_amount,document_number,barcode,
      source_type,source_id,status,notes,created_by,updated_by
    ) values(
      p_company_id,p_project_id,p_legal_entity_id,p_tax_type_id,p_supplier_id,p_competence,p_due_date,
      coalesce(p_principal_amount,0),coalesce(p_penalty_amount,0),coalesce(p_interest_amount,0),coalesce(p_other_amount,0),v_total,
      nullif(trim(coalesce(p_document_number,'')),''),nullif(trim(coalesce(p_barcode,'')),''),coalesce(nullif(trim(coalesce(p_source_type,'')),''),'manual'),
      nullif(trim(coalesce(p_source_id,'')),''),'draft',nullif(trim(coalesce(p_notes,'')),''),auth.uid(),auth.uid()
    ) returning id into v_id;
  else
    select * into v_existing from public.finance_tax_obligations where id=p_obligation_id and company_id=p_company_id for update;
    if not found then raise exception 'Obrigação fiscal não encontrada.'; end if;
    if v_existing.status<>'draft' then raise exception 'Somente obrigações em preparação podem ser alteradas.'; end if;
    update public.finance_tax_obligations set
      project_id=p_project_id,legal_entity_id=p_legal_entity_id,tax_type_id=p_tax_type_id,supplier_id=p_supplier_id,
      competence=p_competence,due_date=p_due_date,principal_amount=coalesce(p_principal_amount,0),penalty_amount=coalesce(p_penalty_amount,0),
      interest_amount=coalesce(p_interest_amount,0),other_amount=coalesce(p_other_amount,0),total_amount=v_total,
      document_number=nullif(trim(coalesce(p_document_number,'')),''),barcode=nullif(trim(coalesce(p_barcode,'')),''),
      source_type=coalesce(nullif(trim(coalesce(p_source_type,'')),''),'manual'),source_id=nullif(trim(coalesce(p_source_id,'')),''),
      notes=nullif(trim(coalesce(p_notes,'')),''),updated_by=auth.uid(),updated_at=now()
    where id=p_obligation_id returning id into v_id;
  end if;
  return v_id;
end; $$;

create or replace function public.generate_finance_tax_payable(p_company_id uuid,p_obligation_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_obligation public.finance_tax_obligations%rowtype; v_tax public.finance_tax_types%rowtype; v_payable_id uuid; v_payable_status text; begin
  if not public.has_company_permission(p_company_id,'finance.taxes.approve') then raise exception 'Sem permissão para aprovar obrigações fiscais.'; end if;
  select * into v_obligation from public.finance_tax_obligations where id=p_obligation_id and company_id=p_company_id for update;
  if not found then raise exception 'Obrigação fiscal não encontrada.'; end if;
  if v_obligation.status='paid' then return v_obligation.payable_id; end if;
  if v_obligation.status='cancelled' then raise exception 'A obrigação está cancelada.'; end if;
  if v_obligation.project_id is null then raise exception 'Selecione um empreendimento antes de enviar a guia ao Contas a Pagar.'; end if;
  select * into v_tax from public.finance_tax_types where id=v_obligation.tax_type_id and company_id=p_company_id;

  if v_obligation.payable_id is not null then
    select status into v_payable_status from public.payables where id=v_obligation.payable_id and company_id=p_company_id for update;
    if v_payable_status='paid' then
      update public.finance_tax_obligations set status='paid',paid_at=(select paid_at from public.payables where id=v_obligation.payable_id),updated_at=now() where id=v_obligation.id;
      return v_obligation.payable_id;
    elsif v_payable_status='open' then
      update public.finance_tax_obligations set status='open',updated_at=now() where id=v_obligation.id;
      return v_obligation.payable_id;
    elsif v_payable_status='cancelled' then
      update public.payables set
        project_id=v_obligation.project_id,supplier_id=v_obligation.supplier_id,document=coalesce(v_obligation.document_number,v_tax.code),
        fiscal_class='Impostos',due_date=v_obligation.due_date,amount=v_obligation.total_amount,status='open',paid_at=null,
        installment_label=v_tax.code||' · '||to_char(v_obligation.competence,'MM/YYYY'),
        notes=concat_ws(' · ',v_tax.name,v_obligation.notes),updated_at=now()
      where id=v_obligation.payable_id
      returning id into v_payable_id;
    end if;
  end if;

  if v_payable_id is null then
    insert into public.payables(
      company_id,project_id,supplier_id,document,fiscal_class,due_date,amount,status,installment_label,notes,
      origin,source_system,source_id,created_by
    ) values(
      p_company_id,v_obligation.project_id,v_obligation.supplier_id,coalesce(v_obligation.document_number,v_tax.code),'Impostos',
      v_obligation.due_date,v_obligation.total_amount,'open',v_tax.code||' · '||to_char(v_obligation.competence,'MM/YYYY'),
      concat_ws(' · ',v_tax.name,v_obligation.notes),'tax_obligation','elos_os','tax_'||v_obligation.id::text,auth.uid()
    ) returning id into v_payable_id;
  end if;

  update public.finance_tax_obligations set payable_id=v_payable_id,status='open',paid_at=null,updated_by=auth.uid(),updated_at=now()
  where id=v_obligation.id;
  return v_payable_id;
end; $$;

create or replace function public.cancel_finance_tax_obligation(p_company_id uuid,p_obligation_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare v_obligation public.finance_tax_obligations%rowtype; begin
  if not public.has_company_permission(p_company_id,'finance.taxes.cancel') then raise exception 'Sem permissão para cancelar obrigações fiscais.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into v_obligation from public.finance_tax_obligations where id=p_obligation_id and company_id=p_company_id for update;
  if not found then raise exception 'Obrigação fiscal não encontrada.'; end if;
  if v_obligation.status='paid' then raise exception 'Uma obrigação paga não pode ser cancelada por esta tela.'; end if;
  if v_obligation.status='cancelled' then return; end if;

  if v_obligation.payable_id is not null then
    update public.payables set status='cancelled',updated_at=now()
    where id=v_obligation.payable_id and company_id=p_company_id and status='open';
  end if;

  update public.finance_tax_obligations set
    status='cancelled',cancellation_reason=trim(p_reason),cancelled_by=auth.uid(),cancelled_at=now(),updated_by=auth.uid(),updated_at=now()
  where id=v_obligation.id;
end; $$;

create or replace function public.sync_finance_tax_obligation_from_payable()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='paid' then
    update public.finance_tax_obligations set status='paid',paid_at=new.paid_at,updated_at=now()
    where payable_id=new.id and status<>'cancelled';
  elsif new.status='open' then
    update public.finance_tax_obligations set status='open',paid_at=null,updated_at=now()
    where payable_id=new.id and status<>'cancelled';
  elsif new.status='cancelled' then
    update public.finance_tax_obligations set status='draft',paid_at=null,updated_at=now()
    where payable_id=new.id and status not in('paid','cancelled');
  end if;
  return new;
end; $$;

drop trigger if exists finance_tax_obligation_payable_sync on public.payables;
create trigger finance_tax_obligation_payable_sync
after update of status,paid_at on public.payables
for each row when(old.status is distinct from new.status or old.paid_at is distinct from new.paid_at)
execute function public.sync_finance_tax_obligation_from_payable();

grant execute on function public.save_finance_tax_type(uuid,uuid,text,text,text,text,numeric,integer,uuid,text,text) to authenticated;
grant execute on function public.save_finance_tax_obligation(uuid,uuid,uuid,uuid,uuid,uuid,date,date,numeric,numeric,numeric,numeric,text,text,text,text,text) to authenticated;
grant execute on function public.generate_finance_tax_payable(uuid,uuid) to authenticated;
grant execute on function public.cancel_finance_tax_obligation(uuid,uuid,text) to authenticated;

commit;
