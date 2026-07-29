-- Elos OS — Notas Eletrônicas · memória de associação fornecedor × produto × insumo

begin;

create table if not exists public.finance_supplier_product_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  product_key text not null,
  supplier_product_code text,
  ean text,
  description_snapshot text not null,
  description_normalized text not null,
  input_id uuid not null references public.engineering_inputs(id) on delete restrict,
  use_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,supplier_id,product_key),
  constraint finance_supplier_product_mapping_key_check check(length(trim(product_key))>5),
  constraint finance_supplier_product_mapping_use_count_check check(use_count>0)
);

create index if not exists finance_supplier_product_mappings_supplier_idx
  on public.finance_supplier_product_mappings(company_id,supplier_id,last_used_at desc);
create index if not exists finance_supplier_product_mappings_input_idx
  on public.finance_supplier_product_mappings(company_id,input_id);

alter table public.finance_supplier_product_mappings enable row level security;

drop policy if exists finance_supplier_product_mappings_select on public.finance_supplier_product_mappings;
create policy finance_supplier_product_mappings_select
on public.finance_supplier_product_mappings for select to authenticated
using(
  public.has_company_permission(company_id,'finance.invoices.view') or
  public.has_company_permission(company_id,'finance.invoices.manage') or
  public.has_company_permission(company_id,'finance.invoices.approve')
);

drop policy if exists finance_supplier_product_mappings_write on public.finance_supplier_product_mappings;
create policy finance_supplier_product_mappings_write
on public.finance_supplier_product_mappings for all to authenticated
using(public.has_company_permission(company_id,'finance.invoices.manage'))
with check(public.has_company_permission(company_id,'finance.invoices.manage'));

create or replace function public.remember_finance_supplier_product_mapping(
  p_company_id uuid,
  p_supplier_id uuid,
  p_product_key text,
  p_supplier_product_code text,
  p_ean text,
  p_description text,
  p_description_normalized text,
  p_input_id uuid
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_id uuid;
begin
  if not public.has_company_permission(p_company_id,'finance.invoices.manage') then
    raise exception 'Sem permissão para memorizar associações de produtos.';
  end if;
  if nullif(trim(coalesce(p_product_key,'')),'') is null then
    raise exception 'Chave do produto inválida.';
  end if;
  if not exists(select 1 from public.suppliers where id=p_supplier_id and company_id=p_company_id and status='active') then
    raise exception 'Fornecedor inválido ou inativo.';
  end if;
  if not exists(select 1 from public.engineering_inputs where id=p_input_id and company_id=p_company_id and status='active') then
    raise exception 'Insumo inválido ou inativo.';
  end if;

  insert into public.finance_supplier_product_mappings(
    company_id,supplier_id,product_key,supplier_product_code,ean,description_snapshot,description_normalized,input_id,
    use_count,first_seen_at,last_used_at,created_by,updated_by
  ) values(
    p_company_id,p_supplier_id,trim(p_product_key),nullif(trim(coalesce(p_supplier_product_code,'')),''),
    nullif(trim(coalesce(p_ean,'')),''),coalesce(nullif(trim(coalesce(p_description,'')),''),'Produto sem descrição'),
    coalesce(nullif(trim(coalesce(p_description_normalized,'')),''),'produto-sem-descricao'),p_input_id,
    1,now(),now(),auth.uid(),auth.uid()
  )
  on conflict(company_id,supplier_id,product_key) do update set
    supplier_product_code=excluded.supplier_product_code,
    ean=excluded.ean,
    description_snapshot=excluded.description_snapshot,
    description_normalized=excluded.description_normalized,
    input_id=excluded.input_id,
    use_count=public.finance_supplier_product_mappings.use_count+1,
    last_used_at=now(),updated_by=auth.uid(),updated_at=now()
  returning id into v_id;

  return v_id;
end; $$;

grant select,insert,update,delete on public.finance_supplier_product_mappings to authenticated;
grant execute on function public.remember_finance_supplier_product_mapping(uuid,uuid,text,text,text,text,text,uuid) to authenticated;

commit;
