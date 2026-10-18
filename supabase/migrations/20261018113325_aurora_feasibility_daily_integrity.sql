-- Aurora: transactional study initialization and authoritative diary requirements.
begin;
create or replace function public.commercial_seed_feasibility_sales_velocity()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  -- A new study has a new primary key; different phases may share their start.
  insert into public.commercial_feasibility_sales_velocities(
    company_id,study_id,name,start_offset_months,units_per_month,sort_order,created_by
  ) values(new.company_id,new.id,'Velocidade padrão',new.sales_start_offset_months,new.sales_velocity_units_month,10,new.created_by);
  return new;
end; $$;
revoke all on function public.commercial_seed_feasibility_sales_velocity() from public,anon;

create or replace function public.execution_daily_log_requirements(p_log_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare d public.execution_daily_logs%rowtype; required_photos integer; photo_count integer; result jsonb;
begin
  select * into d from public.execution_daily_logs where id=p_log_id;
  if d.id is null or not (
    public.has_company_permission(d.company_id,'execution.daily_logs.view') or
    public.has_company_permission(d.company_id,'execution.daily_logs.manage') or
    public.has_company_permission(d.company_id,'execution.daily_logs.approve')
  ) then raise exception 'Diário não encontrado ou sem permissão.'; end if;
  select coalesce(s.required_photo_count,1) into required_photos from public.execution_daily_log_settings s where s.project_id=d.project_id and s.company_id=d.company_id;
  required_photos:=coalesce(required_photos,1);
  select count(*) into photo_count from public.execution_daily_log_photos where daily_log_id=d.id;
  result:=jsonb_build_array(
    jsonb_build_object('key','basic','label','Informe jornada e resumo do dia','complete',d.work_start is not null and d.work_end is not null and nullif(trim(coalesce(d.general_notes,'')),'') is not null),
    jsonb_build_object('key','weather','label','Preencha o clima','complete',exists(select 1 from public.execution_daily_log_weather where daily_log_id=d.id)),
    jsonb_build_object('key','workforce','label','Informe a mão de obra','complete',exists(select 1 from public.execution_daily_log_workforce where daily_log_id=d.id and worker_count>0)),
    jsonb_build_object('key','services','label','Informe os serviços executados','complete',exists(select 1 from public.execution_daily_log_services where daily_log_id=d.id)),
    jsonb_build_object('key','occurrences','label','Registre as ocorrências operacionais ou declare sua ausência','complete',d.no_occurrences or exists(select 1 from public.execution_daily_log_occurrences where daily_log_id=d.id and (not is_safety_event or occurrence_type='stoppage'))),
    jsonb_build_object('key','safety','label','Registre os eventos de segurança ou declare sua ausência','complete',d.no_safety_events or exists(select 1 from public.execution_daily_log_occurrences where daily_log_id=d.id and is_safety_event)),
    jsonb_build_object('key','photos','label',format('Adicione %s foto(s) obrigatória(s)',greatest(0,required_photos-photo_count)),'complete',photo_count>=required_photos),
    jsonb_build_object('key','confirmation','label','Confirme as informações do diário','complete',d.confirmed_by_filler)
  );
  return result;
end; $$;
revoke all on function public.execution_daily_log_requirements(uuid) from public,anon;
grant execute on function public.execution_daily_log_requirements(uuid) to authenticated;

create or replace function public.refresh_execution_daily_log_completion(p_log_id uuid)
returns numeric language plpgsql security invoker set search_path=public as $$
declare requirements jsonb; completed integer; percent numeric;
begin
  perform 1 from public.execution_daily_logs where id=p_log_id for update;
  requirements:=public.execution_daily_log_requirements(p_log_id);
  select count(*) filter(where (value->>'complete')::boolean) into completed from jsonb_array_elements(requirements);
  percent:=round(completed::numeric/jsonb_array_length(requirements)*100,2);
  update public.execution_daily_logs set completion_percent=percent,
    status=case when status in('approved','approved_with_reservations','awaiting_approval','cancelled','reopened') then status
      when completed>0 then 'in_progress' else 'pending' end, updated_at=now()
  where id=p_log_id;
  return percent;
end; $$;
revoke all on function public.refresh_execution_daily_log_completion(uuid) from public,anon;
grant execute on function public.refresh_execution_daily_log_completion(uuid) to authenticated;
commit;
