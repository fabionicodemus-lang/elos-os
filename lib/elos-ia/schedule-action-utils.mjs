// Correspondência determinística de atividades do cronograma: nunca escolhe a primeira
// quando serviços e pavimentos similares levam a mais de um resultado.
export function normalizeScheduleTerm(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
export function matchScheduleActivity(request, location, activities) {
  const wanted=normalizeScheduleTerm(request), place=normalizeScheduleTerm(location);
  if (!wanted) return {match:null,reason:"Informe o serviço ou código da atividade.",candidates:[]};
  const pool=(activities??[]).filter(a=>!place || [a.location,a.locationCode].some(s=>normalizeScheduleTerm(s)===place || (normalizeScheduleTerm(s).length>2 && normalizeScheduleTerm(s).includes(place))));
  const matchCode=pool.filter(a=>normalizeScheduleTerm(a.code)===wanted);
  if(matchCode.length===1)return {match:matchCode[0],reason:null,candidates:[]};
  const direct=pool.filter(a=>[a.name,a.serviceName,a.serviceCode].some(s=>normalizeScheduleTerm(s)===wanted));
  const possible=direct.length?direct:pool.filter(a=>[a.name,a.serviceName,a.serviceCode].some(s=>{
    const term=normalizeScheduleTerm(s);
    return wanted.length>=4 && (term.includes(wanted) || (term.length>=5 && wanted.includes(term)));
  }));
  if(possible.length===1) return {match:possible[0],reason:null,candidates:[]};
  return {match:null,reason:possible.length?"Há mais de uma atividade correspondente. Informe o pavimento ou o código exato.":"Não encontrei essa atividade no cronograma; confirme o serviço, local ou código.",candidates:possible.slice(0,8).map(a=>({code:a.code,name:a.name,location:a.location}))};
}
export function validScheduleDate(value) {
  if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d=new Date(value+"T12:00:00.000Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===value;
}
export function planScheduleRow(item,activity,latest,measurementDate) {
  if(!validScheduleDate(measurementDate))throw new Error("Informe uma data real de medição no formato AAAA-MM-DD.");
  if(latest && measurementDate<=latest.measurement_date)throw new Error("Já existe medição nesta data ou posterior; indique um novo período ou faça uma retificação pelo histórico.");
  const prior=Number(latest?.progress_percent??0), raw=item.percentual;
  const percent=raw===null||raw===undefined?prior:Number(raw);
  if(!Number.isFinite(percent)||percent<0||percent>100)throw new Error("Percentual inválido; use 0 a 100.");
  if(percent<prior)throw new Error("O avanço não pode regredir de "+prior+"% para "+percent+"%. Para corrigir medição anterior, use a retificação no histórico.");
  const previousStart=latest?.current_start||activity.planned_start;
  const previousFinish=latest?.current_finish||activity.planned_finish;
  const start=item.novo_inicio||previousStart;
  // Se o usuário alterar só o início, conserva a duração do período atual
  // e desloca automaticamente o término, que sempre será mostrado no cartão.
  let finish=item.novo_fim||previousFinish;
  if(item.novo_inicio && !item.novo_fim) {
    const delta=(Date.parse(start+"T12:00:00Z")-Date.parse(previousStart+"T12:00:00Z"))/86400000;
    finish=new Date(Date.parse(previousFinish+"T12:00:00Z")+delta*86400000).toISOString().slice(0,10);
  }
  if(!validScheduleDate(start)||!validScheduleDate(finish)||finish<start)throw new Error("As datas de início/término reprogramadas são inválidas ou invertidas.");
  const previousActualStart=latest?.actual_start??null;
  const actualStart=previousActualStart||(percent>0?measurementDate:null);
  const actualFinish=percent===100?(latest?.actual_finish||measurementDate):null;
  if(actualStart && start>actualStart && item.novo_inicio)throw new Error("Não é possível mover o início planejado para depois do início efetivamente executado.");
  if(actualFinish && actualStart && actualFinish<actualStart)throw new Error("Término real anterior ao início real.");
  return {activityId:activity.id,code:activity.code,measurementDate,progressPercent:percent,
    currentStart:start,currentFinish:finish,actualStart,actualFinish,
    actualQuantity:Number(latest?.actual_quantity??0),actualCost:Number(latest?.actual_cost??0),
    teamCount:latest?.team_count??null,notes:String(item.observacoes||"").trim(),
    expectedLatestId:latest?.id??null,expectedLatestUpdatedAt:latest?.updated_at??null,
    previousPercent:prior,previousStart:latest?.current_start||activity.planned_start,previousFinish:latest?.current_finish||activity.planned_finish};
}
