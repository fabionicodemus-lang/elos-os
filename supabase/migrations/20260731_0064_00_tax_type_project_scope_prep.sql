-- Elos OS — Preparação das regras tributárias por obra
-- Executar imediatamente antes da migration principal 0064.

begin;

alter table public.finance_tax_types
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists retention_key text;

-- O cadastro original exigia código único na empresa inteira. As regras de retenção
-- podem variar por obra, especialmente tributos municipais, portanto o código passa
-- a ser único dentro do escopo global ou do empreendimento.
alter table public.finance_tax_types
  drop constraint if exists finance_tax_types_company_id_code_key;

drop index if exists finance_tax_types_project_code_unique_idx;
create unique index finance_tax_types_project_code_unique_idx
  on public.finance_tax_types(
    company_id,
    coalesce(project_id,'00000000-0000-0000-0000-000000000000'::uuid),
    lower(code)
  );

-- Identifica cadastros conhecidos antes da criação do índice de uma regra ativa por
-- retenção e escopo. Duplicatas antigas permanecem no histórico, mas ficam inativas.
update public.finance_tax_types set retention_key='inss'
where retention_key is null and upper(regexp_replace(code,'[^A-Z0-9]','','g')) in('INSS','INSSRET','INSSRETIDO');
update public.finance_tax_types set retention_key='iss'
where retention_key is null and upper(regexp_replace(code,'[^A-Z0-9]','','g')) in('ISS','ISSQN','ISSRET','ISSRETIDO');
update public.finance_tax_types set retention_key='irrf'
where retention_key is null and upper(regexp_replace(code,'[^A-Z0-9]','','g')) in('IRRF','IRRET','IRRFRETIDO');
update public.finance_tax_types set retention_key='pis'
where retention_key is null and upper(regexp_replace(code,'[^A-Z0-9]','','g')) in('PIS','PISRET','PISRETIDO');
update public.finance_tax_types set retention_key='cofins'
where retention_key is null and upper(regexp_replace(code,'[^A-Z0-9]','','g')) in('COFINS','COFINSRET','COFINSRETIDO');
update public.finance_tax_types set retention_key='csll'
where retention_key is null and upper(regexp_replace(code,'[^A-Z0-9]','','g')) in('CSLL','CSLLRET','CSLLRETIDO');

with ranked as (
  select id,
    row_number() over(
      partition by company_id,coalesce(project_id,'00000000-0000-0000-0000-000000000000'::uuid),retention_key
      order by updated_at desc,created_at desc,id desc
    ) as position
  from public.finance_tax_types
  where retention_key is not null and status='active'
)
update public.finance_tax_types t
set status='inactive',updated_at=now()
from ranked r
where r.id=t.id and r.position>1;

create unique index if not exists finance_tax_types_retention_scope_unique_idx
  on public.finance_tax_types(
    company_id,
    coalesce(project_id,'00000000-0000-0000-0000-000000000000'::uuid),
    retention_key
  )
  where retention_key is not null and status='active';

commit;
