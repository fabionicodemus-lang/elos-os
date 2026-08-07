-- Elos OS — Agregados de página no banco
--
-- As listagens carregavam a tabela transacional inteira no servidor só para
-- somar indicadores em memória. Estas funções devolvem os mesmos números
-- calculados no Postgres, permitindo que a página passe a paginar as linhas.
--
-- Todas seguem o padrão já adotado no projeto: security invoker, search_path
-- fixo e verificação explícita de permissão dentro da própria consulta, além
-- da RLS que continua valendo sobre as tabelas.

begin;

-- ---------------------------------------------------------------------------
-- Execução · Diário de Obras
-- ---------------------------------------------------------------------------
-- Reproduz DailyLogIndicators: considera apenas a versão atual não cancelada de
-- cada diário e cobre todo o histórico do projeto.
create or replace function public.execution_daily_log_indicators(
  p_company_id uuid,
  p_project_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with allowed as (
    select
      public.has_company_permission(p_company_id, 'execution.daily_logs.view')
      or public.has_company_permission(p_company_id, 'execution.daily_logs.manage')
      or public.has_company_permission(p_company_id, 'execution.daily_logs.approve') as ok
  ),
  valid as (
    select l.id
    from public.execution_daily_logs l, allowed a
    where a.ok
      and l.company_id = p_company_id
      and l.project_id = p_project_id
      and l.is_current
      and l.status <> 'cancelled'
  ),
  approved as (
    select count(*) as total
    from public.execution_daily_logs l
    join valid v on v.id = l.id
    where l.status in ('approved', 'approved_with_reservations')
  ),
  rain as (
    select count(distinct w.daily_log_id) as total
    from public.execution_daily_log_weather w
    join valid v on v.id = w.daily_log_id
    where w.condition in ('rain', 'storm')
  ),
  stopped as (
    select count(*) as total
    from valid v
    where exists (
      select 1 from public.execution_daily_log_weather w
      where w.daily_log_id = v.id and coalesce(w.stopped_hours, 0) > 0
    )
    or exists (
      select 1 from public.execution_daily_log_occurrences o
      where o.daily_log_id = v.id and o.occurrence_type = 'stoppage'
    )
  ),
  photos as (
    select count(*) as total
    from public.execution_daily_log_photos p
    join valid v on v.id = p.daily_log_id
  ),
  workers as (
    select coalesce(sum(w.worker_count), 0) as total
    from public.execution_daily_log_workforce w
    join valid v on v.id = w.daily_log_id
  ),
  top_services as (
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', total) order by total desc, name), '[]'::jsonb) as items
    from (
      select s.service_name as name, count(*) as total
      from public.execution_daily_log_services s
      join valid v on v.id = s.daily_log_id
      group by s.service_name
      order by count(*) desc, s.service_name
      limit 8
    ) ranked
  ),
  top_occurrences as (
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', total) order by total desc, name), '[]'::jsonb) as items
    from (
      select o.occurrence_type as name, count(*) as total
      from public.execution_daily_log_occurrences o
      join valid v on v.id = o.daily_log_id
      group by o.occurrence_type
      order by count(*) desc, o.occurrence_type
      limit 8
    ) ranked
  )
  select jsonb_build_object(
    'valid_count', (select count(*) from valid),
    'approved_count', (select total from approved),
    'rain_count', (select total from rain),
    'stopped_count', (select total from stopped),
    'photo_count', (select total from photos),
    'average_workers', case
      when (select count(*) from valid) = 0 then 0
      else round((select total from workers)::numeric / (select count(*) from valid), 4)
    end,
    'top_services', (select items from top_services),
    'top_occurrences', (select items from top_occurrences)
  );
$$;

grant execute on function public.execution_daily_log_indicators(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Execução · Ordens de Serviço
-- ---------------------------------------------------------------------------
-- Reproduz o bloco work-order-kpis: totais de toda a obra, com os valores
-- financeiros ignorando ordens canceladas.
create or replace function public.execution_work_order_indicators(
  p_company_id uuid,
  p_project_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'order_count', count(*),
    'active_count', count(*) filter (where o.status in ('released', 'in_progress', 'paused', 'pending_acceptance')),
    'pending_acceptance_count', count(*) filter (where o.status = 'pending_acceptance'),
    'authorized_total', coalesce(sum(o.authorized_value) filter (where o.status <> 'cancelled'), 0),
    'executed_total', coalesce(sum(o.executed_value) filter (where o.status <> 'cancelled'), 0)
  )
  from public.execution_work_orders o
  where o.company_id = p_company_id
    and o.project_id = p_project_id
    and (
      public.has_company_permission(o.company_id, 'execution.work_orders.view')
      or public.has_company_permission(o.company_id, 'execution.work_orders.manage')
    );
$$;

grant execute on function public.execution_work_order_indicators(uuid, uuid) to authenticated;

commit;
