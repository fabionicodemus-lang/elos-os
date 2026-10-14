-- Elos OS — Viabilidade: referências CUB para VGV e custos
-- Guarda o índice/padrão, mês-base e valor utilizados no estudo para permitir reajustes futuros.
begin;

alter table public.commercial_feasibility_studies
  add column if not exists vgv_cub_index_name text,
  add column if not exists vgv_cub_reference_month date,
  add column if not exists vgv_cub_base_value numeric(16,4),
  add column if not exists cost_cub_index_name text,
  add column if not exists cost_cub_reference_month date,
  add column if not exists cost_cub_base_value numeric(16,4);

alter table public.commercial_feasibility_studies
  drop constraint if exists commercial_feasibility_vgv_cub_complete_check,
  add constraint commercial_feasibility_vgv_cub_complete_check check (
    (vgv_cub_index_name is null and vgv_cub_reference_month is null and vgv_cub_base_value is null)
    or
    (nullif(trim(vgv_cub_index_name), '') is not null and vgv_cub_reference_month is not null and vgv_cub_base_value > 0)
  ) not valid;

alter table public.commercial_feasibility_studies
  drop constraint if exists commercial_feasibility_cost_cub_complete_check,
  add constraint commercial_feasibility_cost_cub_complete_check check (
    (cost_cub_index_name is null and cost_cub_reference_month is null and cost_cub_base_value is null)
    or
    (nullif(trim(cost_cub_index_name), '') is not null and cost_cub_reference_month is not null and cost_cub_base_value > 0)
  ) not valid;

-- Estudos antigos já convertidos podem permanecer sem CUB. A partir desta migration,
-- qualquer nova conversão exige as duas referências completas.
alter table public.commercial_feasibility_studies
  drop constraint if exists commercial_feasibility_cub_required_on_conversion_check,
  add constraint commercial_feasibility_cub_required_on_conversion_check check (
    status <> 'converted'
    or (
      nullif(trim(vgv_cub_index_name), '') is not null
      and vgv_cub_reference_month is not null
      and vgv_cub_base_value > 0
      and nullif(trim(cost_cub_index_name), '') is not null
      and cost_cub_reference_month is not null
      and cost_cub_base_value > 0
    )
  ) not valid;

comment on column public.commercial_feasibility_studies.vgv_cub_index_name is 'Índice/padrão CUB utilizado como base monetária do VGV, ex.: CUB/SC R8-N.';
comment on column public.commercial_feasibility_studies.vgv_cub_reference_month is 'Mês de referência do CUB-base utilizado no VGV.';
comment on column public.commercial_feasibility_studies.vgv_cub_base_value is 'Valor em reais do CUB-base utilizado no VGV.';
comment on column public.commercial_feasibility_studies.cost_cub_index_name is 'Índice/padrão CUB utilizado como base monetária dos custos.';
comment on column public.commercial_feasibility_studies.cost_cub_reference_month is 'Mês de referência do CUB-base utilizado nos custos.';
comment on column public.commercial_feasibility_studies.cost_cub_base_value is 'Valor em reais do CUB-base utilizado nos custos.';

commit;