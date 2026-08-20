import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";

type J = Record<string, unknown>;
const parts = Number(process.env.FLOW_IMPORT_PLAN_PARTS ?? "0");
const encoded = Array.from({ length: parts }, (_, i) => process.env[`FLOW_IMPORT_PLAN_${String(i).padStart(2, "0")}`] ?? "").join("");
const jsonBuffer = gunzipSync(Buffer.from(encoded, "base64"));
const sha = createHash("sha256").update(jsonBuffer).digest("hex");
const expected = process.env.FLOW_IMPORT_PLAN_SHA256 ?? "";
if (expected && sha !== expected) throw new Error(`Hash inválido: ${sha} != ${expected}`);
const plan = JSON.parse(jsonBuffer.toString("utf8")) as J;
const arr = (k: string): J[] => Array.isArray(plan[k]) ? plan[k] as J[] : [];
const n = (v: unknown) => typeof v === "number" ? v : Number(v ?? 0);
const items = arr("budget_items");
const adjustments = arr("adjustments");
const groups = arr("groups");
const services = arr("services");
const inputs = arr("inputs");
const compositions = arr("compositions");
const sum = (rows: J[], key: string) => rows.reduce((a, r) => a + n(r[key]), 0);
const itemTotal = sum(items, "row_total");
const adjustmentTotal = sum(adjustments, "row_total");
const grandTotal = itemTotal + adjustmentTotal;
const declaredGroupTotal = sum(groups, "total");
const byStatus = (rows: J[]) => Object.fromEntries([...new Set(rows.map(r => String(r.status ?? "")))].map(s => [s, rows.filter(r => String(r.status ?? "") === s).length]));
const compositionSamples = compositions.slice(0, 3).map(c => ({service_code:c.service_code, itemCount:Array.isArray(c.items)?c.items.length:0, itemSample:Array.isArray(c.items)?c.items.slice(0,2):[]}));
const budget = plan.budget && typeof plan.budget === "object" ? plan.budget as J : {};
const existingBudgets = await requestSupabase<J[]>("engineering_budgets", {query:new URLSearchParams({select:"id,code,name,version,status,is_base",project_id:"eq.ffe8b7ec-1f01-4f6c-8a03-2bd6d3ae94fc",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"created_at.asc"})});
const koper = existingBudgets.find(b => b.code === "KOPER-100");
let koperItems = 0;
if (koper?.id) {
  const rows = await requestSupabase<J[]>("engineering_budget_items", {query:new URLSearchParams({select:"id",budget_id:`eq.${String(koper.id)}`,status:"eq.active",limit:"1000"})});
  koperItems = rows.length;
}
console.log("FLOW_IMPORT_VALIDATION", JSON.stringify({
  ok: sha === expected && Math.abs(grandTotal - declaredGroupTotal) < 0.02,
  sha,
  expected,
  budget,
  counts:{groups:groups.length,services:services.length,inputs:inputs.length,compositions:compositions.length,budgetItems:items.length,adjustments:adjustments.length},
  totals:{itemTotal,adjustmentTotal,grandTotal,declaredGroupTotal,difference:grandTotal-declaredGroupTotal},
  itemStatus:byStatus(items),adjustmentStatus:byStatus(adjustments),
  groupSamples:groups.slice(0,5),
  budgetItemSamples:items.slice(0,4),
  adjustmentSamples:adjustments,
  compositionSamples,
  existingBudgets,
  koperItems,
  writeEnabled:process.env.FLOW_IMPORT_WRITE_ENABLED === "true"
}));
