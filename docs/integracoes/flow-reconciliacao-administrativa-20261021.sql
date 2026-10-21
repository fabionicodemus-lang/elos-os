-- Reconciliação pontual e reversível por transação para o cronograma Flow Aptos.
-- Referência: Flow_Cronograma_Historico_Completo_12-10-2026_v2.html.
-- Preflight exige correspondência integral das 395 atividades (datas e códigos).
-- Agosto e registros anteriores são mantidos. Setembro e outubro adicionados.
-- Nenhum usuário é impersonado; auditoria administrativa usa created_by NULL.
-- Atenção: executar como administrador do banco correto, uma única vez.
begin;
set local statement_timeout='120s';
create temporary table _flow_f(pos int, dt date, pct numeric) on commit drop;
insert into _flow_f
select split_part(x,',',1)::int, to_date('2026'||split_part(x,',',2),'YYYYMMDD'),split_part(x,',',3)::numeric
from regexp_split_to_table('17,0930,1;45,1006,100;46,1006,100;47,0930,100;48,0930,100;49,0930,100;60,1006,100;61,1006,100;62,1006,100;63,0930,100;64,1006,1;65,1006,1;75,1006,100;76,1006,100;77,1006,100;78,0930,100;91,1006,100;92,1006,100;93,1006,100;94,0930,100;106,1006,100;107,1006,100;108,1006,100;109,0930,100;122,1006,100;123,1006,100;124,1006,100;125,0930,100;136,0930,100;137,1006,100;138,1006,100;139,1006,100;140,0930,100;151,1006,100;152,0930,100;153,1006,100;154,1006,100;165,1006,100;167,1006,100;168,0930,100;169,1006,100;170,1006,100;181,0930,100;182,0930,100;183,1006,100;184,1006,100;195,0930,100;196,0930,100;197,1006,100;198,1006,100;209,0930,100;210,0930,100;211,1006,100;212,1006,100;223,0930,100;224,0930,100;225,1006,100;226,1006,100;237,0930,100;238,0930,100;239,1006,100;240,1006,100;251,0930,100;252,0930,100;253,1006,100;254,1006,100;265,0930,100;266,0930,100;267,1006,100;268,1006,100;279,0930,100;280,0930,100;281,1006,100;282,1006,100;293,0930,100;294,0930,100;295,1006,100;296,1006,100;297,1006,100;308,0930,100;309,0930,60;310,1006,100;311,1006,100;322,0930,100;335,0930,100;336,0930,100;349,0930,100;350,0930,100;363,0930,100;364,0930,24;380,0930,100;383,0930,1',';') x;
create temporary table _flow_r(pos int, start date, pct numeric) on commit drop;
insert into _flow_r
select split_part(x,',',1)::int,to_date('20'||split_part(x,',',2),'YYYYMMDD'),split_part(x,',',3)::numeric
from regexp_split_to_table('50,261103,0;51,270119,0;52,270202,0;53,270216,0;54,270316,0;55,270323,0;56,270406,0;64,260929,1;65,261006,1;66,261117,0;67,270126,0;68,270209,0;69,270316,0;70,270330,0;71,270413,0;79,261006,0;80,261013,0;81,261124,0;82,270202,0;83,270216,0;84,270316,0;85,270323,0;86,270406,0;87,270420,0;95,261013,0;96,261020,0;97,261201,0;98,270209,0;99,270316,0;100,270330,0;101,270413,0;102,270427,0;110,261020,0;111,261027,0;112,261208,0;113,270216,0;114,270316,0;115,270323,0;116,270406,0;117,270420,0;118,270504,0;126,261020,0;127,261027,0;128,261208,0;129,270316,0;130,270330,0;131,270413,0;132,270427,0;133,270511,0;141,261103,0;142,261110,0;143,261222,0;144,270323,0;145,270406,0;146,270420,0;147,270504,0;148,270518,0;155,261006,0;156,261117,0;157,261124,0;158,270105,0;159,270330,0;160,270413,0;161,270427,0;162,270511,0;163,270525,0;171,261020,0;172,261201,0;173,261208,0;174,270119,0;175,270406,0;176,270420,0;177,270504,0;178,270518,0;179,270601,0;185,261103,0;186,261215,0;187,261222,0;188,270202,0;189,270413,0;190,270427,0;191,270511,0;192,270525,0;193,270608,0;199,261117,0;200,261229,0;201,270105,0;202,270216,0;203,270413,0;204,270427,0;205,270511,0;206,270525,0;207,270608,0;213,261201,0;214,270112,0;215,270119,0;216,270302,0;217,270427,0;218,270511,0;219,270525,0;220,270608,0;221,270622,0;227,261215,0;228,270126,0;229,270202,0;230,270316,0;231,270427,0;232,270511,0;233,270525,0;234,270608,0;235,270622,0;241,261229,0;242,270209,0;243,270216,0;244,270330,0;245,270511,0;246,270525,0;247,270608,0;248,270622,0;249,270706,0;255,270112,0;256,270223,0;257,270302,0;258,270413,0;259,270511,0;260,270525,0;261,270608,0;262,270622,0;263,270706,0;269,270126,0;270,270309,0;271,270316,0;272,270427,0;273,270525,0;274,270608,0;275,270622,0;276,270706,0;277,270720,0;283,270209,0;284,270323,0;285,270330,0;286,270511,0;287,270601,0;288,270615,0;289,270629,0;290,270713,0;291,270727,0;298,270223,0;299,270406,0;300,270413,0;301,270525,0;302,270615,0;303,270629,0;304,270713,0;305,270727,0;306,270810,0;312,270309,0;313,270420,0;314,270427,0;315,270608,0;316,270629,0;317,270713,0;318,270727,0;319,270810,0;320,270824,0;323,261006,0;324,270209,0;325,270223,0;326,270323,0;327,270504,0;328,270511,0;329,270622,0;330,270713,0;331,270727,0;332,270810,0;333,270824,0;334,270907,0;337,261027,0;338,270223,0;339,270309,0;340,270406,0;341,270518,0;342,270525,0;343,270706,0;344,270727,0;345,270810,0;346,270824,0;347,270907,0;348,270921,0;351,261117,0;352,270309,0;353,270323,0;354,270420,0;355,270601,0;356,270608,0;357,270720,0;358,270810,0;359,270824,0;360,270907,0;361,270921,0;362,271005,0;381,261006,0;382,261117,0;383,261229,1;384,270209,0;385,270810,0;386,270907,0;387,271005,0;388,271102,0',';') x;
create temporary table _flow_events on commit drop as
select pos,dt,pct,false as replan from _flow_f
union all select r.pos,date '2026-10-06',r.pct,true from _flow_r r
where not exists(select 1 from _flow_f f where f.pos=r.pos and f.dt=date '2026-10-06');
do $flow$
declare vdates text;vcodes text; 
begin
 if (select count(*) from _flow_f)<>92 or (select count(*) from _flow_r)<>209
 or (select count(*) from _flow_events)<>299 then raise exception 'Fonte Flow incompleta'; end if;
 if (select count(*) from public.engineering_schedule_progress_measurements
   where project_id='fd40811c-9aa3-4c3c-9121-95f19863e70a' and measurement_date>='2026-09-01')<>0
 then raise exception 'Já existem medições de setembro/outubro. Nada alterado.';end if;
 if not exists(select 1 from public.engineering_schedule_baselines where id='b4881a8d-1179-4871-b54a-3522c4c7648a' and project_id='fd40811c-9aa3-4c3c-9121-95f19863e70a' and status='approved')
 then raise exception 'Linha de base não aprovada/errada.';end if;
 select md5(string_agg(planned_start::text,'|' order by sort_order)),
   md5(string_agg(case when code like 'ELE_%' then 'ELE' else split_part(code,'-',1) end,'|' order by sort_order))
 into vdates,vcodes from public.engineering_schedule_activities
 where project_id='fd40811c-9aa3-4c3c-9121-95f19863e70a'
 and baseline_id='b4881a8d-1179-4871-b54a-3522c4c7648a'
 and record_status='active' and code not like 'MO-%' and sort_order between 1 and 395;
 if vdates<>'60bdd7f857d3b82034df71be02b430b2'
 or vcodes<>'14295318f3e69839920f86fc9c41658f' then raise exception 'Baseline e fonte divergentes.';end if;
end $flow$;
create temporary table _flow_prepared on commit drop as
select a.company_id,a.project_id,a.baseline_id,a.id activity_id,e.pos,e.dt,e.pct,
 case when e.dt<'2026-10-06' then a.planned_start else coalesce(r.start,a.planned_start) end current_start,
 case when e.dt<'2026-10-06' then a.planned_finish else
 (select max(sub.dd) from (select gd::date dd from generate_series(coalesce(r.start,a.planned_start),
 coalesce(r.start,a.planned_start)+interval '1000 days',interval '1 day') gd
 where extract(isodow from gd)<=5 order by gd limit greatest(1,a.duration_days)) sub) end current_finish,
 round(coalesce(a.quantity_snapshot,0)*e.pct/100,6) qty,
 case when e.pct=0 then null::date
 when e.pos in(64,65) then date '2026-09-29'
 when prev.progress_percent>e.pct then e.dt
 else coalesce(prev.actual_start,e.dt) end actual_start,
 case when e.pct=100 then e.dt else null::date end actual_finish,
 coalesce(prev.actual_cost,0) actual_cost,prev.team_count,
 case when prev.progress_percent>e.pct then
  'CONCILIACAO_FLOW_20261021 · RETIFICAÇÃO DOCUMENTADA: anterior '||prev.progress_percent||'%, revisado '||e.pct||'%. Registro anterior preservado.'
 else 'CONCILIACAO_FLOW_20261021 · '||case when e.replan then 'Reprogramação 06/10/2026 (sem medição física nova).'
 else 'Medição revisada de setembro/outubro 2026.' end end notes
from _flow_events e join public.engineering_schedule_activities a on a.sort_order=e.pos
left join _flow_r r on r.pos=e.pos
left join lateral (select m.progress_percent,m.actual_start,m.actual_cost,m.team_count
 from public.engineering_schedule_progress_measurements m
 where m.activity_id=a.id and m.measurement_date<e.dt and m.voided_at is null
 order by m.measurement_date desc,m.created_at desc limit 1) prev on true
where a.project_id='fd40811c-9aa3-4c3c-9121-95f19863e70a'
 and a.baseline_id='b4881a8d-1179-4871-b54a-3522c4c7648a'
 and a.record_status='active' and a.code not like 'MO-%' and a.sort_order between 1 and 395;
do $flow$ begin
 if (select count(*) from _flow_prepared)<>299 then raise exception 'Mapeamento incompleto.';end if;
 if exists(select 1 from _flow_prepared where current_finish<current_start or current_start is null) then
  raise exception 'Datas de medição inválidas.';end if;
end $flow$;
-- Lock exclusivo da tabela para não haver escritas de terceiros enquanto
-- o gatilho é suspenso. Todas as 299 entradas de auditoria são lançadas abaixo.
alter table public.engineering_schedule_progress_measurements disable trigger execution_progress_audit;
insert into public.engineering_schedule_progress_measurements
(company_id,project_id,baseline_id,activity_id,measurement_date,progress_percent,actual_quantity,
 actual_cost,team_count,current_start,current_finish,actual_start,actual_finish,notes,created_by)
select company_id,project_id,baseline_id,activity_id,dt,pct,qty,actual_cost,
 team_count,current_start,current_finish,actual_start,actual_finish,notes,null::uuid
from _flow_prepared order by dt,pos;
insert into public.engineering_schedule_progress_audit
(company_id,project_id,measurement_id,action,previous_value,new_value,created_by)
select m.company_id,m.project_id,m.id,'created',null::jsonb,to_jsonb(m),null::uuid
from public.engineering_schedule_progress_measurements m
where m.project_id='fd40811c-9aa3-4c3c-9121-95f19863e70a'
 and m.measurement_date>='2026-09-01' and m.notes like 'CONCILIACAO_FLOW_20261021%';
insert into public.engineering_schedule_activity_tracking
(company_id,project_id,baseline_id,activity_id,current_start,current_finish,actual_start,
 actual_finish,progress_percent,actual_quantity,actual_cost,team_count,last_measurement_date,notes,updated_by)
select m.company_id,m.project_id,m.baseline_id,m.activity_id,m.current_start,m.current_finish,m.actual_start,
 m.actual_finish,m.progress_percent,m.actual_quantity,m.actual_cost,m.team_count,m.measurement_date,m.notes,null::uuid
from (select distinct on (activity_id) * from public.engineering_schedule_progress_measurements
 where project_id='fd40811c-9aa3-4c3c-9121-95f19863e70a' and voided_at is null
 and activity_id in (select distinct activity_id from _flow_prepared)
 order by activity_id,measurement_date desc,created_at desc,id desc) m
on conflict (activity_id) do update set
 current_start=excluded.current_start,current_finish=excluded.current_finish,
 actual_start=excluded.actual_start,actual_finish=excluded.actual_finish,
 progress_percent=excluded.progress_percent,actual_quantity=excluded.actual_quantity,
 actual_cost=excluded.actual_cost,team_count=excluded.team_count,
 last_measurement_date=excluded.last_measurement_date,notes=excluded.notes,
 updated_by=null,updated_at=now();
alter table public.engineering_schedule_progress_measurements enable trigger execution_progress_audit;
do $flow$ begin
 if (select count(*) from public.engineering_schedule_progress_measurements
 where project_id='fd40811c-9aa3-4c3c-9121-95f19863e70a' and measurement_date>='2026-09-01')<>299
 or (select count(*) from public.engineering_schedule_progress_audit
 where project_id='fd40811c-9aa3-4c3c-9121-95f19863e70a'
 and new_value->>'notes' like 'CONCILIACAO_FLOW_20261021%')<>299
 then raise exception 'Verificação de integridade/auditoria falhou';end if;
end $flow$;
select (select count(*) from _flow_f) as progress_events,
 (select count(*) from _flow_r) as replan_events,
 (select count(*) from _flow_prepared) as inserted,
 (select count(*) from _flow_prepared where notes like '%RETIFICAÇÃO%') as corrections,
 (select count(distinct activity_id) from _flow_prepared) as affected_activities;
-- Encerrar com ROLLBACK (ensaio) ou COMMIT (aplicação) explicitamente.
