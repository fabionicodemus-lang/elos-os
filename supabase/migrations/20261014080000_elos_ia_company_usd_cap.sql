-- Elos OS — Elos IA: teto mensal de gasto por empresa
-- Adiciona custo estimado por chamada e limite padrão de US$ 20/mês por empresa.
-- O custo é estimado para controle interno; a cobrança oficial continua sendo a da OpenAI.

begin;

alter table public.companies
  add column if not exists ai_monthly_usd_limit numeric(10,2) not null default 20.00;

alter table public.companies
  drop constraint if exists companies_ai_monthly_usd_limit_check;
alter table public.companies
  add constraint companies_ai_monthly_usd_limit_check
  check (ai_monthly_usd_limit >= 0);

comment on column public.companies.ai_monthly_usd_limit is
  'Teto mensal interno do Elos IA em USD. Padrão US$ 20 por empresa; 0 desliga somente se alterado explicitamente.';

alter table public.ai_usage_log
  add column if not exists estimated_cost_usd numeric(14,6) not null default 0;

alter table public.ai_usage_log
  drop constraint if exists ai_usage_log_estimated_cost_check;
alter table public.ai_usage_log
  add constraint ai_usage_log_estimated_cost_check
  check (estimated_cost_usd >= 0);

comment on column public.ai_usage_log.estimated_cost_usd is
  'Custo estimado em USD para proteção de orçamento. Não substitui o faturamento oficial da OpenAI.';

-- Backfill conservador dos registros antigos. O modelo padrão atual é gpt-6-luna.
-- Para modelos desconhecidos usamos a faixa do gpt-6-astra para não subestimar o risco.
update public.ai_usage_log
set estimated_cost_usd = round((
  greatest(input_tokens - cached_input_tokens, 0)::numeric *
    case model
      when 'gpt-6-luna' then 0.05
      when 'gpt-6-sol' then 1.00
      when 'gpt-6-astra' then 5.00
      else 5.00
    end
  + cached_input_tokens::numeric *
    case model
      when 'gpt-6-luna' then 0.005
      when 'gpt-6-sol' then 0.10
      when 'gpt-6-astra' then 0.50
      else 0.50
    end
  + output_tokens::numeric *
    case model
      when 'gpt-6-luna' then 0.25
      when 'gpt-6-sol' then 5.00
      when 'gpt-6-astra' then 25.00
      else 25.00
    end
) / 1000000.0, 6)
where estimated_cost_usd = 0
  and (input_tokens > 0 or output_tokens > 0);

-- O formato de retorno muda, então é necessário recriar a função.
drop function if exists public.ai_usage_totals(uuid);

create function public.ai_usage_totals(p_company_id uuid)
returns table (
  user_tokens_today bigint,
  company_tokens_month bigint,
  company_cost_usd_month numeric,
  company_usd_limit numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select
      date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' as day_start,
      date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' as month_start
  ), company_cfg as (
    select c.ai_monthly_usd_limit
    from public.companies c
    where c.id = p_company_id
      and public.has_company_permission(p_company_id,'ai.assistant.use')
  )
  select
    coalesce(sum(usage.total_tokens) filter (
      where usage.created_by = auth.uid() and usage.created_at >= bounds.day_start
    ), 0)::bigint as user_tokens_today,
    coalesce(sum(usage.total_tokens) filter (
      where usage.created_at >= bounds.month_start
    ), 0)::bigint as company_tokens_month,
    coalesce(sum(usage.estimated_cost_usd) filter (
      where usage.created_at >= bounds.month_start
    ), 0)::numeric as company_cost_usd_month,
    coalesce((select ai_monthly_usd_limit from company_cfg), 20.00)::numeric as company_usd_limit
  from bounds
  left join public.ai_usage_log usage
    on usage.company_id = p_company_id
   and usage.created_at >= bounds.month_start
   and exists (select 1 from company_cfg);
$$;

revoke all on function public.ai_usage_totals(uuid) from public, anon;
grant execute on function public.ai_usage_totals(uuid) to authenticated;

commit;
