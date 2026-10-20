-- Elos OS — Previsão financeira: modo "prazo fixo"
--
-- Serviços de contrato fixo (empreiteiros mensais, equipe, administração) não seguem o cronograma:
-- o saldo (contratado não pago + a contratar até o orçado) é dividido em parcelas mensais iguais
-- entre distribution_start e distribution_end. Títulos já lançados continuam no vencimento.

alter table public.forecast_service_settings
  add column if not exists distribution_start date,
  add column if not exists distribution_end date;

alter table public.forecast_service_settings
  drop constraint if exists forecast_service_settings_mode_check;
alter table public.forecast_service_settings
  add constraint forecast_service_settings_mode_check check (financial_mode in ('schedule', 'payment_plan', 'fixed_term'));

alter table public.forecast_service_settings
  drop constraint if exists forecast_service_settings_fixed_term_dates_check;
alter table public.forecast_service_settings
  add constraint forecast_service_settings_fixed_term_dates_check check (
    financial_mode <> 'fixed_term'
    or (distribution_start is not null and distribution_end is not null and distribution_end >= distribution_start)
  );

comment on column public.forecast_service_settings.distribution_start is 'Prazo fixo: primeiro mês da distribuição do saldo.';
comment on column public.forecast_service_settings.distribution_end is 'Prazo fixo: último mês da distribuição do saldo.';
