import { gunzipSync } from "node:zlib";
const n=(v:unknown)=>typeof v==="number"?v:Number(v??0); const s=(v:unknown)=>String(v??"").trim();
const count=Number(process.env.FLOW_IMPORT_PLAN_PARTS??"0");
const encoded=Array.from({length:count},(_,i)=>process.env[`FLOW_IMPORT_PLAN_${String(i).padStart(2,"0")}`]??"").join("");
const plan=JSON.parse(gunzipSync(Buffer.from(encoded,"base64")).toString("utf8")) as Record<string,unknown>;
const comps=Array.isArray(plan.compositions)?plan.compositions as Record<string,unknown>[]:[];
const bad:Record<string,unknown>[]=[];
for(const c of comps){for(const i of (Array.isArray(c.items)?c.items as Record<string,unknown>[]:[])){if(n(i.coefficient)<=0)bad.push({service_code:s(c.service_code),input_code:s(i.input_code),coefficient:n(i.coefficient),effective_coefficient:n(i.effective_coefficient),unit_price:n(i.unit_price),price_source:s(i.price_source),notes:i.notes??null});}}
console.log("FLOW_ZERO_COMPOSITION_ITEMS",JSON.stringify({count:bad.length,bad}));
