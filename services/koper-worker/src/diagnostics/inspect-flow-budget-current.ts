import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";

type J=Record<string,unknown>;
const q=(o:Record<string,string>)=>new URLSearchParams(o);
const projectId="ffe8b7ec-1f01-4f6c-8a03-2bd6d3ae94fc";

async function rows(resource:string, params:Record<string,string>):Promise<J[]> {
  return requestSupabase<J[]>(resource,{query:q(params)});
}

const budgets=await rows("engineering_budgets",{select:"*",project_id:`eq.${projectId}`,order:"created_at.asc"});
const budgetSummaries=[] as J[];
for(const b of budgets){
  const bid=String(b.id??"");
  const groups=bid?await rows("engineering_budget_groups",{select:"*",budget_id:`eq.${bid}`,order:"position.asc"}).catch(()=>[]):[];
  const items=bid?await rows("engineering_budget_items",{select:"*",budget_id:`eq.${bid}`,limit:"2000"}).catch(()=>[]):[];
  const numericKeys=new Set<string>();
  for(const it of items.slice(0,30)) for(const [k,v] of Object.entries(it)) if(typeof v==="number"||(!Number.isNaN(Number(v))&&v!==null&&v!=="")) numericKeys.add(k);
  budgetSummaries.push({
    id:b.id,name:b.name,code:b.code,status:b.status,base:b.is_base??b.base??null,created_at:b.created_at,
    budgetKeys:Object.keys(b),groupCount:groups.length,itemCount:items.length,
    groupKeys:groups[0]?Object.keys(groups[0]):[],itemKeys:items[0]?Object.keys(items[0]):[],numericItemKeys:[...numericKeys],
    groupSamples:groups.slice(0,3).map(g=>Object.fromEntries(Object.entries(g).filter(([k])=>["id","code","name","position","total_value","budget_id"].includes(k)))),
    itemSamples:items.slice(0,3).map(it=>Object.fromEntries(Object.entries(it).filter(([k])=>["id","code","name","description","quantity","unit","unit_price","total_price","total_value","service_id","group_id","budget_group_id","budget_id"].includes(k)))),
  });
}
console.log("FLOW_BUDGET_CURRENT",JSON.stringify({ok:true,projectId,budgetCount:budgets.length,budgets:budgetSummaries}));
