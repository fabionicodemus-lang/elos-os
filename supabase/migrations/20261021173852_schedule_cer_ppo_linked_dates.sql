-- CER/PPO and their MO-* cost components share execution dates, not money.
-- No percentages, quantities, payments or budget values are copied between components.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

create or replace function public.sync_schedule_cer_ppo_baseline_dates()
returns trigger language plpgsql security invoker set search_path=public as $$
declare peer public.engineering_schedule_activities%rowtype; peer_code text;
begin
  if new.record_status <> 'active' or new.code !~ '^(MO-)?(CER|PPO)-' then return new; end if;
  if tg_op='UPDATE' and (new.planned_start,new.planned_finish,new.duration_days)
      is not distinct from (old.planned_start,old.planned_finish,old.duration_days) then return new; end if;
  peer_code:=case when new.code like 'MO-%' then substr(new.code,4) else 'MO-'||new.code end;
  select * into peer from public.engineering_schedule_activities
    where company_id=new.company_id and project_id=new.project_id and baseline_id=new.baseline_id
      and location_id is not distinct from new.location_id and code=peer_code and record_status='active';
  if peer.id is null then return new; end if;
  -- A newly-added labor component inherits the existing service's plan.
  if tg_op='INSERT' and new.code like 'MO-%' then
    update public.engineering_schedule_activities set planned_start=peer.planned_start,
      planned_finish=peer.planned_finish,duration_days=peer.duration_days,updated_at=now()
      where id=new.id and (planned_start,planned_finish,duration_days)
        is distinct from (peer.planned_start,peer.planned_finish,peer.duration_days);
  else
    update public.engineering_schedule_activities set planned_start=new.planned_start,
      planned_finish=new.planned_finish,duration_days=new.duration_days,updated_at=now()
      where id=peer.id and company_id=new.company_id and project_id=new.project_id and baseline_id=new.baseline_id
        and (planned_start,planned_finish,duration_days)
          is distinct from (new.planned_start,new.planned_finish,new.duration_days);
  end if;
  return new;
end; $$;
revoke all on function public.sync_schedule_cer_ppo_baseline_dates() from public,anon,authenticated;

create or replace function public.sync_schedule_cer_ppo_measurement_dates()
returns trigger language plpgsql security invoker set search_path=public as $$
declare
  source public.engineering_schedule_activities%rowtype;
  peer public.engineering_schedule_activities%rowtype;
  own public.engineering_schedule_progress_measurements%rowtype;
  same_day public.engineering_schedule_progress_measurements%rowtype;
  start_date date; finish_date date; peer_code text; why text;
begin
  -- The mirrored write still goes through RLS and the existing audit trigger.
  -- Only this trigger's nested echo is skipped; no audit is bypassed.
  if pg_trigger_depth()>1 then return new; end if;
  select * into source from public.engineering_schedule_activities
    where id=new.activity_id and company_id=new.company_id and project_id=new.project_id
      and baseline_id=new.baseline_id and record_status='active';
  if source.id is null or source.code !~ '^(MO-)?(CER|PPO)-' then return new; end if;
  peer_code:=case when source.code like 'MO-%' then substr(source.code,4) else 'MO-'||source.code end;
  select * into peer from public.engineering_schedule_activities
    where company_id=source.company_id and project_id=source.project_id and baseline_id=source.baseline_id
      and location_id is not distinct from source.location_id and code=peer_code and record_status='active';
  if peer.id is null then return new; end if;
  perform id from public.engineering_schedule_activities where id in(source.id,peer.id) order by id for update;
  -- Voiding a replan restores the earlier service dates, not the voided dates.
  select current_start,current_finish into start_date,finish_date
    from public.engineering_schedule_progress_measurements
    where activity_id=source.id and company_id=source.company_id and project_id=source.project_id
      and baseline_id=source.baseline_id and measurement_date<=new.measurement_date and voided_at is null
    order by measurement_date desc,created_at desc,id desc limit 1;
  start_date:=coalesce(start_date,source.planned_start);
  finish_date:=coalesce(finish_date,source.planned_finish);
  select * into same_day from public.engineering_schedule_progress_measurements
    where activity_id=peer.id and company_id=peer.company_id and project_id=peer.project_id
      and baseline_id=peer.baseline_id and measurement_date=new.measurement_date for update;
  select * into own from public.engineering_schedule_progress_measurements
    where activity_id=peer.id and company_id=peer.company_id and project_id=peer.project_id
      and baseline_id=peer.baseline_id and measurement_date<=new.measurement_date and voided_at is null
    order by measurement_date desc,created_at desc,id desc limit 1;
  if (coalesce(own.current_start,peer.planned_start),coalesce(own.current_finish,peer.planned_finish))
      is not distinct from (start_date,finish_date) then return new; end if;
  if same_day.id is not null and same_day.voided_at is not null then
    raise exception 'A medição vinculada de % em % está anulada. Retifique o par antes de reprogramar.',peer.code,new.measurement_date;
  end if;
  why:='DATAS_VINCULADAS_CER_PPO: '||source.code||' -> '||peer.code||
    '. Apenas início/término sincronizados; sem nova medição física ou custo.';
  if same_day.id is not null then
    update public.engineering_schedule_progress_measurements
      set current_start=start_date,current_finish=finish_date,
          notes=concat_ws(E'\n',nullif(notes,''),why),updated_at=now()
      where id=same_day.id and company_id=peer.company_id and project_id=peer.project_id and baseline_id=peer.baseline_id;
  else
    insert into public.engineering_schedule_progress_measurements
      (company_id,project_id,baseline_id,activity_id,measurement_date,progress_percent,actual_quantity,
       actual_cost,team_count,current_start,current_finish,actual_start,actual_finish,notes,created_by)
    values(peer.company_id,peer.project_id,peer.baseline_id,peer.id,new.measurement_date,
      coalesce(own.progress_percent,0),coalesce(own.actual_quantity,0),coalesce(own.actual_cost,0),own.team_count,
      start_date,finish_date,own.actual_start,own.actual_finish,why,auth.uid());
  end if;
  return new;
end; $$;
revoke all on function public.sync_schedule_cer_ppo_measurement_dates() from public,anon,authenticated;

-- One-off repair of Flow. Resolve target by business identity; never by generated IDs.
-- Locks make the administrative backfill atomic and prevent un-audited concurrent writes.
lock table public.engineering_schedule_activities,public.engineering_schedule_progress_measurements,
  public.engineering_schedule_activity_tracking in share row exclusive mode;
drop trigger if exists zz_schedule_cer_ppo_baseline_dates on public.engineering_schedule_activities;
drop trigger if exists zz_execution_cer_ppo_dates on public.engineering_schedule_progress_measurements;
create temporary table _flow_pair_scope on commit drop as
  select p.id project_id,c.id company_id from public.projects p join public.companies c on c.id=p.company_id
  where p.code='FLOW-AP' and c.name='Bossa Empreendimentos';
do $$ begin if (select count(*) from _flow_pair_scope)>1 then raise exception 'Obra Flow ambígua.';end if;end $$;
create temporary table _flow_pair_before on commit drop as
  select m.id,md5(to_jsonb(m)::text) digest from public.engineering_schedule_progress_measurements m
  join _flow_pair_scope s using(project_id,company_id);
create temporary table _flow_pair_activities_before on commit drop as
  select a.id,md5(to_jsonb(a)::text) digest from public.engineering_schedule_activities a
  join _flow_pair_scope s using(project_id,company_id);
create temporary table _flow_pair_repair on commit drop as
  select gen_random_uuid() id,mo.company_id,mo.project_id,mo.baseline_id,mo.id activity_id,
    src.measurement_date,coalesce(own.progress_percent,0) progress_percent,
    coalesce(own.actual_quantity,0) actual_quantity,coalesce(own.actual_cost,0) actual_cost,own.team_count,
    src.current_start,src.current_finish,own.actual_start,own.actual_finish,
    'CER_PPO_DATE_REPAIR_20261021: mão de obra acompanha '||a.code||
      '. Somente datas; avanço físico, quantidades e custos próprios preservados.' notes
  from public.engineering_schedule_activities a join _flow_pair_scope s using(project_id,company_id)
  join public.engineering_schedule_baselines b on b.id=a.baseline_id and b.status='approved'
  join public.engineering_schedule_activities mo on mo.company_id=a.company_id and mo.project_id=a.project_id
    and mo.baseline_id=a.baseline_id and mo.location_id is not distinct from a.location_id
    and mo.code='MO-'||a.code and mo.record_status='active'
  join lateral(select m.* from public.engineering_schedule_progress_measurements m
    where m.activity_id=a.id and m.company_id=a.company_id and m.project_id=a.project_id
      and m.baseline_id=a.baseline_id and m.voided_at is null
    order by m.measurement_date desc,m.created_at desc,m.id desc limit 1) src on true
  left join lateral(select m.* from public.engineering_schedule_progress_measurements m
    where m.activity_id=mo.id and m.company_id=mo.company_id and m.project_id=mo.project_id
      and m.baseline_id=mo.baseline_id and m.voided_at is null
    order by m.measurement_date desc,m.created_at desc,m.id desc limit 1) own on true
  where a.record_status='active' and a.code ~ '^(CER|PPO)-'
    and (src.current_start,src.current_finish) is distinct from
      (coalesce(own.current_start,mo.planned_start),coalesce(own.current_finish,mo.planned_finish));
do $$ begin
  if exists(select 1 from _flow_pair_repair r where r.measurement_date<'2026-09-01'
    or exists(select 1 from public.engineering_schedule_progress_measurements m
      where m.activity_id=r.activity_id and m.measurement_date>=r.measurement_date)) then
    raise exception 'Conflito com histórico de mão de obra. Nenhuma alteração aplicada.';
  end if;
end $$;
-- Administrative migration only. Audit remains mandatory and is inserted explicitly
-- for every new row, with no impersonated user; trigger is restored before commit.
alter table public.engineering_schedule_progress_measurements disable trigger execution_progress_audit;
insert into public.engineering_schedule_progress_measurements
 (id,company_id,project_id,baseline_id,activity_id,measurement_date,progress_percent,actual_quantity,
  actual_cost,team_count,current_start,current_finish,actual_start,actual_finish,notes,created_by)
select id,company_id,project_id,baseline_id,activity_id,measurement_date,progress_percent,actual_quantity,
 actual_cost,team_count,current_start,current_finish,actual_start,actual_finish,notes,null::uuid from _flow_pair_repair;
insert into public.engineering_schedule_progress_audit
 (company_id,project_id,measurement_id,action,previous_value,new_value,created_by)
select m.company_id,m.project_id,m.id,'created',null::jsonb,to_jsonb(m),null::uuid
from public.engineering_schedule_progress_measurements m join _flow_pair_repair r on r.id=m.id;
insert into public.engineering_schedule_activity_tracking
 (company_id,project_id,baseline_id,activity_id,current_start,current_finish,actual_start,actual_finish,
  progress_percent,actual_quantity,actual_cost,team_count,last_measurement_date,notes,updated_by)
select company_id,project_id,baseline_id,activity_id,current_start,current_finish,actual_start,actual_finish,
 progress_percent,actual_quantity,actual_cost,team_count,measurement_date,notes,null::uuid from _flow_pair_repair
on conflict(activity_id) do update set current_start=excluded.current_start,current_finish=excluded.current_finish,
 last_measurement_date=excluded.last_measurement_date,notes=excluded.notes,updated_by=null,updated_at=now();
alter table public.engineering_schedule_progress_measurements enable trigger execution_progress_audit;
do $$ begin
 if exists(select 1 from _flow_pair_before b join public.engineering_schedule_progress_measurements m using(id)
   where md5(to_jsonb(m)::text)<>b.digest) or exists(select 1 from _flow_pair_activities_before b
   join public.engineering_schedule_activities a using(id) where md5(to_jsonb(a)::text)<>b.digest) then
   raise exception 'Histórico, orçamento ou baseline alterados indevidamente.';end if;
 if (select count(*) from _flow_pair_repair)<>(select count(*) from public.engineering_schedule_progress_audit au
   join _flow_pair_repair r on r.id=au.measurement_id) then raise exception 'Auditoria incompleta.';end if;
end $$;

create trigger zz_schedule_cer_ppo_baseline_dates after insert or update of planned_start,planned_finish,duration_days
on public.engineering_schedule_activities for each row execute function public.sync_schedule_cer_ppo_baseline_dates();
create trigger zz_execution_cer_ppo_dates after insert or update
on public.engineering_schedule_progress_measurements for each row execute function public.sync_schedule_cer_ppo_measurement_dates();
commit;
