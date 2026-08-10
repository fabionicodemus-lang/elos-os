import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
type S={koper_id:string;koper_parent_id:string|null;payload:any};
async function all<T>(entity:string){const out:T[]=[];for(let o=0;;o+=1000){const rows=await requestSupabase<T[]>("koper_staging_records",{query:new URLSearchParams({select:"koper_id,koper_parent_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:`eq.${entity}`,sync_state:"eq.present",limit:"1000",offset:String(o),order:"koper_id.asc"})});out.push(...rows);if(rows.length<1000)return out;}}
const entities=["supplier","suppliers","person","provider","vendor","purchase_supplier"];
const found:any[]=[];
for(const e of entities){try{const rows=await all<S>(e);const hits=rows.filter(x=>x.koper_id==="620"||x.koper_id==="621"||JSON.stringify(x.payload).includes('"620"')||JSON.stringify(x.payload).includes('"621"'));if(hits.length)found.push({entity:e,count:rows.length,hits});}catch(err){found.push({entity:e,error:String(err)})}}
console.log("KOPER_SUPPLIERS_620_621",JSON.stringify({ok:true,readOnly:true,found}));