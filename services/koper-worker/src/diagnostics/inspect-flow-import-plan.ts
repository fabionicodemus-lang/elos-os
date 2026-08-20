import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const parts = Number(process.env.FLOW_IMPORT_PLAN_PARTS ?? "0");
if (!Number.isInteger(parts) || parts <= 0 || parts > 99) {
  throw new Error(`FLOW_IMPORT_PLAN_PARTS inválido: ${process.env.FLOW_IMPORT_PLAN_PARTS ?? "ausente"}`);
}

const encoded = Array.from({ length: parts }, (_, i) => {
  const key = `FLOW_IMPORT_PLAN_${String(i).padStart(2, "0")}`;
  const value = process.env[key];
  if (value == null) throw new Error(`${key} ausente`);
  return value;
}).join("");

const compressed = Buffer.from(encoded, "base64");
const jsonBuffer = gunzipSync(compressed);
const json = jsonBuffer.toString("utf8");
const encodedSha256 = createHash("sha256").update(encoded).digest("hex");
const compressedSha256 = createHash("sha256").update(compressed).digest("hex");
const jsonSha256 = createHash("sha256").update(jsonBuffer).digest("hex");
const expectedSha256 = process.env.FLOW_IMPORT_PLAN_SHA256 ?? "";
const shaMatches = !expectedSha256 || [encodedSha256, compressedSha256, jsonSha256].includes(expectedSha256);
const plan = JSON.parse(json) as Record<string, unknown>;

const summarizeArray = (value: unknown) => {
  if (!Array.isArray(value)) return null;
  const sample = value.find((v) => v && typeof v === "object" && !Array.isArray(v)) as Record<string, unknown> | undefined;
  return { count: value.length, sampleKeys: sample ? Object.keys(sample) : [] };
};

const arrays = Object.fromEntries(
  Object.entries(plan)
    .map(([key, value]) => [key, summarizeArray(value)] as const)
    .filter(([, value]) => value !== null),
);

const scalarPreview = Object.fromEntries(
  Object.entries(plan)
    .filter(([, value]) => !Array.isArray(value) && (value == null || ["string", "number", "boolean"].includes(typeof value)))
    .map(([key, value]) => [key, typeof value === "string" && value.length > 160 ? `${value.slice(0, 157)}...` : value]),
);

console.log(
  "FLOW_IMPORT_PLAN_PREVIEW",
  JSON.stringify({
    ok: shaMatches,
    parts,
    encodedBytes: Buffer.byteLength(encoded, "utf8"),
    compressedBytes: compressed.byteLength,
    jsonBytes: jsonBuffer.byteLength,
    encodedSha256,
    compressedSha256,
    jsonSha256,
    expectedSha256,
    shaMatches,
    topLevelKeys: Object.keys(plan),
    scalarPreview,
    arrays,
    writeEnabled: process.env.FLOW_IMPORT_WRITE_ENABLED === "true",
  }),
);
