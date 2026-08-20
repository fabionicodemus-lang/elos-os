import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
type J=Record<string,unknown>;
const tables=["engineering_inputs","engineering_input_prices","engineering_service_compositions","engineering_service_composition_items","engineering_budget_item_compositions","engineering_budget_item_composition_items"];
const out:Record<string,unknown>={};
for(const table of tables){
  try{
    const rows=await requestSupabase<J[]>(table,{query:new URLSearchParams({select:"*",company_id:`eq.${env.BOSSA_COMPANY_ID}`,limit:"2"})});
    out[table]={ok:true,countSample:rows.length,keys:rows[0]?Object.keys(rows[0]):[],samples:rows};
  }catch(e){
    // Some child tables may not expose company_id; retry without it.
    try{const rows=await requestSupabase<J[]>(table,{query:new URLSearchParams({select:"*",limit:"2"})});out[table]={ok:true,countSample:rows.length,keys:rows[0]?Object.keys(rows[0]):[],samples:rows};}
    catch(e2){out[table]={ok:false,error:String(e2)}}
  }
}
console.log("ENGINEERING_TABLE_SAMPLES",JSON.stringify({ok:true,out}));
