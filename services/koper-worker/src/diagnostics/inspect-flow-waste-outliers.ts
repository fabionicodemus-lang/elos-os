import { gunzipSync } from "node:zlib";

type J = Record<string, unknown>;
const n = (v: unknown) => typeof v === "number" ? v : Number(v ?? 0);
const s = (v: unknown) => String(v ?? "").trim();
const count = Number(process.env.FLOW_IMPORT_PLAN_PARTS ?? "0");
const encoded = Array.from({length: count}, (_, i) => process.env[`FLOW_IMPORT_PLAN_${String(i).padStart(2, "0")}`] ?? "").join("");
const plan = JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8")) as J;
const comps = Array.isArray(plan.compositions) ? plan.compositions as J[] : [];
const outliers: J[] = [];
const nonPositiveEffective: J[] = [];
let total = 0;
for (const c of comps) {
  for (const i of (Array.isArray(c.items) ? c.items as J[] : [])) {
    total++;
    const waste = n(i.waste_percentage);
    const raw = n(i.coefficient);
    const effective = n(i.effective_coefficient);
    const row = {service_code:s(c.service_code),input_code:s(i.input_code),coefficient:raw,waste_percentage:waste,effective_coefficient:effective,unit_price:n(i.unit_price),price_source:s(i.price_source)};
    if (waste < 0 || waste > 1000) outliers.push(row);
    if (!(effective > 0)) nonPositiveEffective.push(row);
  }
}
console.log("FLOW_WASTE_OUTLIERS", JSON.stringify({total,outlierCount:outliers.length,outliers,nonPositiveEffectiveCount:nonPositiveEffective.length,nonPositiveEffective}));
