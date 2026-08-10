import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
type Json=Record<string,unknown>; type Stage={koper_id:string;koper_parent_id:string|null;payload:unknown}; type Order={id:string;source_id:string|null}; type Receipt={id:string;order_id:string;notes:string|null};
const obj=(v:unknown):Json=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as Json:{};
const id=(v:unknown):string|null=>(typeof v==="string"||typeof v==="number")&&String(v).trim()?String(v).trim():null;
const arr=(v:unknown):Json[]=>Array.isArray(v)?v.map(obj):[];
const unique=(v:unknown,k:string)=>[...new Set(arr(v).flatMap(r=>{const x=id(r[k]);return x?[x]:[]}))];
function invoiceIds(p:Json){const n=unique(p.invoices,"invoiceId");if(n.length)return n;return Array.isArray(p.invoiceIds)?[...new Set(p.invoiceIds.flatMap(v=>{const x=id(v);return x?[x]:[]}))]:[]}
function marker(notes:string|null){return notes?.match(/Koper stockMovementId=(\d+)/i)?.[1]??null}
async function all<T>(table:string,q:Record<string,string>){const out:T[]=[];for(let o=0;;o+=1000){const p=await requestSupabase<T[]>(table,{query:new URLSearchParams({...q,limit:"1000",offset:String(o)})});out.push(...p);if(p.length<1000)return out}}
await import("./index.js");
const [invoices,stockEntries,stockItems,orders,receipts]=await Promise.all([
 all<Stage>("koper_staging_records",{select:"koper_id,koper_parent_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.xml_invoice",sync_state:"eq.present",order:"koper_id.asc"}),
 all<Stage>("koper_staging_records",{select:"koper_id,koper_parent_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.stock_entry",sync_state:"eq.present",order:"koper_id.asc"}),
 all<Stage>("koper_staging_records",{select:"koper_id,koper_parent_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.stock_entry_item",sync_state:"eq.present",order:"koper_parent_id.asc"}),
 all<Order>("procurement_purchase_orders",{select:"id,source_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper",order:"source_id.asc"}),
 all<Receipt>("procurement_material_receipts",{select:"id,order_id,notes",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"})]);
const orderBySource=new Map(orders.flatMap(o=>o.source_id?[[o.source_id,o] as const]:[]));
const entryById=new Map(stockEntries.map(e=>[e.koper_id,e]));
const entryIdsByInvoice=new Map<string,Set<string>>(); for(const s of stockItems){if(!s.koper_parent_id)continue;for(const inv of invoiceIds(obj(s.payload))){const set=entryIdsByInvoice.get(inv)??new Set<string>();set.add(s.koper_parent_id);entryIdsByInvoice.set(inv,set)}}
const receiptEntryIds=new Set(receipts.flatMap(r=>{const m=marker(r.notes);return m?[m]:[]}));
const targets:string[]=[]; for(const inv of invoices){const p=obj(inv.payload);const native=[...new Map(unique(p.purchaseOrders,"purchaseOrderId").flatMap(source=>{const o=orderBySource.get(source);return o?[[o.id,o] as const]:[]})).values()];if(native.length!==1)continue;const entries=[...(entryIdsByInvoice.get(inv.koper_id)??new Set<string>())];if(entries.length&&entries.every(e=>!receiptEntryIds.has(e)))targets.push(...entries)}
const uniqueTargets=[...new Set(targets)]; const rows=uniqueTargets.map(entryId=>{const p=obj(entryById.get(entryId)?.payload);return {entryId,originType:id(p.originType),status:id(p.status),situation:id(p.situation),movementType:id(p.movementType),movementDate:id(p.movementDate),entryDate:id(p.entryDate),keys:Object.keys(p).sort()}});
const count=(key:string)=>rows.reduce<Record<string,number>>((a,r)=>{const v=String((r as any)[key]??"null");a[v]=(a[v]??0)+1;return a},{});
console.log("KOPER_NFE_MISSING_RECEIPT_ENTRY_SEMANTICS",JSON.stringify({ok:true,readOnly:true,targetEntries:uniqueTargets.length,originTypes:count("originType"),statuses:count("status"),situations:count("situation"),movementTypes:count("movementType"),examples:rows.slice(0,30)}));
