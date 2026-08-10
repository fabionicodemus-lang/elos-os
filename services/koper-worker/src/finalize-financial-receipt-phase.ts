import { spawn } from "node:child_process";

await import("./index.js");

const quarantine = {
  missingOrderAllocation: ["10566","182","3672","3773","3774","3783","3831","4532","4993","500","68","9476"].sort((a,b)=>Number(a)-Number(b)),
  invalidQuantity: ["13145"],
} as const;
const reasons: Record<string,string> = {
  "10566":"Programmed/manual utility receipt (Consumo de Energia), no purchase-order allocation and no native matching order item.",
  "182":"Manual Alimentos receipt, no financial order allocation; multiple unrelated native product candidates with incompatible values.",
  "3672":"Mini cunha receipt, no purchase-order allocation and no native matching order item.",
  "3773":"Manual Alimentos receipt R$18, no allocation; native product candidates do not match value/date context.",
  "3774":"Compras no cartão R$4761.29, no allocation; many generic card-product candidates, none match value.",
  "3783":"Alimentos R$28 has a superficial match to order 1321, but that exact order item is already fully covered by KOPER-REC-1222-1321; promoting would duplicate receipt.",
  "3831":"Manual Alimentos receipt R$211.57, no allocation; native product candidates do not match value.",
  "4532":"Compras no cartão R$1226.61, no allocation; generic native candidates do not uniquely match.",
  "4993":"Dundun quantity 36, no allocation and no native matching order item.",
  "500":"Manual Alimentos receipt R$140, no allocation; native product candidates do not match value.",
  "68":"Viga qty7.5, no allocation; only native candidate is qty30 with zero cost, not an exact historical match.",
  "9476":"Papel higiênico receipt, no allocation and no native matching order item.",
  "13145":"Zero-quantity ghost staging entry; later entry 13202 carries the same financial receipt/product quantity 8 and is already promoted. Promoting 13145 would duplicate material.",
};

const child = spawn(process.execPath, [new URL("./run-promotion-plan-v3-divergent.js", import.meta.url).pathname], {
  env: { ...process.env, PORT: "19431" },
  stdio:["ignore","pipe","pipe"],
});
let stdout=""; let stderr="";
child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
child.stdout.on("data",(chunk:string)=>{ stdout+=chunk; process.stdout.write(chunk); });
child.stderr.on("data",(chunk:string)=>{ stderr+=chunk; process.stderr.write(chunk); });
const exitCode:number = await new Promise((resolve)=>child.on("close",(code)=>resolve(code ?? 1)));
if (exitCode !== 0) throw new Error(`KOPER_FINALIZE_RECEIPTS_PLANNER_FAILED exit=${exitCode} stderr=${stderr.slice(-2000)}`);
const doneLine = stdout.split(/\r?\n/).filter(Boolean).reverse().find((line)=>line.startsWith("KOPER_FINANCIAL_RECEIPT_PROMOTION_PLAN_V3_DONE "));
if (!doneLine) throw new Error("KOPER_FINALIZE_RECEIPTS_DONE_NOT_FOUND");
const done = JSON.parse(doneLine.slice("KOPER_FINANCIAL_RECEIPT_PROMOTION_PLAN_V3_DONE ".length));
const result = done?.result ?? {};
const excluded = result.excluded ?? {};
const excludedIds = done?.excludedEntryIds ?? {};
const sorted = (values:unknown):string[] => Array.isArray(values) ? values.map(String).sort((a,b)=>Number(a)-Number(b)) : [];
const same = (a:string[],b:readonly string[]) => JSON.stringify(a) === JSON.stringify([...b].sort((x,y)=>Number(x)-Number(y)));
const categories = ["missingEntry","missingReceiptData","missingReceiptProduct","ambiguousReceiptProduct","allocationSplit","missingNativeOrder","missingNativeOrderItem","nativeAllocationSplit","receiptQuantityMismatch","allocationQuantityMismatch"];
const unexpectedCounts = Object.fromEntries(categories.map((key)=>[key,Number(excluded[key]??0)]).filter(([,value])=>value!==0));
if (!same(sorted(excludedIds.missingOrderAllocation), quarantine.missingOrderAllocation)) throw new Error(`KOPER_FINALIZE_RECEIPTS_MISSING_ALLOC_SET_CHANGED ${JSON.stringify(excludedIds.missingOrderAllocation)}`);
if (!same(sorted(excludedIds.invalidQuantity), quarantine.invalidQuantity)) throw new Error(`KOPER_FINALIZE_RECEIPTS_INVALID_SET_CHANGED ${JSON.stringify(excludedIds.invalidQuantity)}`);
if (Object.keys(unexpectedCounts).length) throw new Error(`KOPER_FINALIZE_RECEIPTS_NEW_DIVERGENCES ${JSON.stringify(unexpectedCounts)}`);
const quarantinedIds = [...quarantine.missingOrderAllocation, ...quarantine.invalidQuantity];
console.log("KOPER_FINANCIAL_RECEIPT_PHASE_FINALIZED", JSON.stringify({
  ok:true,
  readOnly:true,
  rawAlreadyPromoted:Number(excluded.alreadyPromoted??0),
  rawDivergences:quarantinedIds.length,
  quarantined:quarantinedIds.length,
  actionableDivergences:0,
  quarantine:{
    missingOrderAllocation:quarantine.missingOrderAllocation.map((entryId)=>({entryId,reason:reasons[entryId]})),
    invalidQuantity:quarantine.invalidQuantity.map((entryId)=>({entryId,reason:reasons[entryId]})),
  },
}));
