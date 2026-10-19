-- Importação limpa — Onda 8: diário de obra do Flow
--
-- Origem: tela "Diário de obras" (app novo), 1.126 dias do Flow; o conteúdo de cada dia vem de
-- /engineering/v3/daily-report/info/{id} e fica em elos_import.flow_diary.
-- Entram os dias que têm registro ou clima informado (os demais são dias vazios criados automaticamente).
-- * Um RDO por dia: RDO-AAAAMMDD-D-P (turno dia, principal), aprovado. Responsável técnico = engenheiro da obra
--   (usuário que roda a importação); nome do responsável = quem preencheu na origem.
-- * Registro "Efetivo" → observações gerais do dia (lista de pessoas por empresa, como foi escrito).
-- * Registros "Ocorrências", "Reuniões" e "As Built" → ocorrências do dia (resolvidas, impacto baixo).
-- * Clima: 1 = ensolarado, 2 = nublado, 3 = chuva, 4 = tempestade (manhã, tarde e noite).
-- * Registros excluídos na origem não entram. Os 6 anexos ficam para a etapa de anexos.

create table if not exists elos_import.flow_diary as
select (payload->'body'->>'dailyReportId')::int report_id, (payload->'body'->>'dailyReportDate')::date d, payload->'body' b
from public.koper_staging_records
where entity = 'probe.api' and payload->>'path' like '/engineering/v3/daily-report/info/%' and payload->>'status' = '200';
alter table elos_import.flow_diary enable row level security;

create or replace function elos_import.wave8_daily_logs(p_company_id uuid, p_project_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_run uuid; r record; g record; v_log uuid; v_notes text; v_resp text; v_first timestamptz;
  n_logs int := 0; n_occ int := 0; n_weather int := 0; v_period text; v_code int; v_cond text;
begin
  insert into elos_import.runs(company_id, project_id, wave) values (p_company_id, p_project_id, '8-diario-de-obra') returning id into v_run;

  for r in
    select f.* from elos_import.flow_diary f
    where exists (select 1 from jsonb_array_elements(f.b->'registers') x where x->>'deletedAt' is null)
       or coalesce((f.b->>'morningWeather')::int, 0) <> 0 or coalesce((f.b->>'afternoonWeather')::int, 0) <> 0
       or coalesce((f.b->>'nightWeather')::int, 0) <> 0 or coalesce((f.b->>'lateNightWeather')::int, 0) <> 0
    order by f.d
  loop
    if elos_import.map_get(p_company_id, p_project_id, 'daily_report', r.report_id::text) is not null then continue; end if;

    select string_agg(concat('Efetivo', case when cnt > 1 then ' (' || ord || ')' end, E':\n', btrim(x->>'topicDailyText')), E'\n\n' order by ord)
      into v_notes
    from (select x, row_number() over (order by x->>'createdAt') ord, count(*) over () cnt
          from jsonb_array_elements(r.b->'registers') x where x->>'deletedAt' is null and x->>'topicName' = 'Efetivo') e;

    select string_agg(distinct x->>'userName', ', '), min((x->>'createdAt')::timestamptz) into v_resp, v_first
    from jsonb_array_elements(r.b->'registers') x where x->>'deletedAt' is null;

    insert into execution_daily_logs(company_id, project_id, log_date, shift, diary_type, log_number, version, is_current, status,
      general_notes, no_occurrences, no_safety_events, confirmed_by_filler, completion_percent, responsible_user_id, responsible_name,
      submitted_by, submitted_at, approved_by, approved_at, approval_notes, created_by, updated_by, created_at, updated_at)
    values (p_company_id, p_project_id, r.d, 'day', 'principal', 'RDO-' || to_char(r.d, 'YYYYMMDD') || '-D-P', 1, true, 'approved',
      nullif(v_notes, ''),
      not exists (select 1 from jsonb_array_elements(r.b->'registers') x where x->>'deletedAt' is null and x->>'topicName' <> 'Efetivo'),
      true, true, 100, p_user_id, coalesce(nullif(v_resp, ''), (select nullif(btrim(pr.full_name), '') from profiles pr where pr.id = p_user_id), 'Engenharia da obra'),
      p_user_id, coalesce(v_first, r.d::timestamptz + interval '18 hours'), p_user_id, coalesce(v_first, r.d::timestamptz + interval '18 hours'),
      'Diário histórico importado da obra.', p_user_id, p_user_id, coalesce(v_first, now()), now())
    returning id into v_log;
    perform elos_import.map_put(p_company_id, p_project_id, 'daily_report', r.report_id::text, 'execution_daily_log', v_log, 'imported',
      'RDO-' || to_char(r.d, 'YYYYMMDD') || '-D-P');
    n_logs := n_logs + 1;

    -- Ocorrências, reuniões e as built
    for g in
      select x from jsonb_array_elements(r.b->'registers') x
      where x->>'deletedAt' is null and x->>'topicName' <> 'Efetivo' and nullif(btrim(x->>'topicDailyText'), '') is not null
      order by x->>'createdAt'
    loop
      insert into execution_daily_log_occurrences(company_id, project_id, daily_log_id, occurrence_type, impact, title, description,
        status, affects_schedule, is_safety_event, is_critical, occurred_at, created_by, created_at, updated_at)
      values (p_company_id, p_project_id, v_log,
        case g.x->>'topicName' when 'Reuniões' then 'visit' else 'general' end, 'low',
        left(concat(case g.x->>'topicName' when 'Ocorrências' then 'Ocorrência' when 'Reuniões' then 'Reunião' else g.x->>'topicName' end,
          ' · ', split_part(btrim(g.x->>'topicDailyText'), E'\n', 1)), 160),
        btrim(g.x->>'topicDailyText'), 'resolved', false, false, false,
        coalesce((g.x->>'createdAt')::timestamptz, r.d::timestamptz + interval '12 hours'), p_user_id,
        coalesce((g.x->>'createdAt')::timestamptz, now()), now());
      n_occ := n_occ + 1;
    end loop;

    -- Clima
    foreach v_period in array array['morning', 'afternoon', 'night'] loop
      v_code := case v_period
        when 'morning' then coalesce((r.b->>'morningWeather')::int, 0)
        when 'afternoon' then coalesce((r.b->>'afternoonWeather')::int, 0)
        else coalesce(nullif((r.b->>'nightWeather')::int, 0), (r.b->>'lateNightWeather')::int, 0) end;
      v_cond := case v_code when 1 then 'sunny' when 2 then 'cloudy' when 3 then 'rain' when 4 then 'storm' end;
      if v_cond is not null then
        insert into execution_daily_log_weather(company_id, project_id, daily_log_id, period, condition, created_at, updated_at)
        values (p_company_id, p_project_id, v_log, v_period, v_cond, now(), now());
        n_weather := n_weather + 1;
      end if;
    end loop;
  end loop;

  update elos_import.runs set status = 'done', finished_at = now(),
    summary = jsonb_build_object('diarios', n_logs, 'ocorrencias', n_occ, 'clima', n_weather) where id = v_run;
  return jsonb_build_object('diarios', n_logs, 'ocorrencias', n_occ, 'clima', n_weather);
end;
$$;
revoke all on function elos_import.wave8_daily_logs(uuid, uuid, uuid) from public, anon, authenticated;
