-- Elos OS — Viabilidade: plano comercial em cinco fases
-- Evolui as velocidades existentes sem quebrar estudos legados.
begin;

alter table public.commercial_feasibility_sales_velocities
  add column if not exists phase_key text,
  add column if not exists target_units_pct numeric(8,4),
  add column if not exists price_appreciation_pct numeric(8,4) not null default 0,
  add column if not exists entry_pct numeric(8,4),
  add column if not exists monthly_pct numeric(8,4),
  add column if not exists keys_pct numeric(8,4),
  add column if not exists monthly_installments integer;

-- Fases fixas podem compartilhar o mesmo marco de início com registros legados.
alter table public.commercial_feasibility_sales_velocities
  drop constraint if exists feasibility_sales_velocity_start_uq;

create index if not exists feasibility_sales_velocities_start_idx
  on public.commercial_feasibility_sales_velocities(study_id, start_offset_months);

create unique index if not exists feasibility_sales_phase_key_uq
  on public.commercial_feasibility_sales_velocities(study_id, phase_key)
  where phase_key is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'feasibility_sales_phase_key_check'
      and conrelid = 'public.commercial_feasibility_sales_velocities'::regclass
  ) then
    alter table public.commercial_feasibility_sales_velocities
      add constraint feasibility_sales_phase_key_check
      check (phase_key is null or phase_key in ('prelaunch','launch','construction_start','mid_construction','ready'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'feasibility_sales_phase_target_check'
      and conrelid = 'public.commercial_feasibility_sales_velocities'::regclass
  ) then
    alter table public.commercial_feasibility_sales_velocities
      add constraint feasibility_sales_phase_target_check
      check (target_units_pct is null or target_units_pct between 0 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'feasibility_sales_phase_appreciation_check'
      and conrelid = 'public.commercial_feasibility_sales_velocities'::regclass
  ) then
    alter table public.commercial_feasibility_sales_velocities
      add constraint feasibility_sales_phase_appreciation_check
      check (price_appreciation_pct between -90 and 500);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'feasibility_sales_phase_payment_check'
      and conrelid = 'public.commercial_feasibility_sales_velocities'::regclass
  ) then
    alter table public.commercial_feasibility_sales_velocities
      add constraint feasibility_sales_phase_payment_check
      check (
        (entry_pct is null or entry_pct between 0 and 100)
        and (monthly_pct is null or monthly_pct between 0 and 100)
        and (keys_pct is null or keys_pct between 0 and 100)
        and (monthly_installments is null or monthly_installments between 1 and 240)
      );
  end if;
end $$;

comment on column public.commercial_feasibility_sales_velocities.phase_key is 'Fase comercial canônica: prelaunch, launch, construction_start, mid_construction ou ready. Nulo mantém registro legado.';
comment on column public.commercial_feasibility_sales_velocities.target_units_pct is 'Meta percentual do estoque comercializável destinada à fase.';
comment on column public.commercial_feasibility_sales_velocities.price_appreciation_pct is 'Valorização percentual do preço em relação à fase anterior.';
comment on column public.commercial_feasibility_sales_velocities.entry_pct is 'Percentual recebido na venda para esta fase.';
comment on column public.commercial_feasibility_sales_velocities.monthly_pct is 'Percentual distribuído em parcelas mensais para esta fase.';
comment on column public.commercial_feasibility_sales_velocities.keys_pct is 'Percentual recebido nas chaves para esta fase.';
comment on column public.commercial_feasibility_sales_velocities.monthly_installments is 'Quantidade de parcelas mensais da fase.';

commit;
