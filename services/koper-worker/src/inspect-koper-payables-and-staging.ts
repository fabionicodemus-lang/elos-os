import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type Stage = { entity: string; koper_id: string; koper_parent_id: string | null; payload: unknown };

const object = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};

async function readAll<T>(table: string, query: Record<string, string>): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(table, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
    });
    result.push(...page);
    if (page.length < 1_000) return result;
  }
}

function keyPaths(value: unknown, prefix = "", depth = 0): string[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) {
    return value.slice(0, 3).flatMap((item) => keyPaths(item, `${prefix}[]`, depth + 1));
  }
  const row = object(value);
  return Object.entries(row).flatMap(([key, nested]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(nested) || (typeof nested === "object" && nested !== null)) {
      return [path, ...keyPaths(nested, path, depth + 1)];
    }
    return [path];
  });
}

function paymentRelevant(path: string): boolean {
  return /(pay|payment|paid|install|parcel|due|maturity|expire|venc|amount|value|total|document|boleto|bank|account|title|bill|finance|status|date)/i.test(path);
}

function safeSample(payload: unknown): Record<string, unknown> {
  const row = object(payload);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!paymentRelevant(key)) continue;
    if (Array.isArray(value)) result[key] = value.slice(0, 2).map((item) => object(item));
    else if (typeof value === "object" && value !== null) result[key] = object(value);
    else result[key] = value;
  }
  return result;
}

await import("./index.js");

try {
  const [staging, nativeInvoices, nativeInstallments, payables] = await Promise.all([
    readAll<Stage>("koper_staging_records", {
      select: "entity,koper_id,koper_parent_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      sync_state: "eq.present",
      order: "entity.asc,koper_id.asc",
    }),
    readAll<Record<string, unknown>>("finance_electronic_invoices", {
      select: "id,registry_number,invoice_number,issue_date,invoice_total,status,validation_status,three_way_status",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      order: "registry_number.asc",
    }),
    readAll<Record<string, unknown>>("finance_electronic_invoice_installments", {
      select: "*",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      order: "id.asc",
    }),
    readAll<Record<string, unknown>>("payables", {
      select: "id,project_id,supplier_id,document,due_date,amount,status,installment_label,origin,source_system,source_id,notes",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      order: "id.asc",
    }),
  ]);

  const entityCounts = staging.reduce<Record<string, number>>((counts, row) => {
    counts[row.entity] = (counts[row.entity] ?? 0) + 1;
    return counts;
  }, {});

  const entities = Object.keys(entityCounts).sort();
  const candidateEntities = entities.filter((entity) => /(invoice|pay|payment|install|parcel|finance|account|title|bill|entry)/i.test(entity));

  const diagnostics = candidateEntities.map((entity) => {
    const rows = staging.filter((row) => row.entity === entity);
    const paths = [...new Set(rows.slice(0, 100).flatMap((row) => keyPaths(row.payload)).filter(paymentRelevant))].sort();
    return {
      entity,
      count: rows.length,
      relevantPaths: paths.slice(0, 100),
      samples: rows.slice(0, 3).map((row) => ({
        koperId: row.koper_id,
        koperParentId: row.koper_parent_id,
        paymentFields: safeSample(row.payload),
      })),
    };
  });

  const invoiceStages = staging.filter((row) => row.entity === "xml_invoice");
  const invoiceRelevantPaths = [...new Set(invoiceStages.slice(0, 200).flatMap((row) => keyPaths(row.payload)).filter(paymentRelevant))].sort();

  const koperPayables = payables.filter((row) => String(row.source_system ?? "").includes("koper"));
  const projectCounts = koperPayables.reduce<Record<string, number>>((counts, row) => {
    const id = String(row.project_id ?? "null");
    counts[id] = (counts[id] ?? 0) + 1;
    return counts;
  }, {});
  const projectIds = Object.keys(projectCounts).filter((id) => id !== "null");
  let projects: Record<string, unknown>[] = [];
  if (projectIds.length) {
    projects = await requestSupabase<Record<string, unknown>[]>("projects", {
      query: new URLSearchParams({
        select: "id,company_id,name",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        id: `in.(${projectIds.join(",")})`,
        limit: "100",
      }),
    });
  }

  console.log("KOPER_PAYABLE_SOURCE_DIAGNOSTIC", JSON.stringify({
    ok: true,
    staging: {
      total: staging.length,
      entityCounts,
      candidateEntities,
      diagnostics,
      xmlInvoiceRelevantPaths: invoiceRelevantPaths.slice(0, 150),
      xmlInvoiceSamples: invoiceStages.slice(0, 5).map((row) => ({
        koperId: row.koper_id,
        paymentFields: safeSample(row.payload),
      })),
    },
    native: {
      electronicInvoices: nativeInvoices.length,
      electronicInvoiceInstallments: nativeInstallments.length,
      installmentSample: nativeInstallments.slice(0, 3),
      payables: payables.length,
      koperPayables: koperPayables.length,
      koperPayableProjectCounts: projectCounts,
      koperPayableProjects: projects,
      payableSample: koperPayables.slice(0, 3),
    },
  }));
} catch (error) {
  console.error("KOPER_PAYABLE_SOURCE_DIAGNOSTIC_ERROR", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
