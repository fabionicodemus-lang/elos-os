-- Elos OS — Previsão pelas parcelas: grupo do mesmo contrato
-- Serviços marcados com o mesmo plan_group (ex.: "Liv Esquadrias") dividem as parcelas do contrato
-- na proporção do orçamento de cada um, mesmo que os títulos estejam rateados num só serviço.

alter table public.forecast_service_settings
  add column if not exists plan_group text;

comment on column public.forecast_service_settings.plan_group is
  'Nome do contrato que agrupa serviços na previsão pelas parcelas; as parcelas do grupo são divididas pelo orçamento de cada serviço.';
