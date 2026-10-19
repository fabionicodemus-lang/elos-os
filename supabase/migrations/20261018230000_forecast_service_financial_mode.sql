-- Elos OS — Previsão financeira: modo por serviço
--
-- Cada serviço do orçamento pode ter a previsão financeira:
--   * 'schedule'      (padrão): saldo do orçamento distribuído pelo cronograma do serviço;
--   * 'payment_plan'  : previsão igual às parcelas do contrato lançadas no contas a pagar
--                       (pagas na data do pagamento, abertas no vencimento). O cronograma continua
--                       controlando o prazo e o avanço físico, mas não distribui gasto desse serviço.
-- Uso típico: contratos de valor global com forma de pagamento própria (esquadrias, elevadores).

begin;

create table if not exists public.forecast_service_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  service_id uuid not null references public.engineering_services(id) on delete cascade,
  financial_mode text not null default 'schedule',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forecast_service_settings_mode_check check (financial_mode in ('schedule', 'payment_plan')),
  constraint forecast_service_settings_unique unique (project_id, service_id)
);

create index if not exists forecast_service_settings_company_project_idx
  on public.forecast_service_settings (company_id, project_id);

comment on table public.forecast_service_settings is
  'Modo da previsão financeira por serviço da obra: pelo cronograma ou pelas parcelas do contrato.';

alter table public.forecast_service_settings enable row level security;

-- Sem exclusão: voltar ao padrão é gravar financial_mode = 'schedule' (fica o histórico de quem mudou).
create policy forecast_service_settings_select on public.forecast_service_settings
  for select using (has_company_permission(company_id, 'schedule.view') or has_company_permission(company_id, 'schedule.manage'));

create policy forecast_service_settings_insert on public.forecast_service_settings
  for insert with check (has_company_permission(company_id, 'schedule.manage'));

create policy forecast_service_settings_update on public.forecast_service_settings
  for update using (has_company_permission(company_id, 'schedule.manage'))
  with check (has_company_permission(company_id, 'schedule.manage'));

grant select, insert, update on public.forecast_service_settings to authenticated;

commit;
