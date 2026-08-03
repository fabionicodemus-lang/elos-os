-- Elos OS — Fase 4 · Configuração da previsão financeira por obra

begin;

alter table public.projects
  add column if not exists forecast_default_payment_days integer not null default 30;

alter table public.projects
  drop constraint if exists projects_forecast_default_payment_days_check;

alter table public.projects
  add constraint projects_forecast_default_payment_days_check
  check (forecast_default_payment_days between 0 and 365);

comment on column public.projects.forecast_default_payment_days is
  'Prazo padrão, em dias corridos, aplicado à camada a comprometer da previsão financeira.';

commit;
