import crypto from "node:crypto";

const parts = [0,1,2,3,4].map((i) => process.env[`FLOW_BUDGET_PLAN_${i}`] ?? "");
const raw = parts.join("");
const expected = process.env.FLOW_BUDGET_PLAN_SHA256 ?? "";
const actual = crypto.createHash("sha256").update(raw).digest("hex");

let parsed: unknown = null;
let parseError: string | null = null;
try {
  parsed = JSON.parse(raw);
} catch (error) {
  parseError = error instanceof Error ? error.message : String(error);
}

const summary: Record<string, unknown> = {
  ok: parseError === null,
  partLengths: parts.map((p) => p.length),
  rawLength: raw.length,
  hashMatch: Boolean(expected) && actual === expected,
  parseError,
};

if (Array.isArray(parsed)) {
  summary.topType = "array";
  summary.count = parsed.length;
  const first = parsed[0];
  summary.firstKeys = first && typeof first === "object" && !Array.isArray(first) ? Object.keys(first as Record<string, unknown>) : [];
} else if (parsed && typeof parsed === "object") {
  const obj = parsed as Record<string, unknown>;
  summary.topType = "object";
  summary.keys = Object.keys(obj);
  summary.arrays = Object.fromEntries(Object.entries(obj).filter(([,v]) => Array.isArray(v)).map(([k,v]) => [k,(v as unknown[]).length]));
  const firstArray = Object.entries(obj).find(([,v]) => Array.isArray(v) && v.length > 0);
  if (firstArray) {
    const first = (firstArray[1] as unknown[])[0];
    summary.firstArray = {
      key: firstArray[0],
      firstKeys: first && typeof first === "object" && !Array.isArray(first) ? Object.keys(first as Record<string, unknown>) : [],
    };
  }
}

console.log("FLOW_BUDGET_PLAN_META", JSON.stringify(summary));
