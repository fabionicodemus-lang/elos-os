import {test} from "node:test";
import assert from "node:assert/strict";
import {matchScheduleActivity,planScheduleRow,validScheduleDate} from "./schedule-action-utils.mjs";
const rows=[
 {id:"1",code:"T001",name:"Alvenaria",serviceName:"Alvenaria de vedação",location:"Pavimento 1500",planned_start:"2026-09-01",planned_finish:"2026-09-20"},
 {id:"2",code:"T002",name:"Alvenaria",serviceName:"Alvenaria de vedação",location:"Pavimento 1600",planned_start:"2026-09-01",planned_finish:"2026-09-20"},
 {id:"3",code:"T003",name:"Gesso",serviceName:"Forro de gesso",location:"Pavimento 1400",planned_start:"2026-09-01",planned_finish:"2026-09-20"},
];
test("serviço repetido pede pavimento, nunca escolhe primeira ocorrência",()=>{
  const ambiguous=matchScheduleActivity("alvenaria",null,rows);
  assert.equal(ambiguous.match,null);assert.equal(ambiguous.candidates.length,2);
  assert.equal(matchScheduleActivity("alvenaria","pavimento 1500",rows).match?.id,"1");
  assert.equal(matchScheduleActivity("T002",null,rows).match?.id,"2");
});
test("serviço inexistente não gera coincidência",()=>{
  assert.equal(matchScheduleActivity("Pintura",null,rows).match,null);
});
test("datas inválidas rejeitadas",()=>{
  assert.equal(validScheduleDate("2026-02-30"),false);
  assert.equal(validScheduleDate("2026-09-30"),true);
});
test("medição física acumulada e reprogramação preservam histórico e valores",()=>{
 const last={id:"m1",measurement_date:"2026-08-31",updated_at:"2026-09-01T00:00:00Z",progress_percent:25,
  current_start:"2026-09-01",current_finish:"2026-09-20",actual_start:"2026-08-20",actual_finish:null,
  actual_quantity:12,actual_cost:1234,team_count:2};
 const result=planScheduleRow({percentual:70,novo_inicio:null,novo_fim:"2026-10-14",observacoes:"Produção da equipe"},rows[2],last,"2026-09-30");
 assert.equal(result.progressPercent,70);assert.equal(result.currentFinish,"2026-10-14");
 assert.equal(result.actualCost,1234);assert.equal(result.actualQuantity,12);
 assert.equal(result.expectedLatestId,"m1");assert.equal(result.actualStart,"2026-08-20");
});
test("reprogramação sem nova medição mantém percentual",()=>{
 const result=planScheduleRow({percentual:null,novo_inicio:"2026-11-03",novo_fim:"2026-11-23",observacoes:"Mudança de equipe"},rows[0],null,"2026-10-20");
 assert.equal(result.progressPercent,0);assert.equal(result.currentStart,"2026-11-03");
});
test("impede percentuais regressivos, repetição da data e datas invertidas",()=>{
 const last={id:"m1",measurement_date:"2026-09-30",updated_at:"2026-10-01T00:00:00Z",progress_percent:70,
 current_start:"2026-09-01",current_finish:"2026-09-20",actual_start:"2026-09-03",actual_finish:null,actual_quantity:0,actual_cost:0,team_count:null};
 assert.throws(()=>planScheduleRow({percentual:60,novo_inicio:null,novo_fim:null,observacoes:null},rows[0],last,"2026-10-20"),/regredir/);
 assert.throws(()=>planScheduleRow({percentual:75,novo_inicio:null,novo_fim:null,observacoes:null},rows[0],last,"2026-09-30"),/Já existe/);
 assert.throws(()=>planScheduleRow({percentual:75,novo_inicio:"2026-11-04",novo_fim:"2026-10-01",observacoes:null},rows[0],last,"2026-10-20"),/invertidas/);
});
