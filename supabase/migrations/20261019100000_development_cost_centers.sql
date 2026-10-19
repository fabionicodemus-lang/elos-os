-- Elos OS — Centros de custo de incorporação
--
-- Além da obra (orçamento analítico), o empreendimento tem custos de incorporação que não precisam
-- de orçamento analítico: terreno, outorga, projetos, comissões, marketing, impostos (RET/PIS/COFINS),
-- administração central, custo financeiro e distratos. Cada um vira um centro de custo (serviço com
-- development_cost_category) e recebe apropriação direta (notas, títulos). O orçado por obra vem do
-- estudo de viabilidade aprovado (baseline) e fica em development_cost_budgets.
-- Esses centros saem da previsão/custo da obra e são controlados no Resultado da incorporação.

begin;

alter table public.engineering_services
  add column if not exists development_cost_category text;

alter table public.engineering_services
  drop constraint if exists engineering_services_development_cost_category_check;
alter table public.engineering_services
  add constraint engineering_services_development_cost_category_check check (
    development_cost_category is null or development_cost_category in (
      'land', 'onerous_grant', 'design', 'commission', 'marketing', 'taxes', 'central_office', 'financial', 'cancellations'
    )
  );

comment on column public.engineering_services.development_cost_category is
  'Preenchido nos centros de custo de incorporação (fora do orçamento de obra). Nulo = serviço de obra.';

create table if not exists public.development_cost_budgets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  service_id uuid not null references public.engineering_services(id) on delete restrict,
  budget_amount numeric(16,2) not null default 0,
  source text not null default 'feasibility',
  source_study_id uuid references public.commercial_feasibility_studies(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint development_cost_budgets_amount_check check (budget_amount >= 0),
  constraint development_cost_budgets_source_check check (source in ('feasibility', 'manual')),
  constraint development_cost_budgets_unique unique (project_id, service_id)
);

create index if not exists development_cost_budgets_company_project_idx
  on public.development_cost_budgets (company_id, project_id);

alter table public.development_cost_budgets enable row level security;

create policy development_cost_budgets_select on public.development_cost_budgets
  for select using (
    has_company_permission(company_id, 'commercial.incorporation.view')
    or has_company_permission(company_id, 'commercial.incorporation.manage')
  );
create policy development_cost_budgets_insert on public.development_cost_budgets
  for insert with check (has_company_permission(company_id, 'commercial.incorporation.manage'));
create policy development_cost_budgets_update on public.development_cost_budgets
  for update using (has_company_permission(company_id, 'commercial.incorporation.manage'))
  with check (has_company_permission(company_id, 'commercial.incorporation.manage'));

grant select, insert, update on public.development_cost_budgets to authenticated;

-- Cria (se faltar) os 9 centros da empresa e grava o orçado da obra a partir do baseline do estudo.
-- Orçados editados manualmente (source = 'manual') não são sobrescritos.
create or replace function public.apply_feasibility_development_budget(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid; v_study uuid; v_metrics jsonb; s record; v_service uuid; v_amount numeric; v_count int := 0; v_total numeric := 0;
begin
  select company_id into v_company from projects where id = p_project_id;
  if v_company is null then raise exception 'Obra não encontrada.'; end if;
  if auth.uid() is not null and not has_company_permission(v_company, 'commercial.incorporation.manage') then
    raise exception 'Sem permissão para gerar os centros de custo de incorporação.';
  end if;

  select baseline_study_id, baseline_metrics into v_study, v_metrics
  from commercial_development_profiles where company_id = v_company and project_id = p_project_id;
  if v_study is null then raise exception 'A obra não tem estudo de viabilidade aprovado (baseline).'; end if;

  for s in
    select x.code, x.description, x.category, x.sort_order,
      case x.category
        when 'land' then coalesce(f.land_cash_amount, 0) + coalesce(f.iptu_amount, 0) + coalesce(f.other_land_amount, 0)
        when 'onerous_grant' then coalesce(f.onerous_grant_amount, 0)
        when 'design' then coalesce((v_metrics->>'design_cost')::numeric, 0)
        when 'commission' then coalesce((v_metrics->>'commission_cost')::numeric, 0)
        when 'marketing' then coalesce(f.marketing_amount, 0)
        when 'taxes' then coalesce((v_metrics->>'tax_cost')::numeric, 0)
        when 'central_office' then coalesce(f.central_office_amount, 0)
        when 'financial' then coalesce(f.financial_cost_amount, 0)
        else 0 end amount
    from (values
      ('INC.01', 'Terreno, ITBI, registro e IPTU', 'land', 1),
      ('INC.02', 'Outorga onerosa', 'onerous_grant', 2),
      ('INC.03', 'Projetos e aprovações', 'design', 3),
      ('INC.04', 'Comissões e corretagem', 'commission', 4),
      ('INC.05', 'Marketing e vendas', 'marketing', 5),
      ('INC.06', 'Impostos da incorporação (RET/PIS/COFINS)', 'taxes', 6),
      ('INC.07', 'Administração central', 'central_office', 7),
      ('INC.08', 'Custo financeiro', 'financial', 8),
      ('INC.09', 'Distratos (devoluções a clientes)', 'cancellations', 9)
    ) x(code, description, category, sort_order)
    cross join commercial_feasibility_studies f
    where f.id = v_study
    order by x.sort_order
  loop
    select id into v_service from engineering_services where company_id = v_company and code = s.code;
    if v_service is null then
      insert into engineering_services(company_id, code, description, unit, group_code, default_method, notes, status, development_cost_category, created_by)
      values (v_company, s.code, s.description, 'vb', 'INC', 'unit',
        'Centro de custo de incorporação (fora do orçamento de obra).', 'active', s.category, auth.uid())
      returning id into v_service;
    else
      update engineering_services set development_cost_category = s.category, updated_at = now()
      where id = v_service and development_cost_category is distinct from s.category;
    end if;

    v_amount := round(greatest(s.amount, 0), 2);
    insert into development_cost_budgets(company_id, project_id, service_id, budget_amount, source, source_study_id, created_by, updated_by)
    values (v_company, p_project_id, v_service, v_amount, 'feasibility', v_study, auth.uid(), auth.uid())
    on conflict (project_id, service_id) do update
      set budget_amount = excluded.budget_amount, source_study_id = excluded.source_study_id, updated_by = excluded.updated_by, updated_at = now()
      where development_cost_budgets.source = 'feasibility';
    v_count := v_count + 1;
    v_total := v_total + v_amount;
  end loop;

  return jsonb_build_object('centros', v_count, 'orcado', v_total);
end;
$$;

revoke all on function public.apply_feasibility_development_budget(uuid) from public, anon;
grant execute on function public.apply_feasibility_development_budget(uuid) to authenticated;

commit;
