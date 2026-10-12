-- Elos OS — Elos IA (piloto): permissões e registro de consumo
-- Cria a permissão de uso do assistente, a tabela de consumo de tokens por
-- pergunta e a função que soma o consumo do dia (usuário) e do mês (empresa)
-- para aplicar as cotas. Não guarda o texto das perguntas nem das respostas.

begin;

insert into public.permissions(key,module,action,description) values
  ('ai.assistant.use','ai','use','Usar o assistente Elos IA'),
  ('ai.usage.view','ai','view_usage','Visualizar o consumo do Elos IA de toda a empresa')
on conflict(key) do update set
  module=excluded.module,
  action=excluded.action,
  description=excluded.description;

-- Piloto: só Proprietário e Administrador começam com acesso. Os demais papéis
-- (Diretoria, Engenharia, Financeiro...) são liberados pela tela
-- Configurações › Permissões, módulo "Elos IA", quando a empresa decidir.
insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.key,true
from public.roles r
cross join public.permissions p
where r.key in ('owner','admin')
  and p.key in ('ai.assistant.use','ai.usage.view')
on conflict(role_id,permission_key) do update set allowed=true;

create table if not exists public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  persona text not null,
  model text not null,
  status text not null default 'ok',
  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  model_calls integer not null default 0,
  tools_used text[] not null default '{}',
  duration_ms integer,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_usage_log_persona_check check (persona in ('diretoria','engenharia','financeiro','clientes')),
  constraint ai_usage_log_status_check check (status in ('ok','incomplete','empty','error')),
  constraint ai_usage_log_tokens_check check (
    input_tokens >= 0 and cached_input_tokens >= 0 and output_tokens >= 0
    and total_tokens >= 0 and model_calls >= 0
    and (duration_ms is null or duration_ms >= 0)
  )
);

create index if not exists ai_usage_log_company_created_idx
  on public.ai_usage_log(company_id, created_at desc);
create index if not exists ai_usage_log_user_created_idx
  on public.ai_usage_log(company_id, created_by, created_at desc);

comment on table public.ai_usage_log is
  'Consumo de tokens do Elos IA por pergunta. Base das cotas diária (usuário) e mensal (empresa). Não armazena o texto das conversas.';
comment on column public.ai_usage_log.tools_used is
  'Consultas ao Elos OS que a IA fez para responder (ex.: fluxo_de_caixa).';

alter table public.ai_usage_log enable row level security;

-- Privilégios explícitos: o usuário logado só lê e inclui; ninguém altera nem
-- apaga pelo aplicativo (é o que garante que a cota não pode ser "zerada").
revoke all on public.ai_usage_log from anon, authenticated;
grant select, insert on public.ai_usage_log to authenticated;

-- Registro somente de inclusão: sem políticas de update/delete.
drop policy if exists ai_usage_log_select on public.ai_usage_log;
create policy ai_usage_log_select
on public.ai_usage_log
for select to authenticated using (
  created_by = auth.uid()
  or public.has_company_permission(company_id,'ai.usage.view')
);

drop policy if exists ai_usage_log_insert on public.ai_usage_log;
create policy ai_usage_log_insert
on public.ai_usage_log
for insert to authenticated with check (
  created_by = auth.uid()
  and public.has_company_permission(company_id,'ai.assistant.use')
);

-- Soma o consumo para as cotas. É security definer porque o total do mês da
-- empresa inclui perguntas de outros usuários; devolve apenas dois números e
-- só para quem pode usar o Elos IA na empresa informada.
create or replace function public.ai_usage_totals(p_company_id uuid)
returns table (user_tokens_today bigint, company_tokens_month bigint)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select
      date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' as day_start,
      date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' as month_start
  )
  select
    coalesce(sum(usage.total_tokens) filter (
      where usage.created_by = auth.uid() and usage.created_at >= bounds.day_start
    ), 0)::bigint as user_tokens_today,
    coalesce(sum(usage.total_tokens), 0)::bigint as company_tokens_month
  from bounds
  left join public.ai_usage_log usage
    on usage.company_id = p_company_id
   and usage.created_at >= bounds.month_start
   and public.has_company_permission(p_company_id,'ai.assistant.use');
$$;

revoke all on function public.ai_usage_totals(uuid) from public, anon;
grant execute on function public.ai_usage_totals(uuid) to authenticated;

commit;
