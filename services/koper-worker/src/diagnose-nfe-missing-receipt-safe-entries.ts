import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json=Record<string,unknown>;
type Stage={koper_id:string;koper_parent_id:string|null;payload:unknown};
type Order={id:string;source_id:string|null;order_number:string};
type OrderItem={id:string;order_id:string;input_id:string;source_id:string|null;received_quantity:number;accepted_quantity:number};
type Input={id:string;source_id:string|null};
type Receipt={id:string;order_id:string;notes:string|null};
const obj=(v:unknown):Json=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as Json:{};
const id=(v:unknown):string|null=>{if(typeof v!=="string"&&typeof v!=="number")return null;const s=String(v).trim();return s||null};
const num=(v:unknown):number|null=>typeof v==="number"&&Number.isFinite(v)?v:typeof v==="string"&&v.trim()&&Number.isFinite(Number(v))?Number(v):null;
const ids=(v:unknown):string[]=>Array.isArray(v)?[...new Set(v.flatMap(x=>id(x)?[id(x)!]:[]))]:[];
const arr=(v:unknown):Json[]=>Array.isArray(v)?v.map(obj):[];
const uniqueObjects=(v:unknown,key:string)=>[...new Set(arr(v).flatMap(r=>{const x=id(r[key]);return x?[x]:[]}))];
const sourceProductIds=(p:Json)=>[...new Set([id(p.mainProductId),id(p.productId),id(p.inputId),id(p.genericProdSeq)].filter((x):x is string=>Boolean(x)))];
const base=(v:string|null)=>id(v)?.split(":")[0]??null;
const approx=(a:number,b:number)=>Math.abs(a-b)<=Math.max(0.000001,Math.abs(b)*0.000001);
function invoiceIdsFromItem(p:Json){const nested=uniqueObjects(p.invoices,"invoiceId");if(nested.length)return nested;return ids(p.invoiceIds)}
function marker(notes:string|null){return notes?.match(/Koper stockMovementId=(\d+)/i)?.[1]??null}
async function all<T>(table:string,q:Record<string,string>){const out:T[]=[];for(let o=0;;o+=1000){const page=await requestSupabase<T[]>(table,{query:new URLSearchParams({...q,limit:"1000",offset:String(o)})});out.push(...page);if(page.length<1000)return out}}

await import("./index.js");
const [entries,items,invoices,orders,orderItems,inputs,receipts]=await Promise.all([
 all<Stage>("koper_staging_records",{select:"koper_id,koper_parent_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.stock_entry",sync_state:"eq.present",order:"koper_id.asc"}),
 all<Stage>("koper_staging_records",{select:"koper_id,koper_parent_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.stock_entry_item",sync_state:"eq.present",order:"koper_id.asc"}),
 all<Stage>("koper_staging_records",{select:"koper_id,koper_parent_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.xml_invoice",sync_state:"eq.present",order:"koper_id.asc"}),
 all<Order>("procurement_purchase_orders",{select:"id,source_id,order_number",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper",order:"source_id.asc"}),
 all<OrderItem>("procurement_purchase_order_items",{select:"id,order_id,input_id,source_id,received_quantity,accepted_quantity",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper",order:"order_id.asc"}),
 all<Input>("engineering_inputs",{select:"id,source_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper",order:"source_id.asc"}),
 all<Receipt>("procurement_material_receipts",{select:"id,order_id,notes",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"})
]);
const entryById=new Map(entries.map(e=>[e.koper_id,e]));
const orderBySource=new Map(orders.flatMap(o=>o.source_id?[[o.source_id,o] as const]:[]));
const inputBySource=new Map(inputs.flatMap(i=>i.source_id?[[i.source_id,i] as const]:[]));
const orderItemsByOrder=new Map<string,OrderItem[]>();for(const oi of orderItems)orderItemsByOrder.set(oi.order_id,[...(orderItemsByOrder.get(oi.order_id)??[]),oi]);
const receiptEntries=new Set(receipts.flatMap(r=>{const m=marker(r.notes);return m?[m]:[]}));
const entryIdsByInvoice=new Map<string,Set<string>>();for(const item of items){if(!item.koper_parent_id)continue;for(const invoiceId of invoiceIdsFromItem(obj(item.payload))){const set=entryIdsByInvoice.get(invoiceId)??new Set<string>();set.add(item.koper_parent_id);entryIdsByInvoice.set(invoiceId,set)}}
const targetEntries=new Set<string>();
for(const invoice of invoices){const p=obj(invoice.payload);const nativeOrders=[...new Map(uniqueObjects(p.purchaseOrders,"purchaseOrderId").flatMap(source=>{const o=orderBySource.get(source);return o?[[o.id,o] as const]:[]})).values()];if(nativeOrders.length!==1)continue;const order=nativeOrders[0]!;const linked=[...(entryIdsByInvoice.get(invoice.koper_id)??new Set<string>())];const matchingReceipts=receipts.filter(r=>linked.includes(marker(r.notes)??"")&&r.order_id===order.id);if(linked.length&&matchingReceipts.length===0)linked.forEach(e=>targetEntries.add(e));}

const programmed=new Set(entries.filter(e=>id(obj(e.payload).originType)==="0").map(e=>e.koper_id));
const programmedItems=items.filter(i=>i.koper_parent_id&&programmed.has(i.koper_parent_id));
const sourceCount=new Map<string,number>();const resolvedCount=new Map<string,number>();
type Res={entryId:string;groupKey:string;reason?:string};const resolved:Res[]=[];
const itemReasons=new Map<string,Record<string,number>>();
const addReason=(entryId:string,reason:string)=>{const r=itemReasons.get(entryId)??{};r[reason]=(r[reason]??0)+1;itemReasons.set(entryId,r)};
for(const source of programmedItems){const entryId=source.koper_parent_id!;sourceCount.set(entryId,(sourceCount.get(entryId)??0)+1);const p=obj(source.payload);const candidates=ids(p.candidatePurchaseOrderIds).flatMap(sourceId=>{const o=orderBySource.get(sourceId);return o?[o]:[]});if(candidates.length===0){addReason(entryId,"missingOrder");continue}const inputNative=new Set(sourceProductIds(p).flatMap(sourceId=>{const i=inputBySource.get(sourceId);return i?[i.id]:[]}));if(inputNative.size===0){addReason(entryId,"missingInput");continue}const groups=new Map<string,OrderItem[]>();for(const order of candidates){for(const oi of orderItemsByOrder.get(order.id)??[]){if(!inputNative.has(oi.input_id))continue;const sourcePurchaseItemId=base(oi.source_id);if(!sourcePurchaseItemId)continue;const key=`${order.id}:${sourcePurchaseItemId}`;groups.set(key,[...(groups.get(key)??[]),oi])}}if(groups.size===0){addReason(entryId,"missingOrderItem");continue}if(groups.size>1){addReason(entryId,"ambiguousSourceItem");continue}const [groupKey,groupRows]=[...groups.entries()][0]!;if(groupRows.length!==1){addReason(entryId,"allocationSplit");continue}const quantity=num(p.productAmount)??0;if(quantity<=0){addReason(entryId,"invalidQuantity");continue}resolved.push({entryId,groupKey});resolvedCount.set(entryId,(resolvedCount.get(entryId)??0)+1);}
const stagingQtyByGroup=new Map<string,number>();
for(const source of programmedItems){const entryId=source.koper_parent_id!;const p=obj(source.payload);const candidates=ids(p.candidatePurchaseOrderIds).flatMap(sourceId=>{const o=orderBySource.get(sourceId);return o?[o]:[]});const inputNative=new Set(sourceProductIds(p).flatMap(sourceId=>{const i=inputBySource.get(sourceId);return i?[i.id]:[]}));const groups=new Map<string,OrderItem[]>();for(const order of candidates){for(const oi of orderItemsByOrder.get(order.id)??[]){if(!inputNative.has(oi.input_id))continue;const sid=base(oi.source_id);if(!sid)continue;const key=`${order.id}:${sid}`;groups.set(key,[...(groups.get(key)??[]),oi])}}if(groups.size!==1)continue;const [key,rows]=[...groups.entries()][0]!;if(rows.length!==1)continue;const q=num(p.productAmount)??0;if(q<=0)continue;stagingQtyByGroup.set(key,(stagingQtyByGroup.get(key)??0)+q);}
const acceptedByGroup=new Map<string,number>();const receivedByGroup=new Map<string,number>();for(const oi of orderItems){const sid=base(oi.source_id);if(!sid)continue;const key=`${oi.order_id}:${sid}`;acceptedByGroup.set(key,(acceptedByGroup.get(key)??0)+Number(oi.accepted_quantity??0));receivedByGroup.set(key,(receivedByGroup.get(key)??0)+Number(oi.received_quantity??0));}
const exactGroups=new Set([...stagingQtyByGroup.entries()].flatMap(([key,q])=>approx(q,acceptedByGroup.get(key)??0)&&approx(q,receivedByGroup.get(key)??0)?[key]:[]));
const groupsByEntry=new Map<string,string[]>();for(const r of resolved)groupsByEntry.set(r.entryId,[...(groupsByEntry.get(r.entryId)??[]),r.groupKey]);
const safeEntries=new Set<string>();for(const entryId of programmed){const sc=sourceCount.get(entryId)??0;const rc=resolvedCount.get(entryId)??0;const gs=groupsByEntry.get(entryId)??[];if(sc>0&&sc===rc&&gs.every(g=>exactGroups.has(g)))safeEntries.add(entryId)}
const target=[...targetEntries].sort((a,b)=>Number(a)-Number(b));const safe=target.filter(e=>safeEntries.has(e));const unsafe=target.filter(e=>!safeEntries.has(e));
const unsafeDetails=unsafe.map(entryId=>{const gs=groupsByEntry.get(entryId)??[];return {entryId,sourceItems:sourceCount.get(entryId)??0,resolvedItems:resolvedCount.get(entryId)??0,reasons:itemReasons.get(entryId)??{},nonExactGroups:gs.filter(g=>!exactGroups.has(g)).map(g=>({groupKey:g,stagingQuantity:stagingQtyByGroup.get(g)??0,nativeAccepted:acceptedByGroup.get(g)??0,nativeReceived:receivedByGroup.get(g)??0}))}});
console.log("KOPER_NFE_RECEIPT_SAFE_CROSSCHECK",JSON.stringify({ok:true,readOnly:true,targetEntries:target.length,safeTargetEntries:safe.length,unsafeTargetEntries:unsafe.length,safeEntryIds:safe,unsafeDetails}));
