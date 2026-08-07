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

-- ---------------------------------------------------------------------------
-- Execução · Qualidade
-- ---------------------------------------------------------------------------
-- Reproduz a aba Indicadores: nota acumulada, aprovação na primeira inspeção,
-- correções no prazo, não conformidades e cobertura, mais as duas quebras
-- exibidas em barra (nota por serviço e NCs por gravidade).
--
-- "Concluída" é a inspeção que já recebeu nota na primeira vistoria, que é o
-- critério usado na tela (first_inspection_score não nulo).
create or replace function public.quality_indicators(
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
      public.has_company_permission(p_company_id, 'execution.quality.indicators')
      or public.has_company_permission(p_company_id, 'execution.quality.view') as ok
  ),
  inspections as (
    select i.*
    from public.quality_inspections i, allowed a
    where a.ok
      and i.company_id = p_company_id
      and i.project_id = p_project_id
  ),
  completed as (
    select * from inspections where first_inspection_score is not null
  ),
  ncs as (
    select n.*
    from public.quality_nonconformities n, allowed a
    where a.ok
      and n.company_id = p_company_id
      and n.project_id = p_project_id
  ),
  closed as (
    select * from ncs where status = 'closed'
  ),
  by_service as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'service_id', service_id, 'average', average, 'count', total
    ) order by average desc, total desc), '[]'::jsonb) as items
    from (
      select service_id,
             round(avg(first_inspection_score), 4) as average,
             count(*) as total
      from completed
      group by service_id
    ) grouped
  ),
  by_severity as (
    select coalesce(jsonb_object_agg(severity, jsonb_build_object('total', total, 'open', open_total)), '{}'::jsonb) as items
    from (
      select severity,
             count(*) as total,
             count(*) filter (where status <> 'closed') as open_total
      from ncs
      group by severity
    ) grouped
  )
  select jsonb_build_object(
    'inspection_count', (select count(*) from inspections),
    'completed_count', (select count(*) from completed),
    'average_score', coalesce((select round(avg(first_inspection_score), 4) from completed), 0),
    'first_pass_count', (select count(*) from completed where first_inspection_score >= 80),
    'open_nc_count', (select count(*) from ncs where status <> 'closed'),
    'closed_nc_count', (select count(*) from closed),
    'on_time_nc_count', (select count(*) from closed where closed_at is not null and closed_at <= due_at),
    'blocked_count', (select count(*) from inspections where release_status = 'blocked'),
    'score_by_service', (select items from by_service),
    'nc_by_severity', (select items from by_severity)
  );
$$;

grant execute on function public.quality_indicators(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Execução · Medições Contratuais
-- ---------------------------------------------------------------------------
-- Reproduz o bloco measurement-kpis. "Aprovado" cobre também as medições que já
-- seguiram para o financeiro, porque aprovar é pré-requisito de faturar.
create or replace function public.execution_measurement_indicators(
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
    'measurement_count', count(*),
    'submitted_count', count(*) filter (where m.status = 'submitted'),
    'gross_approved', coalesce(sum(m.gross_amount) filter (where m.status in ('approved', 'invoiced', 'paid')), 0),
    'net_approved', coalesce(sum(m.net_amount) filter (where m.status in ('approved', 'invoiced', 'paid')), 0),
    'in_finance', coalesce(sum(m.net_amount) filter (where m.status in ('invoiced', 'paid')), 0),
    'paid_total', coalesce(sum(m.paid_amount) filter (where m.status = 'paid'), 0)
  )
  from public.execution_contract_measurements m
  where m.company_id = p_company_id
    and m.project_id = p_project_id
    and (
      public.has_company_permission(m.company_id, 'execution.measurements.view')
      or public.has_company_permission(m.company_id, 'execution.measurements.manage')
    );
$$;

grant execute on function public.execution_measurement_indicators(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Suprimentos · Estoque
-- ---------------------------------------------------------------------------
-- Reproduz o bloco inventory-kpis. O valor em estoque considera todos os saldos;
-- os demais indicadores olham apenas os que ainda têm quantidade em mãos.
--
-- p_expiry_days mantém a janela de validade como parâmetro, em vez de fixar 60
-- dias no banco. A data-base é a do servidor, como já era na tela.
create or replace function public.procurement_inventory_indicators(
  p_company_id uuid,
  p_project_id uuid,
  p_expiry_days integer default 60
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with balances as (
    select b.*
    from public.procurement_inventory_balances b
    where b.company_id = p_company_id
      and b.project_id = p_project_id
      and (
        public.has_company_permission(b.company_id, 'procurement.inventory.view')
        or public.has_company_permission(b.company_id, 'procurement.inventory.manage')
      )
  ),
  active as (
    select * from balances where quantity_on_hand > 0
  )
  select jsonb_build_object(
    'stock_value', (select coalesce(sum(total_value), 0) from balances),
    'active_count', (select count(*) from active),
    'active_quantity', (select coalesce(sum(quantity_on_hand), 0) from active),
    'low_count', (select count(*) from active where minimum_quantity > 0 and available_quantity <= minimum_quantity),
    -- 9999-12-31 é o marcador de "sem validade" usado pelo cadastro.
    'expiring_count', (
      select count(*) from active
      where expiration_date <> date '9999-12-31'
        and expiration_date <= current_date + p_expiry_days
    ),
    'active_location_count', (
      select count(*)
      from public.procurement_inventory_locations l
      where l.company_id = p_company_id
        and l.project_id = p_project_id
        and l.status = 'active'
    )
  );
$$;

grant execute on function public.procurement_inventory_indicators(uuid, uuid, integer) to authenticated;

commit;
