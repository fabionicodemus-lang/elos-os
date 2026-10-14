-- Elos OS — integridade das premissas gerenciáveis da viabilidade
begin;

-- Todo novo estudo nasce com ao menos uma velocidade de vendas utilizável.
create or replace function public.commercial_seed_feasibility_sales_velocity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.commercial_feasibility_sales_velocities(
    company_id, study_id, name, start_offset_months, units_per_month, sort_order, created_by
  ) values (
    new.company_id, new.id, 'Velocidade padrão', new.sales_start_offset_months,
    new.sales_velocity_units_month, 10, new.created_by
  )
  on conflict (study_id, start_offset_months) do nothing;
  return new;
end;
$$;

drop trigger if exists commercial_seed_feasibility_sales_velocity_trg on public.commercial_feasibility_studies;
create trigger commercial_seed_feasibility_sales_velocity_trg
after insert on public.commercial_feasibility_studies
for each row execute function public.commercial_seed_feasibility_sales_velocity();

-- A simulação precisa manter pelo menos uma fase de vendas.
create or replace function public.commercial_keep_one_sales_velocity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    select count(*)
    from public.commercial_feasibility_sales_velocities
    where study_id = old.study_id and company_id = old.company_id
  ) <= 1 then
    raise exception 'O estudo precisa manter ao menos uma velocidade de vendas.';
  end if;
  return old;
end;
$$;

drop trigger if exists commercial_keep_one_sales_velocity_trg on public.commercial_feasibility_sales_velocities;
create trigger commercial_keep_one_sales_velocity_trg
before delete on public.commercial_feasibility_sales_velocities
for each row execute function public.commercial_keep_one_sales_velocity();

-- Ao excluir uma área que veio dos campos legados, zera o legado correspondente.
-- Assim a área realmente deixa de participar do cálculo mesmo quando era a última linha gerenciada.
create or replace function public.commercial_clear_legacy_area_on_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.source_key = 'garage_stairs' then
    update public.commercial_feasibility_studies
    set garage_stairs_area_m2 = 0, garage_stairs_cost_m2 = 0
    where id = old.study_id and company_id = old.company_id and status = 'draft';
  elsif old.source_key = 'lobby' then
    update public.commercial_feasibility_studies
    set lobby_area_m2 = 0, lobby_cost_m2 = 0
    where id = old.study_id and company_id = old.company_id and status = 'draft';
  elsif old.source_key = 'decorated_common' then
    update public.commercial_feasibility_studies
    set decorated_common_area_m2 = 0, decorated_common_cost_m2 = 0
    where id = old.study_id and company_id = old.company_id and status = 'draft';
  end if;
  return old;
end;
$$;

drop trigger if exists commercial_clear_legacy_area_on_delete_trg on public.commercial_feasibility_construction_areas;
create trigger commercial_clear_legacy_area_on_delete_trg
before delete on public.commercial_feasibility_construction_areas
for each row execute function public.commercial_clear_legacy_area_on_delete();

commit;
