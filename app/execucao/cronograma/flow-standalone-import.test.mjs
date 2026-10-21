import test from "node:test";
import assert from "node:assert/strict";
import { extractFlowSnapshot, finishWorkday, prepareFlowImport } from "./flow-standalone-import.mjs";

const task = i => ({
  id: "T" + String(i).padStart(3,"0"), code:"ALV", name:"Alvenaria",
  locationCode:String(i), location:"Pavto", baselineStart:"2026-09-01",
  start:"2026-09-01", durationDays:5, actualPercent:0,
  actualStart:"", actualEnd:"", measurements:[]
});
const source = () => ({
  project:{name:"Flow Aptos",baselineName:"Baseline 01 — Cronograma 14.07.2026",
    scheduleRevision:{date:"2026-10-06"}},
  tasks:Array.from({length:395},(_,i)=>task(i+1))
});
const html = v => "<script>const INITIAL_DATA = " + JSON.stringify(v) + ";<\\/script>";
const existingActivities = snapshot => snapshot.tasks.map((t,i)=>({
  id:"db-"+t.id, code:"ALV-"+String(i+1), sort_order:i+1,
  planned_start:t.baselineStart,planned_finish:"2026-09-07",
  duration_days:5,quantity_snapshot:10
}));

test("parseia a fonte rigorosamente sem executar JS",()=>{
 const parsed=extractFlowSnapshot(html(source()));
 assert.equal(parsed.tasks.length,395);
 assert.throws(()=>extractFlowSnapshot("alert(1)"),/INITIAL_DATA/);
 assert.throws(()=>extractFlowSnapshot(html({...source(),project:{name:"Outro"}})),/Flow Aptos/);
});
test("calendário acompanha dias úteis, sábados opcionais e marcos",()=>{
 assert.equal(finishWorkday("2026-10-09",5),"2026-10-15");
 assert.equal(finishWorkday("2026-10-10",1),"2026-10-12");
 assert.equal(finishWorkday("2026-10-10",1,{milestone:true}),"2026-10-10");
 assert.equal(finishWorkday("2026-10-09",2,{worksSaturday:true}),"2026-10-10");
 assert.equal(finishWorkday("2026-10-09",2,{holidays:[{date:"2026-10-12"}]}),"2026-10-13");
});
test("mapeia por ordem original; ignora mão de obra e custos sem tocar na baseline",()=>{
 const snapshot=source(), activities=existingActivities(snapshot);
 activities.push({id:"labor",code:"MO-ALV-1",sort_order:1,planned_start:"2026-09-01"});
 activities.push({id:"extra",code:"CUSTO-1",sort_order:913,planned_start:"2026-09-01"});
 snapshot.tasks[0].start="2026-10-13";
 snapshot.tasks[0].actualPercent=60;
 snapshot.tasks[0].measurements=[{date:"2026-09-30",percent:60,notes:"Medição setembro"}];
 const r=prepareFlowImport(snapshot,activities,[]);
 assert.deepEqual(r.rows.map(v=>[v.measurement_date,v.progress_percent,v.current_start,v.actual_quantity]),
 [["2026-09-30",60,"2026-09-01",6],["2026-10-06",60,"2026-10-13",6]]);
 assert.equal(r.summary.matchedActivities,395);
 assert.equal(r.summary.importedMeasurements,1);
 assert.equal(r.summary.newReplans,1);
});
test("não recria agosto e preserva registro existente inclusive anulado",()=>{
 const snapshot=source();
 snapshot.tasks[0].measurements=[
  {date:"2026-08-31",percent:20},
  {date:"2026-09-30",percent:100}
 ];
 const previous=[{activity_id:"db-T001",measurement_date:"2026-09-30",voided_at:"2026-10-15T12:00:00Z"}];
 const result=prepareFlowImport(snapshot,existingActivities(snapshot),previous);
 assert.equal(result.rows.length,0);
 assert.equal(result.summary.existingPreserved,1);
});
test("protege contra regressão física e correspondência parcial",()=>{
 const snapshot=source();
 snapshot.tasks[0].measurements=[{date:"2026-09-30",percent:30}];
 const activities=existingActivities(snapshot);
 assert.throws(()=>prepareFlowImport(snapshot,activities,[{
  activity_id:"db-T001",measurement_date:"2026-08-31",progress_percent:80
 }]),/retrocederia/);
 assert.throws(()=>prepareFlowImport(snapshot,activities.slice(0,394),[]),/faltam atividades/);
 activities[0].planned_start="2026-09-02";
 assert.throws(()=>prepareFlowImport(snapshot,activities,[]),/divergente/);
});
