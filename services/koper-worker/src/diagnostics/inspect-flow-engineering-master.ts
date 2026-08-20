import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
type J=Record<string,unknown>;
const q=(o:Record<string,string>)=>new URLSearchParams(o);
const projectId="ffe8b7ec-1f01-4f6c-8a03-2bd6d3ae94fc";
const rows=(r:string,p:Record<string,string>)=>requestSupabase<J[]>(r,{query:q(p)});
const knownGroupIds=["0c2cbeb2-f352-460d-ab4a-27426cc7b4dc","17eeb249-9ce6-4c53-9f67-658a79d4b7a4"];
let groups:J[]=[]; let services:J[]=[]; let inputs:J[]=[];
let groupError:string|null=null,serviceError:string|null=null,inputError:string|null=null;
try{groups=await rows("engineering_budget_groups",{select:"*",id:`in.(${knownGroupIds.join(",")})`})}catch(e){groupError=String(e)}
try{services=await rows("engineering_services",{select:"*",company_id:`eq.${env.BOSSA_COMPANY_ID}`,limit:"1000",order:"code.asc"})}catch(e){serviceError=String(e)}
try{inputs=await rows("engineering_inputs",{select:"id,code,name,unit,status,company_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,limit:"2000",order:"code.asc"})}catch(e){inputError=String(e)}
console.log("FLOW_ENGINEERING_MASTER",JSON.stringify({ok:true,projectId,groupError,serviceError,inputError,groupRows:groups,serviceCount:services.length,serviceKeys:services[0]?Object.keys(services[0]):[],serviceSamples:services.filter(s=>String(s.code??"").match(/^0?1\./)).slice(0,8).map(s=>({id:s.id,code:s.code,name:s.name,unit:s.unit,group_id:s.group_id,status:s.status})),inputCount:inputs.length,inputSamples:inputs.filter(i=>["ME.01.02","ME.01.03","AL.05.06","AL.05.07"].includes(String(i.code))).map(i=>({id:i.id,code:i.code,name:i.name,unit:i.unit,status:i.status}))}));
