// Atualização conversacional do Controle do Cronograma. A IA só PREPARA;
// um revisor autorizado confirma a operação transacional no banco.
import type {ElosIaPersonaKey} from "./personas";
import type {ElosIaToolContext} from "./tools";
import {fetchAllRows} from "@/lib/supabase-pagination";
import {matchUniqueCandidate} from "./action-utils.mjs";
import {matchScheduleActivity,planScheduleRow,validScheduleDate,normalizeScheduleTerm} from "./schedule-action-utils.mjs";

export type ScheduleActionName="consultar_atividades_cronograma"|"preparar_atualizacao_cronograma";
export type ScheduleActionContext=ElosIaToolContext&{userId:string;turnId:string;persona:ElosIaPersonaKey};
type Activity={id:string;code:string;name:string;service_id:string|null;location_id:string|null;planned_start:string;planned_finish:string;duration_days:number;record_status:string};
type ResolvedActivity=Activity&{location:string;locationCode:string;serviceName:string;serviceCode:string};
type Measurement={id:string;activity_id:string;measurement_date:string;progress_percent:number;actual_quantity:number;actual_cost:number;team_count:number|null;current_start:string;current_finish:string;actual_start:string|null;actual_finish:string|null;updated_at:string;voided_at:string|null};
type ToolArgs=Record<string,unknown>;
function str(x:unknown){return typeof x==="string"?x.trim():"";}
function resolveProject(ctx:ScheduleActionContext,raw:unknown){
  if(!raw){const a=ctx.projects.find(p=>p.id===ctx.activeProjectId);if(a)return a;if(ctx.projects.length===1)return ctx.projects[0];throw new Error("Selecione a obra no cabeçalho ou informe qual obra deseja atualizar.");}
  const find=matchUniqueCandidate(str(raw),ctx.projects,p=>[p.code,p.name,[p.code,p.name].filter(Boolean).join(" ")]);
  if(!find.match)throw new Error(find.reason==="ambiguous"?"Há mais de uma obra correspondente. Informe o código.":"Não encontrei essa obra.");
  return find.match;
}
async function loadSchedule(ctx:ScheduleActionContext,raw:unknown,baseRaw:unknown){
  const project=resolveProject(ctx,raw);
  const bs=await ctx.supabase.from("engineering_schedule_baselines").select("id,code,name,version,status")
    .eq("company_id",ctx.companyId).eq("project_id",project.id).eq("status","approved");
  if(bs.error)throw new Error(bs.error.message);
  const baselines=(bs.data??[]) as Array<{id:string;code:string;name:string;version:string;status:string}>;
  const requested=str(baseRaw);
  const baseline=requested?matchUniqueCandidate(requested,baselines,b=>[b.code,b.name,b.version]).match:baselines.length===1?baselines[0]:null;
  if(!baseline)throw new Error(!baselines.length?"A obra não tem linha de base aprovada. Aprove o cronograma em Pré-Obra.":"Informe a linha de base aprovada (código). Opções: "+baselines.map(b=>b.code+" · "+b.name).join("; "));
  const [act,places,services]=await Promise.all([
    fetchAllRows<Activity>(async(from,to)=>{const q=await ctx.supabase.from("engineering_schedule_activities").select("id,code,name,service_id,location_id,planned_start,planned_finish,duration_days,record_status").eq("company_id",ctx.companyId).eq("project_id",project.id).eq("baseline_id",baseline.id).eq("record_status","active").order("sort_order").range(from,to);return {data:(q.data??[]) as Activity[],error:q.error};}),
    fetchAllRows<{id:string;code:string;name:string}>(async(from,to)=>{const q=await ctx.supabase.from("engineering_takeoff_locations").select("id,code,name").eq("company_id",ctx.companyId).eq("project_id",project.id).range(from,to);return {data:(q.data??[]) as Array<{id:string;code:string;name:string}>,error:q.error};}),
    fetchAllRows<{id:string;code:string;description:string}>(async(from,to)=>{const q=await ctx.supabase.from("engineering_services").select("id,code,description").eq("company_id",ctx.companyId).range(from,to);return {data:(q.data??[]) as Array<{id:string;code:string;description:string}>,error:q.error};}),
  ]);
  if(act.error||places.error||services.error)throw new Error("Não consegui conferir serviços e pavimentos no cronograma. Nada foi preparado.");
  const lm=new Map(places.data.map(p=>[p.id,p])),sm=new Map(services.data.map(s=>[s.id,s]));
  const activities:ResolvedActivity[]=act.data.map(a=>({...a,location:lm.get(a.location_id||"")?.name||"",locationCode:lm.get(a.location_id||"")?.code||"",serviceName:sm.get(a.service_id||"")?.description||"",serviceCode:sm.get(a.service_id||"")?.code||""}));
  return {project,baseline,activities};
}
const nullableText={type:["string","null"]};
const schemaItems={type:"array",minItems:1,maxItems:25,items:{type:"object",additionalProperties:false,properties:{
  servico:{type:"string",description:"Código exato da atividade ou descrição do serviço."},
  local:{...nullableText,description:"Pavimento/local informado pelo usuário. Null somente se serviço identificar exatamente uma atividade."},
  percentual:{type:["number","null"],description:"Percentual acumulado executado, entre 0 e 100; null para alterar somente datas preservando percentual."},
  novo_inicio:{...nullableText,description:"Nova data de início AAAA-MM-DD ou null."},
  novo_fim:{...nullableText,description:"Nova data de término AAAA-MM-DD ou null."},
  observacoes:{...nullableText,description:"Justificativa/observação da medição ou reprogramação."},
},required:["servico","local","percentual","novo_inicio","novo_fim","observacoes"]}};
const tools=[
 {name:"consultar_atividades_cronograma" as const,label:"Buscar atividades do cronograma",description:"Procure códigos, serviços, locais e porcentagens no cronograma cadastrado antes de preparar uma medição. Se houver vários locais, pergunte qual; não escolha um ao acaso.",permissions:["execution.schedule.view"],properties:{obra:nullableText,linha_base:nullableText,buscar:{type:"string",description:"Palavra do serviço, código ou pavimento."}}},
 {name:"preparar_atualizacao_cronograma" as const,label:"Preparar medição e reprogramação",description:"Prepara uma ou várias medições/reprogramações para revisão. NUNCA execute sem cartão confirmado. Só chame quando usuário informar período e serviço/local/percentual ou novas datas; pergunte pelo dado ambíguo. Percentuais são ACUMULADOS, não incrementos. Para serviços repetidos em pavimentos diferentes, exija local. Até 25 atividades.",permissions:["execution.schedule.manage"],properties:{
  obra:nullableText,linha_base:nullableText,
  data_medicao:{type:"string",description:"AAAA-MM-DD da medição. Para fechamento mensal, use o último dia do mês explicitado, com ano definido pelo contexto. Nunca data no futuro."},
  itens:schemaItems,
 }}
];
const byName=new Map(tools.map(t=>[t.name,t]));
export function scheduleToolsForPersona(p:ElosIaPersonaKey):ScheduleActionName[]{return p==="engenharia"||p==="diretoria"?["consultar_atividades_cronograma","preparar_atualizacao_cronograma"]:[];}
export function isScheduleActionTool(n:string):n is ScheduleActionName{return byName.has(n as ScheduleActionName);}
export function scheduleActionToolLabel(n:string){return byName.get(n as ScheduleActionName)?.label||n;}
export function scheduleActionToolSchemas(names:ScheduleActionName[]){return names.map(n=>byName.get(n)).filter((x):x is typeof tools[number]=>Boolean(x)).map(t=>({type:"function" as const,name:t.name,description:t.description,strict:true,parameters:{type:"object",additionalProperties:false,properties:t.properties,required:Object.keys(t.properties)}}));}
export async function runScheduleActionTool(ctx:ScheduleActionContext,allowed:ScheduleActionName[],name:string,args:ToolArgs){
  const t=byName.get(name as ScheduleActionName);
  if(!t||!allowed.includes(t.name))return {erro:"A função não está disponível nesta persona."};
  if(!t.permissions.every(p=>ctx.can(p)||p==="execution.schedule.view"&&ctx.can("execution.schedule.manage")))return {erro:"Falta permissão para consultar/atualizar o cronograma."};
  try{
    const {project,baseline,activities}=await loadSchedule(ctx,args.obra,args.linha_base);
    if(t.name==="consultar_atividades_cronograma"){
      const search=normalizeScheduleTerm(args.buscar);
      if(search.length<2)throw new Error("Informe ao menos duas letras de busca.");
      const matches=activities.filter(a=>[a.name,a.code,a.serviceName,a.serviceCode,a.location,a.locationCode].some(v=>normalizeScheduleTerm(v).includes(search))).slice(0,25);
      if(!matches.length)return {obra:project.name,linha_base:baseline.code,encontradas:0,instrucao:"Nenhuma atividade foi encontrada. Confirme o nome/código, pavimento ou se o serviço precisa ser cadastrado no planejamento."};
      const ids=matches.map(a=>a.id);
      const history=await ctx.supabase.from("engineering_schedule_activity_tracking").select("activity_id,progress_percent,current_start,current_finish,last_measurement_date").eq("company_id",ctx.companyId).eq("project_id",project.id).in("activity_id",ids);
      if(history.error)throw new Error(history.error.message);
      const map=new Map((history.data||[]).map(x=>[x.activity_id,x]));
      return {obra:project.name,linha_base:baseline.code,encontradas:matches.length,atividades:matches.map(a=>({codigo:a.code,servico:a.name,servico_cadastro:a.serviceName,local:a.location,previsto_inicio:a.planned_start,previsto_fim:a.planned_finish,executado_percentual:map.get(a.id)?.progress_percent??0,inicio_atual:map.get(a.id)?.current_start||a.planned_start,fim_atual:map.get(a.id)?.current_finish||a.planned_finish,ultima_medicao:map.get(a.id)?.last_measurement_date??null}))};
    }
    const date=str(args.data_medicao);
    if(!validScheduleDate(date)||date>ctx.today)throw new Error("Informe data de medição válida, até hoje. Data futura só pode ser usada como data reprogramada.");
    const itens=Array.isArray(args.itens)?args.itens as Array<Record<string,unknown>>:[];
    if(!itens.length||itens.length>25)throw new Error("Envie entre 1 e 25 atividades por revisão.");
    const selected: Array<{activity:ResolvedActivity;raw:Record<string,unknown>}>=[];
    const errors:string[]=[];const seen=new Set<string>();
    for(const raw of itens){
      const wanted=str(raw.servico),loc=str(raw.local);
      const m=matchScheduleActivity(wanted,loc||null,activities);
      if(!m.match){errors.push('Serviço "'+wanted+'"'+(loc?" em "+loc:"")+": "+m.reason+(m.candidates.length?" Opções: "+m.candidates.map(c=>[c.code,c.name,c.location].filter(Boolean).join(" · ")).join("; "):""));continue;}
      if(seen.has(m.match.id)){errors.push("A atividade "+m.match.code+" foi citada mais de uma vez. Consolide em um único percentual/data.");continue;}
      seen.add(m.match.id); selected.push({activity:m.match,raw});
    }
    if(errors.length)return {precisa_esclarecimento:true,problemas:errors,instrucao:"Faça perguntas objetivas ao usuário sobre cada item e só prepare o cartão quando todos tiverem identificação única. Nenhum lançamento foi feito."};
    const ids=selected.map(s=>s.activity.id);
    const measured=await fetchAllRows<Measurement>(async(from,to)=>{const q=await ctx.supabase.from("engineering_schedule_progress_measurements")
      .select("id,activity_id,measurement_date,progress_percent,actual_quantity,actual_cost,team_count,current_start,current_finish,actual_start,actual_finish,updated_at,voided_at")
      .eq("company_id",ctx.companyId).eq("project_id",project.id).eq("baseline_id",baseline.id).in("activity_id",ids)
      .is("voided_at",null).order("measurement_date",{ascending:false}).range(from,to);
      return {data:(q.data||[]) as Measurement[],error:q.error};});
    if(measured.error)throw new Error("Falha ao conferir medições existentes. Não criei o cartão.");
    const last=new Map<string,Measurement>();
    for(const m of measured.data)if(!last.has(m.activity_id))last.set(m.activity_id,m);
    const rows=[] as ReturnType<typeof planScheduleRow>[];
    for(const {activity,raw} of selected){
      try{
        if(raw.percentual==null && !raw.novo_inicio && !raw.novo_fim)throw new Error("Informe percentual executado ou alguma nova data.");
        if(raw.novo_inicio!=null&&!validScheduleDate(raw.novo_inicio)||raw.novo_fim!=null&&!validScheduleDate(raw.novo_fim))throw new Error("Data reprogramada inválida.");
        const row=planScheduleRow({percentual:typeof raw.percentual==="number"?raw.percentual:null,novo_inicio:str(raw.novo_inicio)||null,novo_fim:str(raw.novo_fim)||null,observacoes:str(raw.observacoes)||null},activity,last.get(activity.id)||null,date);
        if(row.progressPercent===100 && row.actualFinish && row.actualFinish>date)throw new Error("Conclusão real não pode ser posterior à data da medição.");
        rows.push(row);
      }catch(e){errors.push(activity.code+" · "+activity.name+" · "+activity.location+": "+(e instanceof Error?e.message:"Valor inválido"));}
    }
    if(errors.length)return {precisa_esclarecimento:true,problemas:errors,instrucao:"Peça correção dos itens antes de preparar. Nenhum registro foi alterado."};
    const preview={kind:"execution_schedule_update",blocked:false,project:{id:project.id,label:[project.code,project.name].filter(Boolean).join(" · ")},baseline:{id:baseline.id,code:baseline.code,name:baseline.name},measurementDate:date,items:rows.map((row,i)=>({...row,name:selected[i].activity.name,location:selected[i].activity.location,service:selected[i].activity.serviceName}))};
    const title="Cronograma · "+project.name+" · "+date.split("-").reverse().join("/");
    const summary=rows.length+" atividade(s): avanço físico e/ou reprogramação. Nenhum valor orçamentário alterado.";
    const inserted=await ctx.supabase.from("ai_action_proposals").insert({company_id:ctx.companyId,project_id:project.id,turn_id:ctx.turnId,persona:ctx.persona,action_type:"execution_schedule_update",required_permission:"pending-trigger",title,summary,payload:{baselineId:baseline.id,measurementDate:date,items:rows},preview,created_by:ctx.userId}).select("id").single();
    if(inserted.error||!inserted.data)throw new Error("Não foi possível preparar o cartão: "+(inserted.error?.message||"erro desconhecido")+" (verifique se a migração do recurso já foi aplicada).");
    return {acao_preparada:true,action_id:inserted.data.id,obra:project.name,linha_base:baseline.code,data_medicao:date,atividades:rows.length,proxima_etapa:"O usuário deve conferir o cartão e clicar em Revisado · lançar no Elos. Só então a transação grava os dados."};
  }catch(e){return {erro:e instanceof Error?e.message:"Falha ao preparar atualização. Nada foi alterado."};}
}
