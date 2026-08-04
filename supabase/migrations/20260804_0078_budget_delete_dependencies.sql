-- Elos OS — Correção da exclusão segura de orçamentos
-- Remove somente o planejamento ainda sem execução e bloqueia vínculos operacionais
-- ou históricos com mensagens compreensíveis para o usuário.

begin;

create or replace function public.delete_engineering_budget(
  p_company_id uuid,
  p_project_id uuid,
  p_budget_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget public.engineering_budgets%rowtype;
  v_progress_measurements integer := 0;
  v_snapshot_count integer := 0;
  v_fk record;
  v_reference_count bigint := 0;
  v_blockers text[] := array[]::text[];
  v_replacement_budget_id uuid;
begin
  if not public.has_company_permission(p_company_id, 'budgets.manage') then
    raise exception 'Você não possui permissão para excluir orçamentos.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_company_id::text || ':' || p_project_id::text || ':budget-delete')
  );

  select * into v_budget
  from public.engineering_budgets budget
  where budget.id = p_budget_id
    and budget.company_id = p_company_id
    and budget.project_id = p_project_id
  for update;

  if not found then
    raise exception 'Orçamento não localizado para esta obra.' using errcode = 'P0002';
  end if;

  -- Medições físicas são histórico de execução e nunca são removidas junto com
  -- uma revisão orçamentária. Linhas de base vazias continuam sendo dados internos
  -- da revisão e podem ser eliminadas de forma transacional.
  if to_regclass('public.engineering_schedule_progress_measurements') is not null then
    execute $sql$
      select count(*)
      from public.engineering_schedule_progress_measurements measurement
      join public.engineering_schedule_baselines baseline
        on baseline.id = measurement.baseline_id
      where baseline.company_id = $1
        and baseline.project_id = $2
        and baseline.budget_id = $3
    $sql$
    into v_progress_measurements
    using p_company_id, p_project_id, p_budget_id;
  end if;

  if v_progress_measurements > 0 then
    v_blockers := array_append(
      v_blockers,
      format('%s medição(ões) física(s) do cronograma', v_progress_measurements)
    );
  end if;

  -- Snapshot é memória imutável. A verificação considera tanto o orçamento quanto
  -- a linha de base, inclusive para registros antigos cujo budget_id esteja nulo.
  if to_regclass('public.forecast_snapshots') is not null then
    execute $sql$
      select count(*)
      from public.forecast_snapshots snapshot
      where snapshot.company_id = $1
        and snapshot.project_id = $2
        and (
          snapshot.budget_id = $3
          or snapshot.baseline_id in (
            select baseline.id
            from public.engineering_schedule_baselines baseline
            where baseline.company_id = $1
              and baseline.project_id = $2
              and baseline.budget_id = $3
          )
        )
    $sql$
    into v_snapshot_count
    using p_company_id, p_project_id, p_budget_id;
  end if;

  if v_snapshot_count > 0 then
    v_blockers := array_append(
      v_blockers,
      format('%s snapshot(s) imutável(is) de previsão', v_snapshot_count)
    );
  end if;

  -- Descobre todas as demais FKs RESTRICT/NO ACTION que apontam para o orçamento.
  -- A linha de base é a única dependência removível automaticamente; snapshots já
  -- foram tratados acima para evitar mensagens duplicadas.
  for v_fk in
    select
      constraint_row.conrelid,
      constraint_row.conname,
      namespace_row.nspname as schema_name,
      table_row.relname as table_name,
      column_row.attname as column_name
    from pg_constraint constraint_row
    join pg_class table_row
      on table_row.oid = constraint_row.conrelid
    join pg_namespace namespace_row
      on namespace_row.oid = table_row.relnamespace
    join pg_attribute column_row
      on column_row.attrelid = constraint_row.conrelid
     and column_row.attnum = constraint_row.conkey[1]
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.engineering_budgets'::regclass
      and constraint_row.confdeltype in ('a', 'r')
      and array_length(constraint_row.conkey, 1) = 1
      and constraint_row.conrelid <> 'public.engineering_schedule_baselines'::regclass
      and (
        to_regclass('public.forecast_snapshots') is null
        or constraint_row.conrelid <> 'public.forecast_snapshots'::regclass
      )
  loop
    execute format(
      'select count(*) from %I.%I where %I = $1',
      v_fk.schema_name,
      v_fk.table_name,
      v_fk.column_name
    )
    into v_reference_count
    using p_budget_id;

    if v_reference_count > 0 then
      v_blockers := array_append(
        v_blockers,
        case v_fk.table_name
          when 'execution_material_requests' then
            format('%s solicitação(ões) de materiais', v_reference_count)
          when 'execution_service_contracts' then
            format('%s contrato(s) de serviços', v_reference_count)
          else
            format('%s vínculo(s) em %s', v_reference_count, v_fk.table_name)
        end
      );
    end if;
  end loop;

  if coalesce(array_length(v_blockers, 1), 0) > 0 then
    raise exception 'Este orçamento não pode ser excluído porque possui: %. Arquive a revisão ou remova os vínculos antes de excluir.',
      array_to_string(v_blockers, '; ')
      using errcode = 'P0001';
  end if;

  -- Atividades e dependências possuem ON DELETE CASCADE a partir da linha de base.
  -- Como não há execução, contratos ou snapshots vinculados, o planejamento vazio
  -- pode ser removido junto com a revisão que o originou.
  delete from public.engineering_schedule_baselines baseline
  where baseline.company_id = p_company_id
    and baseline.project_id = p_project_id
    and baseline.budget_id = p_budget_id;

  begin
    delete from public.engineering_budgets budget
    where budget.id = p_budget_id
      and budget.company_id = p_company_id
      and budget.project_id = p_project_id;
  exception
    when foreign_key_violation then
      raise exception 'Este orçamento ainda possui vínculos em outro módulo. Arquive a revisão ou remova o vínculo antes de excluir.'
        using errcode = 'P0001';
  end;

  if not found then
    raise exception 'O orçamento não foi excluído.' using errcode = 'P0001';
  end if;

  -- Se a revisão excluída era a base, promove a revisão aprovada mais recente.
  -- A obra pode permanecer sem base somente quando não houver outra revisão aprovada.
  if v_budget.is_base then
    select budget.id into v_replacement_budget_id
    from public.engineering_budgets budget
    where budget.company_id = p_company_id
      and budget.project_id = p_project_id
      and budget.status = 'approved'
      and not budget.is_base
    order by budget.updated_at desc, budget.created_at desc, budget.id desc
    limit 1
    for update;

    if v_replacement_budget_id is not null then
      update public.engineering_budgets
      set is_base = true,
          base_set_at = now(),
          base_set_by = auth.uid(),
          updated_at = now()
      where id = v_replacement_budget_id
        and company_id = p_company_id
        and project_id = p_project_id;
    end if;
  end if;
end;
$$;

grant execute on function public.delete_engineering_budget(uuid, uuid, uuid) to authenticated;

commit;
