-- Elos OS — Incorporação · integridade do estudo de viabilidade
begin;

create or replace function public.commercial_guard_feasibility_unit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_study uuid;
  target_company uuid;
  target_status text;
begin
  if tg_op = 'DELETE' then
    target_study := old.study_id;
    target_company := old.company_id;
  else
    target_study := new.study_id;
    target_company := new.company_id;
  end if;

  select status into target_status
  from public.commercial_feasibility_studies
  where id = target_study and company_id = target_company;

  if target_status is distinct from 'draft' then
    raise exception 'Tipologias de um estudo aprovado/convertido são imutáveis.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$$;

-- O baseline econômico criado na conversão é somente leitura.
revoke update, delete on public.commercial_development_profiles from authenticated;

commit;
