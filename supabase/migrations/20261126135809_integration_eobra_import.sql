-- Elos OS: importação eObra revisada, isolada por empresa, sem sobrescrever a operação.
begin;

create or replace function public.eobra_import_can_manage(p_company_id uuid, p_kind text)
returns boolean language sql stable security invoker set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and public.is_company_member(p_company_id)
    and public.has_company_permission(p_company_id, 'admin.company.manage')
    and public.has_company_permission(p_company_id, case p_kind
      when 'supplier' then 'suppliers.manage' when 'client' then 'clients.manage'
      when 'payable' then 'payables.manage' when 'receivable' then 'receivables.manage'
      else '__invalid_import_entity__' end);
$$;

create or replace function public.eobra_import_hash(p_value jsonb)
returns text language sql immutable security invoker set search_path = pg_catalog
as $$ select encode(sha256(convert_to(p_value::text, 'UTF8')), 'hex'); $$;

create or replace function public.eobra_import_payload_hash(p_value jsonb)
returns text language sql immutable security invoker set search_path = pg_catalog, public
as $$ select public.eobra_import_hash(p_value - array['supplier_id','sale_id','client_id','unit_id','resolved_counterparty_name','resolved_sale_number']); $$;

create or replace function public.eobra_import_money(p_value text)
returns numeric language sql immutable security invoker set search_path = pg_catalog
as $$ select case when p_value ~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then p_value::numeric else null end; $$;

create or replace function public.eobra_import_date(p_value text)
returns date language plpgsql immutable security invoker set search_path = pg_catalog
as $$
declare v_date date;
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  v_date := p_value::date;
  if to_char(v_date, 'YYYY-MM-DD') <> p_value then return null; end if;
  return v_date;
exception when datetime_field_overflow or invalid_datetime_format then return null;
end;
$$;

create or replace function public.eobra_import_uuid(p_value text)
returns uuid language sql immutable security invoker set search_path = pg_catalog
as $$ select case when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_value::uuid else null end; $$;

create or replace function public.eobra_import_tax_id_valid(p_value text)
returns boolean language plpgsql immutable security invoker set search_path = pg_catalog
as $$
declare d text := regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g'); a integer; b integer; i integer; s integer;
begin
  if nullif(btrim(p_value),'') is null then return true; end if;
  if p_value !~ '^[0-9./[:space:]-]+$' then return false; end if;
  if length(d) not in (11,14) or d ~ '^([0-9])\1+$' then return false; end if;
  if length(d)=11 then
    s:=0; for i in 1..9 loop s:=s+substr(d,i,1)::int*(11-i); end loop;
    a:=(s*10)%11; if a=10 then a:=0; end if;
    s:=0; for i in 1..9 loop s:=s+substr(d,i,1)::int*(12-i); end loop; s:=s+a*2;
    b:=(s*10)%11; if b=10 then b:=0; end if;
    return right(d,2)=a::text||b::text;
  end if;
  s:=0; for i in 1..12 loop s:=s+substr(d,i,1)::int*(case when i<=4 then 6-i else 14-i end); end loop;
  a:=s%11; a:=case when a<2 then 0 else 11-a end;
  s:=0; for i in 1..12 loop s:=s+substr(d,i,1)::int*(case when i<=5 then 7-i else 15-i end); end loop; s:=s+a*2;
  b:=s%11; b:=case when b<2 then 0 else 11-b end;
  return right(d,2)=a::text||b::text;
end;
$$;

create table public.integration_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id),
  scope_id uuid generated always as (coalesce(project_id, company_id)) stored,
  source_system text not null default 'eobra' check (source_system='eobra'),
  source_host text not null check (source_host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.eobra\.com\.br$'),
  entity_kind text not null check (entity_kind in ('supplier','client','payable','receivable')),
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  sheet_name text not null default '' check (length(sheet_name)<=255),
  reference_date date,
  mapping jsonb not null check (jsonb_typeof(mapping)='object'),
  status text not null default 'review' check (status in ('review','ready','imported','cancelled')),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary)='object'),
  promotion_result jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  promoted_by uuid references auth.users(id), promoted_at timestamptz,
  cancelled_by uuid references auth.users(id), cancelled_at timestamptz,
  check ((entity_kind in ('supplier','client') and project_id is null)
    or (entity_kind in ('payable','receivable') and project_id is not null))
);

create table public.integration_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.integration_import_batches(id),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id),
  source_row integer not null check (source_row>0),
  external_id text check (external_id is null or length(btrim(external_id)) between 1 and 200),
  raw_data jsonb not null check (jsonb_typeof(raw_data)='object'),
  normalized_data jsonb not null check (jsonb_typeof(normalized_data)='object'),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors)='array'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings)='array'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('ready','blocked','duplicate','conflict','imported')),
  target_id uuid,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(batch_id, source_row)
);

create table public.integration_import_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id),
  scope_id uuid generated always as (coalesce(project_id, company_id)) stored,
  source_host text not null,
  entity_kind text not null check (entity_kind in ('supplier','client','payable','receivable')),
  external_id text not null check (length(btrim(external_id)) between 1 and 200),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  target_id uuid not null,
  canonical_table text not null check (canonical_table in ('suppliers','clients','payables','receivables')),
  batch_id uuid not null references public.integration_import_batches(id),
  row_id uuid not null references public.integration_import_rows(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,source_host,entity_kind,scope_id,external_id),
  check ((entity_kind in ('supplier','client') and project_id is null)
    or (entity_kind in ('payable','receivable') and project_id is not null))
);

create index integration_import_batches_company_idx on public.integration_import_batches(company_id,created_at desc);
create unique index integration_import_batches_attempt_uq on public.integration_import_batches(company_id,fingerprint,input_hash) where status<>'cancelled';
create index integration_import_batches_source_idx on public.integration_import_batches(company_id,fingerprint,created_at desc);
create index integration_import_rows_batch_idx on public.integration_import_rows(batch_id,status,source_row);
create index integration_import_records_target_idx on public.integration_import_records(company_id,canonical_table,target_id);

alter table public.integration_import_batches enable row level security;
alter table public.integration_import_rows enable row level security;
alter table public.integration_import_records enable row level security;

create policy integration_import_batches_access on public.integration_import_batches for all to authenticated
using(public.eobra_import_can_manage(company_id,entity_kind))
with check(public.eobra_import_can_manage(company_id,entity_kind));
create policy integration_import_rows_access on public.integration_import_rows for all to authenticated
using(exists(select 1 from public.integration_import_batches b where b.id=batch_id and b.company_id=integration_import_rows.company_id and b.project_id is not distinct from integration_import_rows.project_id and public.eobra_import_can_manage(b.company_id,b.entity_kind)))
with check(exists(select 1 from public.integration_import_batches b where b.id=batch_id and b.company_id=integration_import_rows.company_id and b.project_id is not distinct from integration_import_rows.project_id and public.eobra_import_can_manage(b.company_id,b.entity_kind)));
create policy integration_import_records_select on public.integration_import_records for select to authenticated
using(public.eobra_import_can_manage(company_id,entity_kind));
create policy integration_import_records_insert on public.integration_import_records for insert to authenticated
with check(public.eobra_import_can_manage(company_id,entity_kind) and created_by=auth.uid());

revoke all on public.integration_import_batches,public.integration_import_rows,public.integration_import_records from public,anon,authenticated;
grant select,insert,update on public.integration_import_batches,public.integration_import_rows to authenticated;
grant select,insert on public.integration_import_records to authenticated;

-- Revalida campos financeiros e todos os vínculos mesmo que o parser tenha sido contornado.
create or replace function public.eobra_import_row_errors(p_company_id uuid,p_project_id uuid,p_kind text,p_external_id text,p_data jsonb)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public
as $$
declare e jsonb:='[]'; k text; n numeric; original numeric; current_value numeric; paid numeric; balance numeric; adjustment numeric:=0; v_id uuid; v_count integer; v_tax text;
begin
  if not public.eobra_import_can_manage(p_company_id,p_kind) then raise exception 'Sem permissão para importar dados desta empresa.' using errcode='42501'; end if;
  if nullif(btrim(p_external_id),'') is null then e:=e||jsonb_build_array('ID de origem obrigatório.'); end if;
  if p_project_id is not null and not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id) then e:=e||jsonb_build_array('Obra não pertence à empresa.'); end if;
  if p_kind in ('supplier','client') then
    if nullif(btrim(p_data->>'name'),'') is null then e:=e||jsonb_build_array('Nome obrigatório.'); end if;
    if coalesce(p_data->>'status','') not in ('active','inactive') then e:=e||jsonb_build_array('Situação do cadastro inválida.'); end if;
    if coalesce(p_data->>'person_type','') not in ('company','individual','other','PF','PJ','OTHER') then e:=e||jsonb_build_array('Tipo de pessoa inválido.'); end if;
    v_tax:=nullif(regexp_replace(coalesce(p_data->>'tax_id',''),'[^0-9]','','g'),'');
    if not public.eobra_import_tax_id_valid(p_data->>'tax_id') then e:=e||jsonb_build_array('CPF/CNPJ inválido.'); end if;
    if v_tax is not null then
      if p_kind='supplier' then select count(*) into v_count from public.suppliers where company_id=p_company_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=v_tax;
      else select count(*) into v_count from public.clients where company_id=p_company_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=v_tax; end if;
      if v_count>1 then e:=e||jsonb_build_array('Mais de um cadastro existente possui o CPF/CNPJ.'); end if;
    end if;
    return e;
  end if;
  if p_project_id is null then e:=e||jsonb_build_array('Obra obrigatória para títulos financeiros.'); end if;
  if nullif(btrim(p_data->>'description'),'') is null and nullif(btrim(p_data->>'document'),'') is null then e:=e||jsonb_build_array('Descrição ou documento obrigatório.'); end if;
  if public.eobra_import_date(p_data->>'due_date') is null then e:=e||jsonb_build_array('Vencimento inválido.'); end if;
  foreach k in array array['original_amount','current_amount','paid_amount','balance_amount'] loop
    if public.eobra_import_money(p_data->>k) is null then e:=e||jsonb_build_array('Valor monetário inválido: '||k||'.'); end if;
  end loop;
  original:=public.eobra_import_money(p_data->>'original_amount'); current_value:=public.eobra_import_money(p_data->>'current_amount');
  paid:=public.eobra_import_money(p_data->>'paid_amount'); balance:=public.eobra_import_money(p_data->>'balance_amount');
  foreach k in array array['interest_amount','penalty_amount','correction_amount','other_accrual_amount','discount_amount'] loop
    if nullif(p_data->>k,'') is not null then
      n:=public.eobra_import_money(p_data->>k);
      if n is null then e:=e||jsonb_build_array('Componente monetário inválido: '||k||'.');
      else adjustment:=adjustment+(case when k='discount_amount' then -n else n end); end if;
    end if;
  end loop;
  if original is not null and current_value is not null and current_value<>original+adjustment then e:=e||jsonb_build_array('Valor atual não confere com valor original e ajustes.'); end if;
  if p_kind='payable' and current_value is not null and original is not null and current_value<>original then e:=e||jsonb_build_array('Conta a pagar com ajuste exige revisão antes da promoção.'); end if;
  if coalesce(p_data->>'status','') not in ('open','paid','cancelled') then e:=e||jsonb_build_array('Pagamento parcial ou situação desconhecida exige revisão.'); end if;
  if p_data->>'status'='open' and (paid<>0 or balance<>current_value) then e:=e||jsonb_build_array('Título aberto deve ter saldo integral e nenhuma baixa.'); end if;
  if p_data->>'status'='paid' then
    if paid<=0 or paid<>current_value or balance<>0 then e:=e||jsonb_build_array('Título quitado não reconcilia valor pago e saldo.'); end if;
    if public.eobra_import_date(p_data->>'paid_at') is null then e:=e||jsonb_build_array('Data de quitação obrigatória para título pago.'); end if;
  end if;
  if nullif(p_data->>'paid_at','') is not null and public.eobra_import_date(p_data->>'paid_at') is null then e:=e||jsonb_build_array('Data de pagamento inválida.'); end if;
  if p_data->>'status'='open' and nullif(p_data->>'paid_at','') is not null then e:=e||jsonb_build_array('Título aberto com data de baixa exige revisão.'); end if;
  if p_data->>'status'='cancelled' and (paid<>0 or nullif(p_data->>'paid_at','') is not null) then e:=e||jsonb_build_array('Título cancelado com baixa exige revisão.'); end if;
  if p_data->>'status'='cancelled' and balance<>0 then e:=e||jsonb_build_array('Título cancelado deve ter saldo zero.'); end if;
  if p_kind='payable' then
    v_id:=public.eobra_import_uuid(p_data->>'supplier_id');
    if nullif(p_data->>'supplier_id','') is not null and (v_id is null or not exists(select 1 from public.suppliers where id=v_id and company_id=p_company_id)) then e:=e||jsonb_build_array('Fornecedor não pertence à empresa.'); end if;
    v_tax:=nullif(regexp_replace(coalesce(p_data->>'counterparty_tax_id',''),'[^0-9]','','g'),'');
    if not public.eobra_import_tax_id_valid(p_data->>'counterparty_tax_id') then e:=e||jsonb_build_array('CPF/CNPJ do favorecido inválido.'); end if;
    if v_id is not null and v_tax is not null and not exists(select 1 from public.suppliers where id=v_id and company_id=p_company_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=v_tax) then e:=e||jsonb_build_array('Documento do fornecedor não corresponde ao vínculo revisado.'); end if;
    if v_id is null and nullif(btrim(p_data->>'counterparty_name'),'') is null then e:=e||jsonb_build_array('Fornecedor ou favorecido obrigatório.'); end if;
  else
    if coalesce(p_data->>'category','') not in ('entry','monthly','reinforcement','keys','post_keys','other') then e:=e||jsonb_build_array('Categoria de recebível inválida.'); end if;
    if not exists(
      select 1 from public.sales s join public.clients c on c.id=s.client_id and c.company_id=s.company_id
      join public.units u on u.id=s.unit_id and u.company_id=s.company_id and u.project_id=s.project_id
      where s.id=public.eobra_import_uuid(p_data->>'sale_id') and s.company_id=p_company_id and s.project_id=p_project_id
      and s.client_id=public.eobra_import_uuid(p_data->>'client_id') and s.unit_id=public.eobra_import_uuid(p_data->>'unit_id')
      and s.status='active'
      and (nullif(regexp_replace(coalesce(p_data->>'counterparty_tax_id',''),'[^0-9]','','g'),'') is null
        or regexp_replace(coalesce(c.tax_id,''),'[^0-9]','','g')=regexp_replace(p_data->>'counterparty_tax_id','[^0-9]','','g'))
    ) then e:=e||jsonb_build_array('Venda, cliente e unidade reais da mesma empresa e obra são obrigatórios.'); end if;
    if not public.eobra_import_tax_id_valid(p_data->>'counterparty_tax_id') then e:=e||jsonb_build_array('CPF/CNPJ do cliente inválido.'); end if;
  end if;
  return e;
end;
$$;

create or replace function public.eobra_import_target_exists(p_company_id uuid,p_project_id uuid,p_kind text,p_target_id uuid)
returns boolean language plpgsql stable security invoker set search_path=pg_catalog,public
as $$
begin
  if p_kind='supplier' then return exists(select 1 from public.suppliers where id=p_target_id and company_id=p_company_id);
  elsif p_kind='client' then return exists(select 1 from public.clients where id=p_target_id and company_id=p_company_id);
  elsif p_kind='payable' then return exists(select 1 from public.payables where id=p_target_id and company_id=p_company_id and project_id=p_project_id);
  elsif p_kind='receivable' then return exists(select 1 from public.receivables where id=p_target_id and company_id=p_company_id and project_id=p_project_id);
  end if;
  return false;
end;
$$;

create or replace function public.eobra_import_existing_source(p_company_id uuid,p_kind text,p_source_id text)
returns uuid language plpgsql stable security invoker set search_path=pg_catalog,public
as $$
declare v uuid;
begin
  if p_kind='supplier' then select id into v from public.suppliers where company_id=p_company_id and source_system='eobra' and source_id=p_source_id;
  elsif p_kind='client' then select id into v from public.clients where company_id=p_company_id and source_system='eobra' and source_id=p_source_id;
  elsif p_kind='payable' then select id into v from public.payables where company_id=p_company_id and source_system='eobra' and source_id=p_source_id;
  elsif p_kind='receivable' then select id into v from public.receivables where company_id=p_company_id and source_system='eobra' and source_id=p_source_id;
  end if;
  return v;
end;
$$;

create or replace function public.eobra_import_guard_batch()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$
begin
  if not public.eobra_import_can_manage(new.company_id,new.entity_kind) then raise exception 'Sem permissão para importar.' using errcode='42501'; end if;
  if new.project_id is not null and not exists(select 1 from public.projects where id=new.project_id and company_id=new.company_id) then raise exception 'Obra não pertence à empresa.'; end if;
  if tg_op='INSERT' then
    if new.status<>'review' or new.promotion_result is not null or new.promoted_by is not null or new.promoted_at is not null or new.cancelled_by is not null or new.cancelled_at is not null then raise exception 'Novo lote deve iniciar em revisão.'; end if;
    if new.summary<>'{}'::jsonb then raise exception 'Resumo deve ser calculado a partir das linhas do lote.'; end if;
    new.created_by:=auth.uid(); new.created_at:=now();
  else
    if old.status in ('imported','cancelled') then raise exception 'Lote encerrado não pode ser alterado.'; end if;
    if (to_jsonb(new)-array['scope_id','status','preview_hash','summary','promotion_result','updated_at','promoted_by','promoted_at','cancelled_by','cancelled_at']) is distinct from (to_jsonb(old)-array['scope_id','status','preview_hash','summary','promotion_result','updated_at','promoted_by','promoted_at','cancelled_by','cancelled_at']) then raise exception 'Origem e conteúdo do lote são imutáveis.'; end if;
    if new.status='imported' and (new.promotion_result is null or exists(select 1 from public.integration_import_rows where batch_id=new.id and status not in ('imported','duplicate'))) then raise exception 'Lote possui linhas não importadas.'; end if;
    if new.status='imported' then
      -- Mantém a fotografia que a pessoa confirmou, anterior às mudanças de status/alvo.
      new.summary:=old.summary; new.preview_hash:=old.preview_hash;
      new.promoted_by:=auth.uid(); new.promoted_at:=now();
    else
      -- Campos derivados nunca aceitam valores enviados por UPDATE direto à Data API.
      new.summary:=public.eobra_import_summary(new.id);
      new.preview_hash:=public.eobra_import_preview_hash(new.id);
      if new.status='ready' and ((new.summary->>'blocked')::integer+(new.summary->>'conflicts')::integer>0 or (new.summary->>'total')::integer=0) then raise exception 'Lote com pendências não pode ficar pronto.'; end if;
    end if;
    if new.status='cancelled' then new.cancelled_by:=auth.uid(); new.cancelled_at:=now(); end if;
  end if;
  new.updated_at:=now(); return new;
end;
$$;

create or replace function public.eobra_import_guard_row()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$
declare b public.integration_import_batches%rowtype;
begin
  select * into b from public.integration_import_batches where id=new.batch_id for update;
  if not found or b.company_id<>new.company_id or b.project_id is distinct from new.project_id then raise exception 'Linha e lote devem pertencer à mesma empresa e obra.'; end if;
  if not public.eobra_import_can_manage(b.company_id,b.entity_kind) then raise exception 'Sem permissão para importar.' using errcode='42501'; end if;
  if b.status in ('imported','cancelled') then raise exception 'Lote encerrado não pode ser alterado.'; end if;
  if tg_op='INSERT' then new.created_by:=auth.uid(); new.created_at:=now();
  elsif (to_jsonb(new)-array['status','target_id','updated_at']) is distinct from (to_jsonb(old)-array['status','target_id','updated_at']) then raise exception 'Conteúdo da linha é imutável; envie novo lote para revisar.'; end if;
  if exists(select 1 from jsonb_array_elements(new.errors) x where jsonb_typeof(x)<>'string') or exists(select 1 from jsonb_array_elements(new.warnings) x where jsonb_typeof(x)<>'string') then raise exception 'Erros e avisos devem ser listas de texto.'; end if;
  if new.payload_hash<>public.eobra_import_payload_hash(new.normalized_data) then raise exception 'Hash da linha inválido.'; end if;
  if new.status in ('imported','duplicate') and not exists(select 1 from public.integration_import_records r where r.company_id=b.company_id and r.source_host=b.source_host and r.entity_kind=b.entity_kind and r.scope_id=b.scope_id and r.external_id=new.external_id and r.payload_hash=new.payload_hash and r.target_id=new.target_id) then raise exception 'Linha sem registro de importação correspondente.'; end if;
  new.updated_at:=now(); return new;
end;
$$;

create or replace function public.eobra_import_guard_record()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$
declare b public.integration_import_batches%rowtype; r public.integration_import_rows%rowtype; v_source text; v_tax text; v_valid boolean:=false;
begin
  if not public.eobra_import_can_manage(new.company_id,new.entity_kind) then raise exception 'Sem permissão para importar.' using errcode='42501'; end if;
  select * into b from public.integration_import_batches where id=new.batch_id;
  select * into r from public.integration_import_rows where id=new.row_id and batch_id=new.batch_id;
  if b.id is null or r.id is null or b.company_id<>new.company_id or b.project_id is distinct from new.project_id or b.source_host<>new.source_host or b.entity_kind<>new.entity_kind or r.external_id is distinct from new.external_id or r.payload_hash<>new.payload_hash then raise exception 'Registro de importação não corresponde ao lote e à linha.'; end if;
  if new.canonical_table <> (case new.entity_kind when 'supplier' then 'suppliers' when 'client' then 'clients' when 'payable' then 'payables' else 'receivables' end) then raise exception 'Tabela de destino inválida.'; end if;
  if not public.eobra_import_target_exists(new.company_id,new.project_id,new.entity_kind,new.target_id) then raise exception 'Destino não pertence à empresa e obra.'; end if;
  if b.status<>'ready' or r.status<>'ready' or jsonb_array_length(r.errors)>0 or jsonb_array_length(public.eobra_import_row_errors(b.company_id,b.project_id,b.entity_kind,r.external_id,r.normalized_data))>0 then raise exception 'Somente linhas revisadas e válidas podem ser registradas.'; end if;
  v_source:=b.source_host||'|'||b.scope_id::text||'|'||r.external_id;
  v_tax:=nullif(regexp_replace(coalesce(r.normalized_data->>'tax_id',''),'[^0-9]','','g'),'');
  if b.entity_kind='supplier' then
    select ((s.source_system='eobra' and s.source_id=v_source) or (v_tax is not null and regexp_replace(coalesce(s.tax_id,''),'[^0-9]','','g')=v_tax)) into v_valid from public.suppliers s where s.id=new.target_id and s.company_id=b.company_id;
  elsif b.entity_kind='client' then
    select ((c.source_system='eobra' and c.source_id=v_source) or (v_tax is not null and regexp_replace(coalesce(c.tax_id,''),'[^0-9]','','g')=v_tax)) into v_valid from public.clients c where c.id=new.target_id and c.company_id=b.company_id;
  elsif b.entity_kind='payable' then
    select (p.source_system='eobra' and p.source_id=v_source and p.amount=(r.normalized_data->>'original_amount')::numeric and p.status=r.normalized_data->>'status' and p.due_date=public.eobra_import_date(r.normalized_data->>'due_date') and coalesce(p.paid_amount,0)=(r.normalized_data->>'paid_amount')::numeric) into v_valid from public.payables p where p.id=new.target_id and p.company_id=b.company_id and p.project_id=b.project_id;
  else
    select (p.source_system='eobra' and p.source_id=v_source and p.amount=(r.normalized_data->>'original_amount')::numeric and p.adjusted_amount=(r.normalized_data->>'current_amount')::numeric and p.status=r.normalized_data->>'status' and p.sale_id=public.eobra_import_uuid(r.normalized_data->>'sale_id') and p.client_id=public.eobra_import_uuid(r.normalized_data->>'client_id') and p.unit_id=public.eobra_import_uuid(r.normalized_data->>'unit_id') and coalesce(p.paid_amount,0)=(r.normalized_data->>'paid_amount')::numeric) into v_valid from public.receivables p where p.id=new.target_id and p.company_id=b.company_id and p.project_id=b.project_id;
  end if;
  if v_valid is distinct from true then raise exception 'Destino não corresponde à identidade e aos valores revisados.'; end if;
  new.created_by:=auth.uid(); new.created_at:=now(); new.updated_at:=now(); return new;
end;
$$;

create trigger integration_import_batch_guard before insert or update on public.integration_import_batches for each row execute function public.eobra_import_guard_batch();
create trigger integration_import_row_guard before insert or update on public.integration_import_rows for each row execute function public.eobra_import_guard_row();
create trigger integration_import_record_guard before insert on public.integration_import_records for each row execute function public.eobra_import_guard_record();

create or replace function public.eobra_import_preview_hash(p_batch_id uuid)
returns text language sql stable security invoker set search_path=pg_catalog,public
as $$
  select public.eobra_import_hash(jsonb_build_object('fingerprint',b.fingerprint,'rows',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'source_row',r.source_row,'external_id',r.external_id,'data',r.normalized_data,'errors',r.errors,'warnings',r.warnings,'status',r.status,'target_id',r.target_id) order by r.source_row) from public.integration_import_rows r where r.batch_id=b.id),'[]'::jsonb))) from public.integration_import_batches b where b.id=p_batch_id;
$$;

create or replace function public.eobra_import_summary(p_batch_id uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public
as $$
  select jsonb_build_object('total',count(*),'ready',count(*) filter(where status='ready'),'blocked',count(*) filter(where status='blocked'),'duplicates',count(*) filter(where status='duplicate'),'conflicts',count(*) filter(where status='conflict'),
    'status_counts',coalesce((select jsonb_object_agg(s,n) from (select coalesce(normalized_data->>'status','unknown') s,count(*) n from public.integration_import_rows where batch_id=p_batch_id group by 1) counts),'{}'::jsonb),
    'totals_complete',case when (select entity_kind from public.integration_import_batches where id=p_batch_id) in ('supplier','client') then true else coalesce(bool_and(public.eobra_import_money(normalized_data->>'original_amount') is not null and public.eobra_import_money(normalized_data->>'current_amount') is not null and public.eobra_import_money(normalized_data->>'paid_amount') is not null and public.eobra_import_money(normalized_data->>'balance_amount') is not null),false) end,
    'totals',jsonb_build_object(
      'original_amount',coalesce(sum(public.eobra_import_money(normalized_data->>'original_amount')),0)::numeric(24,2)::text,
      'current_amount',coalesce(sum(public.eobra_import_money(normalized_data->>'current_amount')),0)::numeric(24,2)::text,
      'paid_amount',coalesce(sum(public.eobra_import_money(normalized_data->>'paid_amount')),0)::numeric(24,2)::text,
      'balance_amount',coalesce(sum(public.eobra_import_money(normalized_data->>'balance_amount')),0)::numeric(24,2)::text))
  from public.integration_import_rows where batch_id=p_batch_id;
$$;

create or replace function public.stage_eobra_import(p_company_id uuid,p_project_id uuid,p_source_host text,p_entity_kind text,p_file_name text,p_file_hash text,p_sheet_name text,p_reference_date date,p_mapping jsonb,p_rows jsonb)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public
as $$
declare v_batch uuid; v_fingerprint text; v_input text; v_source_hash text; v_prepared jsonb:='[]'; x jsonb; d jsonb; errs jsonb; warns jsonb; v_external text; v_hash text; v_status text; v_target uuid; v_record public.integration_import_records%rowtype; v_source text; v_summary jsonb; v_ref text; v_count integer; v_tax text; v_existing_name text;
begin
  if not public.eobra_import_can_manage(p_company_id,p_entity_kind) then raise exception 'Sem permissão para importar dados desta empresa.' using errcode='42501'; end if;
  if p_source_host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.eobra\.com\.br$' then raise exception 'Informe somente o subdomínio do eObra, sem protocolo ou caminho.'; end if;
  if p_entity_kind not in ('supplier','client','payable','receivable') or p_entity_kind is null then raise exception 'Entidade inválida.'; end if;
  if jsonb_typeof(p_mapping) is distinct from 'object' then raise exception 'Mapeamento inválido.'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 2000 then raise exception 'O lote deve conter de 1 a 2000 linhas.'; end if;
  if octet_length(p_rows::text)>20000000 then raise exception 'Lote excede o limite de dados.'; end if;
  if p_project_id is not null and not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id) then raise exception 'Obra não pertence à empresa.'; end if;
  if p_entity_kind in ('supplier','client') and p_project_id is not null then raise exception 'Fornecedores e clientes pertencem à empresa; não informe obra.'; end if;
  if p_entity_kind in ('payable','receivable') then
    if p_project_id is null then raise exception 'Selecione a obra dos títulos financeiros.'; end if;
    if p_mapping->>'single_project_confirmed' is distinct from 'true' then raise exception 'Confirme que o arquivo contém somente a obra selecionada.'; end if;
    select count(distinct nullif(lower(regexp_replace(btrim(value->'normalized_data'->>'source_project'),'[[:space:]]+',' ','g')),'')),min(nullif(lower(regexp_replace(btrim(value->'normalized_data'->>'source_project'),'[[:space:]]+',' ','g')),'')) into v_count,v_ref from jsonb_array_elements(p_rows);
    if v_count>1 then raise exception 'O arquivo contém mais de uma obra de origem.'; end if;
    if v_ref is not null and (lower(regexp_replace(btrim(p_mapping->'project_binding'->>'source_reference'),'[[:space:]]+',' ','g')) is distinct from v_ref or public.eobra_import_uuid(p_mapping->'project_binding'->>'project_id') is distinct from p_project_id or p_mapping->'project_binding'->>'confirmed' is distinct from 'true') then raise exception 'Confirme a correspondência entre a obra de origem e a obra selecionada.'; end if;
  end if;
  v_fingerprint:=public.eobra_import_hash(jsonb_build_object('company_id',p_company_id,'project_id',p_project_id,'source_host',p_source_host,'entity_kind',p_entity_kind,'file_hash',p_file_hash,'sheet_name',coalesce(p_sheet_name,''),'reference_date',p_reference_date,'mapping',p_mapping));
  select public.eobra_import_hash(jsonb_agg(jsonb_build_object('source_row',q->'source_row','external_id',q->'external_id','raw_data',q->'raw_data','source_payload_hash',public.eobra_import_payload_hash(q->'normalized_data')) order by ord)) into v_source_hash from jsonb_array_elements(p_rows) with ordinality x(q,ord);
  perform pg_advisory_xact_lock(hashtextextended('eobra:'||p_company_id::text,0));
  if exists(select 1 from public.integration_import_batches where company_id=p_company_id and fingerprint=v_fingerprint and source_hash<>v_source_hash) then raise exception 'Mesmo arquivo e mapeamento foram enviados com conteúdo diferente; revise a origem.'; end if;
  select id into v_batch from public.integration_import_batches where company_id=p_company_id and fingerprint=v_fingerprint and status='imported' order by created_at desc limit 1;
  if found then return v_batch; end if;
  for x in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'raw_data') is distinct from 'object' or jsonb_typeof(x->'normalized_data') is distinct from 'object' or jsonb_typeof(coalesce(x->'errors','[]'::jsonb))<>'array' or jsonb_typeof(coalesce(x->'warnings','[]'::jsonb))<>'array' then raise exception 'Estrutura de linha inválida.'; end if;
    d:=x->'normalized_data'; v_external:=nullif(btrim(x->>'external_id'),'');
    errs:=coalesce(x->'errors','[]'::jsonb)||public.eobra_import_row_errors(p_company_id,p_project_id,p_entity_kind,v_external,d);
    warns:=coalesce(x->'warnings','[]'::jsonb); v_hash:=public.eobra_import_payload_hash(d); v_target:=null;
    if v_external is not null and (select count(*) from jsonb_array_elements(p_rows) q where nullif(btrim(q->>'external_id'),'')=v_external)>1 then errs:=errs||jsonb_build_array('ID de origem repetido no arquivo.'); end if;
    v_status:=case when jsonb_array_length(errs)>0 then 'blocked' else 'ready' end;
    select * into v_record from public.integration_import_records where company_id=p_company_id and source_host=p_source_host and entity_kind=p_entity_kind and scope_id=coalesce(p_project_id,p_company_id) and external_id=v_external;
    if found then
      if v_record.payload_hash=v_hash and public.eobra_import_target_exists(p_company_id,p_project_id,p_entity_kind,v_record.target_id) then
        v_target:=v_record.target_id; if jsonb_array_length(errs)=0 then v_status:='duplicate'; end if;
      else v_status:='conflict'; errs:=errs||jsonb_build_array('Origem já importada com conteúdo diferente ou destino indisponível; nenhum registro será sobrescrito.'); end if;
    else
      v_source:=p_source_host||'|'||coalesce(p_project_id,p_company_id)::text||'|'||v_external;
      if public.eobra_import_existing_source(p_company_id,p_entity_kind,v_source) is not null then v_status:='conflict'; errs:=errs||jsonb_build_array('Cadastro de origem existente sem registro de importação; revise o vínculo.'); end if;
    end if;
    if v_status='ready' and p_entity_kind in ('supplier','client') then
      v_tax:=nullif(regexp_replace(coalesce(d->>'tax_id',''),'[^0-9]','','g'),'');
      v_existing_name:=null;
      if v_tax is not null then
        if p_entity_kind='supplier' then select id,legal_name into v_target,v_existing_name from public.suppliers where company_id=p_company_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=v_tax;
        else select id,name into v_target,v_existing_name from public.clients where company_id=p_company_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=v_tax; end if;
      end if;
      if v_target is not null then warns:=warns||jsonb_build_array('CPF/CNPJ já cadastrado: '||v_existing_name||'. Será vinculado sem alterar os dados existentes.'); end if;
      if v_tax is not null and v_target is null and (select count(*) from jsonb_array_elements(p_rows) q where nullif(regexp_replace(coalesce(q->'normalized_data'->>'tax_id',''),'[^0-9]','','g'),'')=v_tax)>1 then
        errs:=errs||jsonb_build_array('CPF/CNPJ repetido em novos cadastros do arquivo. Consolide os registros antes de importar.');
        v_status:='blocked';
      end if;
    end if;
    v_prepared:=v_prepared||jsonb_build_array(jsonb_build_object('source_row',x->'source_row','external_id',v_external,'raw_data',x->'raw_data','normalized_data',d,'errors',errs,'warnings',warns,'payload_hash',v_hash,'status',v_status,'target_id',v_target));
  end loop;
  v_input:=public.eobra_import_hash(v_prepared);
  select id into v_batch from public.integration_import_batches where company_id=p_company_id and fingerprint=v_fingerprint and input_hash=v_input and status<>'cancelled' order by created_at desc limit 1;
  if found then return v_batch; end if;
  insert into public.integration_import_batches(company_id,project_id,source_host,entity_kind,file_name,file_hash,sheet_name,reference_date,mapping,fingerprint,input_hash,source_hash,preview_hash)
  values(p_company_id,p_project_id,p_source_host,p_entity_kind,p_file_name,p_file_hash,coalesce(p_sheet_name,''),p_reference_date,p_mapping,v_fingerprint,v_input,v_source_hash,v_input) returning id into v_batch;
  insert into public.integration_import_rows(batch_id,company_id,project_id,source_row,external_id,raw_data,normalized_data,errors,warnings,payload_hash,status,target_id)
  select v_batch,p_company_id,p_project_id,(q->>'source_row')::integer,q->>'external_id',q->'raw_data',q->'normalized_data',q->'errors',q->'warnings',q->>'payload_hash',q->>'status',public.eobra_import_uuid(q->>'target_id') from jsonb_array_elements(v_prepared) x(q);
  v_summary:=public.eobra_import_summary(v_batch);
  update public.integration_import_batches set summary=v_summary,preview_hash=public.eobra_import_preview_hash(v_batch),status=case when (v_summary->>'blocked')::int+(v_summary->>'conflicts')::int=0 then 'ready' else 'review' end where id=v_batch;
  return v_batch;
end;
$$;

create or replace function public.promote_eobra_import(p_batch_id uuid,p_preview_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $$
declare b public.integration_import_batches%rowtype; r public.integration_import_rows%rowtype; old_record public.integration_import_records%rowtype; d jsonb; v_errors jsonb; v_source text; v_target uuid; v_tax text; v_count integer; v_created integer:=0; v_reused integer:=0; v_duplicates integer:=0; v_total integer:=0; result jsonb;
begin
  if auth.uid() is null then raise exception 'Usuário não autenticado.' using errcode='42501'; end if;
  select * into b from public.integration_import_batches where id=p_batch_id;
  if not found or not public.eobra_import_can_manage(b.company_id,b.entity_kind) then raise exception 'Lote indisponível ou sem permissão.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('eobra:'||b.company_id::text,0));
  select * into b from public.integration_import_batches where id=p_batch_id for update;
  if b.status='imported' then return b.promotion_result; end if;
  if b.status<>'ready' then raise exception 'Resolva todas as pendências antes de importar o lote.'; end if;
  if p_preview_hash is null or p_preview_hash<>b.preview_hash or p_preview_hash<>public.eobra_import_preview_hash(b.id) then raise exception 'A revisão mudou; atualize a página antes de confirmar.'; end if;
  if b.summary is distinct from public.eobra_import_summary(b.id) then raise exception 'O resumo não corresponde às linhas revisadas; prepare novamente o arquivo.'; end if;
  if not exists(select 1 from public.integration_import_rows where batch_id=b.id) then raise exception 'Lote vazio.'; end if;
  for r in select * from public.integration_import_rows where batch_id=b.id order by source_row for update loop
    if r.company_id<>b.company_id or r.project_id is distinct from b.project_id then raise exception 'Linha fora da empresa/obra do lote.'; end if;
    v_errors:=r.errors||public.eobra_import_row_errors(b.company_id,b.project_id,b.entity_kind,r.external_id,r.normalized_data);
    if jsonb_array_length(v_errors)>0 or r.status not in ('ready','duplicate') then raise exception 'Linha % contém pendência: %',r.source_row,v_errors; end if;
    if r.payload_hash<>public.eobra_import_payload_hash(r.normalized_data) then raise exception 'Conteúdo da linha % foi alterado.',r.source_row; end if;
    v_total:=v_total+1; d:=r.normalized_data; v_target:=null;
    select * into old_record from public.integration_import_records where company_id=b.company_id and source_host=b.source_host and entity_kind=b.entity_kind and scope_id=b.scope_id and external_id=r.external_id;
    if found then
      if old_record.payload_hash<>r.payload_hash or not public.eobra_import_target_exists(b.company_id,b.project_id,b.entity_kind,old_record.target_id) then raise exception 'Origem % já importada com conteúdo diferente; revise sem sobrescrever.',r.external_id; end if;
      update public.integration_import_rows set status='duplicate',target_id=old_record.target_id where id=r.id;
      v_duplicates:=v_duplicates+1; continue;
    end if;
    v_source:=b.source_host||'|'||b.scope_id::text||'|'||r.external_id;
    if public.eobra_import_existing_source(b.company_id,b.entity_kind,v_source) is not null then raise exception 'Origem existente sem registro de importação: %.',r.external_id; end if;
    v_tax:=nullif(regexp_replace(coalesce(d->>'tax_id',''),'[^0-9]','','g'),'');
    if b.entity_kind='supplier' then
      if v_tax is not null then select count(*),min(id::text)::uuid into v_count,v_target from public.suppliers where company_id=b.company_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=v_tax; end if;
      if v_target is distinct from r.target_id then raise exception 'O fornecedor existente mudou após a revisão; prepare novamente o arquivo.'; end if;
      if v_target is null then
        insert into public.suppliers(company_id,person_type,legal_name,tax_id,email,phone,address,city,state,notes,status,source_system,source_id,created_by)
        values(b.company_id,case d->>'person_type' when 'PF' then 'individual' when 'PJ' then 'company' when 'OTHER' then 'other' else d->>'person_type' end,btrim(d->>'name'),v_tax,nullif(d->>'email',''),nullif(d->>'phone',''),nullif(d->>'address',''),nullif(d->>'city',''),nullif(d->>'state',''),nullif(d->>'notes',''),d->>'status','eobra',v_source,auth.uid()) returning id into v_target;
        v_created:=v_created+1;
      else v_reused:=v_reused+1; end if;
    elsif b.entity_kind='client' then
      if v_tax is not null then select count(*),min(id::text)::uuid into v_count,v_target from public.clients where company_id=b.company_id and regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')=v_tax; end if;
      if v_target is distinct from r.target_id then raise exception 'O cliente existente mudou após a revisão; prepare novamente o arquivo.'; end if;
      if v_target is null then
        insert into public.clients(company_id,person_type,name,tax_id,email,phone,address,city,state,notes,status,source_system,source_id,created_by)
        values(b.company_id,case d->>'person_type' when 'individual' then 'PF' when 'company' then 'PJ' when 'other' then 'OTHER' else d->>'person_type' end,btrim(d->>'name'),v_tax,nullif(d->>'email',''),nullif(d->>'phone',''),nullif(d->>'address',''),nullif(d->>'city',''),nullif(d->>'state',''),nullif(d->>'notes',''),d->>'status','eobra',v_source,auth.uid()) returning id into v_target;
        v_created:=v_created+1;
      else v_reused:=v_reused+1; end if;
    elsif b.entity_kind='payable' then
      insert into public.payables(company_id,project_id,supplier_id,document,due_date,amount,status,installment_label,notes,paid_at,paid_amount,paid_account_name,origin,source_system,source_id,beneficiary_name,beneficiary_tax_id,created_by)
      values(b.company_id,b.project_id,public.eobra_import_uuid(d->>'supplier_id'),coalesce(nullif(d->>'document',''),d->>'description'),public.eobra_import_date(d->>'due_date'),(d->>'original_amount')::numeric,d->>'status',nullif(d->>'installment_label',''),nullif(d->>'description',''),case when d->>'status'='paid' then public.eobra_import_date(d->>'paid_at') end,case when d->>'status'='paid' then (d->>'paid_amount')::numeric else null end,nullif(d->>'paid_account_name',''),'historical_import','eobra',v_source,nullif(d->>'counterparty_name',''),nullif(regexp_replace(coalesce(d->>'counterparty_tax_id',''),'[^0-9]','','g'),''),auth.uid()) returning id into v_target;
      v_created:=v_created+1;
    else
      insert into public.receivables(company_id,project_id,sale_id,client_id,unit_id,category,description,due_date,amount,adjusted_amount,status,paid_at,paid_amount,paid_account_name,correction_locked,installment_interest_amount,correction_amount,late_fee_amount,other_accrual_amount,discount_amount,source_system,source_id,created_by)
      values(b.company_id,b.project_id,public.eobra_import_uuid(d->>'sale_id'),public.eobra_import_uuid(d->>'client_id'),public.eobra_import_uuid(d->>'unit_id'),d->>'category',coalesce(nullif(d->>'description',''),d->>'document'),public.eobra_import_date(d->>'due_date'),(d->>'original_amount')::numeric,(d->>'current_amount')::numeric,d->>'status',case when d->>'status'='paid' then public.eobra_import_date(d->>'paid_at') end,case when d->>'status'='paid' then (d->>'paid_amount')::numeric else null end,nullif(d->>'paid_account_name',''),true,coalesce(public.eobra_import_money(d->>'interest_amount'),0),coalesce(public.eobra_import_money(d->>'correction_amount'),0),coalesce(public.eobra_import_money(d->>'penalty_amount'),0),coalesce(public.eobra_import_money(d->>'other_accrual_amount'),0),coalesce(public.eobra_import_money(d->>'discount_amount'),0),'eobra',v_source,auth.uid()) returning id into v_target;
      v_created:=v_created+1;
    end if;
    insert into public.integration_import_records(company_id,project_id,source_host,entity_kind,external_id,payload_hash,target_id,canonical_table,batch_id,row_id)
    values(b.company_id,b.project_id,b.source_host,b.entity_kind,r.external_id,r.payload_hash,v_target,case b.entity_kind when 'supplier' then 'suppliers' when 'client' then 'clients' when 'payable' then 'payables' else 'receivables' end,b.id,r.id);
    update public.integration_import_rows set status='imported',target_id=v_target where id=r.id;
  end loop;
  result:=jsonb_build_object('created',v_created,'reused',v_reused,'duplicates',v_duplicates,'total',v_total);
  update public.integration_import_batches set status='imported',promotion_result=result,promoted_by=auth.uid(),promoted_at=now() where id=b.id;
  return result;
end;
$$;

create or replace function public.cancel_eobra_import(p_batch_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,public
as $$
declare b public.integration_import_batches%rowtype;
begin
  if auth.uid() is null then raise exception 'Usuário não autenticado.' using errcode='42501'; end if;
  select * into b from public.integration_import_batches where id=p_batch_id for update;
  if not found or not public.eobra_import_can_manage(b.company_id,b.entity_kind) then raise exception 'Lote indisponível ou sem permissão.' using errcode='42501'; end if;
  if b.status='cancelled' then return; end if;
  if b.status='imported' then raise exception 'Lote importado não pode ser cancelado.'; end if;
  update public.integration_import_batches set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now() where id=b.id;
end;
$$;

-- Apenas os papéis autenticados recebem funções; todos os RPCs continuam sujeitos a RLS.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'eobra_import_%' or p.proname in ('stage_eobra_import','promote_eobra_import','cancel_eobra_import')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end; $$;

comment on table public.integration_import_batches is 'Arquivos eObra revisados antes de qualquer criação no cadastro e financeiro.';
comment on table public.integration_import_records is 'Identidade permanente da origem; reenvio idêntico não duplica e alteração não sobrescreve dados existentes.';
commit;
