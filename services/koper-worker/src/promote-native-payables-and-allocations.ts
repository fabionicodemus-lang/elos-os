import { createHash } from "node:crypto";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type Stage = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Project = { id: string; name: string; status: string };
type Supplier = { id: string; source_id: string | null; legal_name: string; trade_name: string | null; tax_id: string | null };
type Payable = { id: string; project_id: string; supplier_id: string | null; beneficiary_name: string | null; source_id: string | null; source_system: string | null; amount: number; status: string };
type Service = { id: string; source_id: string | null; description: string };
type BudgetItem = { id: string; project_id: string; service_id: string | null; code: string };
type ExistingAllocation = { id: string; payable_id: string; source_system: string | null; source_id: string | null; allocation_amount: number };

const object = (value: unknown): Json => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : [];
const text = (value: unknown): string | null => value === null || value === undefined || String(value).trim() === "" ? null : String(value).trim();
const number = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const money = (value: unknown): number => Math.round((number(value) ?? 0) * 100) / 100;
const truthy = (value: unknown): boolean => value === true || value === 1 || value === "1" || String(value ?? "").toLowerCase() === "true" || String(value ?? "").toUpperCase() === "S";
const normalize = (value: unknown): string => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase();
const dateOnly = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
};
const stableUuid = (seed: string): string => {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0, 32), "hex");
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const quotedIn = (values: string[]): string => `in.(${values.map((value) => `"${value.replaceAll("\"", "\\\"")}"`).join(",")})`;

async function readAll<T>(table: string, query: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(table, { query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }), timeoutMs: 30_000 });
    rows.push(...page);
    if (page.length < 1_000) return rows;
  }
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

function resolutionMethod(nativeMethod: string | null): string {
  if (nativeMethod === "koper_receipt_purchase") return "koper_receipt_purchase";
  if (["koper_invoice_purchase_order", "koper_nfe_stock_entry_single_service", "koper_nfe_native_order_product"].includes(nativeMethod ?? "")) return "koper_invoice_purchase_order";
  if (nativeMethod === "koper_service_order") return "koper_service_order";
  if (nativeMethod === "koper_measurement_contract") return "koper_measurement_contract";
  if (nativeMethod === "koper_monitoring_crosswalk") return "koper_monitoring_crosswalk";
  return "import_other";
}

const writeEnabled = process.env.KOPER_NATIVE_PAYABLE_PROMOTION_WRITE_ENABLED === "true";

try {
  const [billStages, resolutionStages, detailStages, projects, suppliers, payables, services, budgetItems, existingAllocations, actors] = await Promise.all([
    readAll<Stage>("koper_staging_records", { select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.bill_to_pay", sync_state: "eq.present", order: "koper_id.asc" }),
    readAll<Stage>("koper_staging_records", { select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.bill_resolution", sync_state: "eq.present", order: "koper_id.asc" }),
    readAll<Stage>("koper_staging_records", { select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.bill_detail_enrichment", sync_state: "eq.present", order: "koper_id.asc" }),
    readAll<Project>("projects", { select: "id,name,status", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "name.asc" }),
    readAll<Supplier>("suppliers", { select: "id,source_id,legal_name,trade_name,tax_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
    readAll<Payable>("payables", { select: "id,project_id,supplier_id,beneficiary_name,source_id,source_system,amount,status", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
    readAll<Service>("engineering_services", { select: "id,source_id,description", company_id: `eq.${env.BOSSA_COMPANY_ID}`, status: "eq.active", order: "id.asc" }),
    readAll<BudgetItem>("engineering_budget_items", { select: "id,project_id,service_id,code", company_id: `eq.${env.BOSSA_COMPANY_ID}`, status: "eq.active", order: "id.asc" }),
    readAll<ExistingAllocation>("payable_cost_allocations", { select: "id,payable_id,source_system,source_id,allocation_amount", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
    requestSupabase<Array<{ user_id: string }>>("company_memberships", { query: new URLSearchParams({ select: "user_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, status: "eq.active", order: "created_at.asc", limit: "1" }) }),
  ]);

  const actor = actors[0];
  if (!actor) throw new Error("KOPER_NATIVE_PAYABLE_NO_ACTIVE_ACTOR");
  const activeProjects = projects.filter((project) => project.status !== "archived");
  const flowProject = activeProjects.find((project) => normalize(project.name) === "flow aptos") ?? activeProjects.find((project) => normalize(project.name).includes("flow"));
  if (!flowProject) throw new Error("KOPER_NATIVE_PAYABLE_FLOW_PROJECT_NOT_FOUND");

  const resolutionByBill = new Map(resolutionStages.map((row) => [row.koper_id, object(row.payload)]));
  const detailByBill = new Map(detailStages.map((row) => [row.koper_id, object(row.payload)]));
  const supplierBySource = new Map(suppliers.flatMap((supplier) => supplier.source_id ? [[supplier.source_id, supplier] as const] : []));
  const suppliersByName = new Map<string, Supplier[]>();
  for (const supplier of suppliers) for (const candidate of [supplier.legal_name, supplier.trade_name]) {
    const key = normalize(candidate);
    if (key) suppliersByName.set(key, [...(suppliersByName.get(key) ?? []), supplier]);
  }
  const payableBySource = new Map(payables.flatMap((payable) => payable.source_id ? [[payable.source_id, payable] as const] : []));
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const budgetById = new Map(budgetItems.map((item) => [item.id, item]));
  const existingAllocationsByPayable = new Map<string, ExistingAllocation[]>();
  for (const allocation of existingAllocations) existingAllocationsByPayable.set(allocation.payable_id, [...(existingAllocationsByPayable.get(allocation.payable_id) ?? []), allocation]);

  const titleRows: Json[] = [];
  const allocationRows: Json[] = [];
  const titleBlockers: Json[] = [];
  const allocationBlockers: Json[] = [];
  let existingTitleCount = 0;
  let existingTitleValue = 0;
  let beneficiaryFallbackCount = 0;
  let beneficiaryFallbackValue = 0;
  let excludedZeroValueCount = 0;
  let exactResolutionCount = 0;
  let exactResolutionValue = 0;

  for (const stage of billStages) {
    const bill = object(stage.payload);
    const detail = detailByBill.get(stage.koper_id) ?? {};
    const resolution = resolutionByBill.get(stage.koper_id) ?? {};
    const billId = text(bill.billId) ?? stage.koper_id;
    const sourceId = `koper_bill:${billId}`;
    const amount = money(bill.billValue ?? detail.billValue ?? resolution.billValue);
    const dueDate = dateOnly(bill.dueDate ?? detail.dueDate);
    const isPaid = truthy(bill.isPaid ?? detail.isPaid) || String(detail.status ?? "").toLowerCase() === "paid";
    const paidAt = dateOnly(bill.paymentDate ?? detail.paidAt);
    const paymentValue = money(bill.paymentValue ?? detail.paymentValue ?? amount);
    const supplierSourceId = text(detail.supplierId ?? detail.beneficiarySupplierId);
    const supplierName = text(detail.supplierName ?? detail.beneficiarySupplierName ?? bill.originName ?? resolution.originName);
    const sourceSupplier = supplierSourceId ? supplierBySource.get(supplierSourceId) : undefined;
    const nameMatches = supplierName ? suppliersByName.get(normalize(supplierName)) ?? [] : [];
    const supplier = sourceSupplier ?? (nameMatches.length === 1 ? nameMatches[0] : undefined);
    const payableId = stableUuid(`elos:koper:payable:${billId}`);
    const existing = payableBySource.get(sourceId);

    if (amount === 0) {
      excludedZeroValueCount += 1;
      continue;
    }
    if (amount < 0 || !dueDate) {
      if (titleBlockers.length < 80) titleBlockers.push({ billId, reason: amount < 0 ? "invalid_amount" : "invalid_due_date", amount, dueDate });
      continue;
    }
    if (isPaid && !paidAt) {
      if (titleBlockers.length < 80) titleBlockers.push({ billId, reason: "paid_without_payment_date", amount });
      continue;
    }
    if (existing) {
      existingTitleCount += 1;
      existingTitleValue = money(existingTitleValue + amount);
      if (existing.id !== payableId || existing.project_id !== flowProject.id || money(existing.amount) !== amount) {
        if (titleBlockers.length < 80) titleBlockers.push({ billId, reason: "existing_title_identity_mismatch", expectedPayableId: payableId, existingPayableId: existing.id, expectedProjectId: flowProject.id, existingProjectId: existing.project_id, expectedAmount: amount, existingAmount: money(existing.amount) });
      }
    } else {
      if (!supplier) {
        beneficiaryFallbackCount += 1;
        beneficiaryFallbackValue = money(beneficiaryFallbackValue + amount);
      }
      titleRows.push({
        id: payableId,
        company_id: env.BOSSA_COMPANY_ID,
        project_id: flowProject.id,
        supplier_id: supplier?.id ?? null,
        beneficiary_name: supplier ? null : supplierName ?? `Beneficiário histórico Koper ${supplierSourceId ?? billId}`,
        beneficiary_tax_id: null,
        document: text(bill.invoiceNumber) ? `NF ${text(bill.invoiceNumber)}` : text(bill.receiptNumber) ? `Recebimento ${text(bill.receiptNumber)}` : `Koper ${text(bill.billToPayId) ?? billId}`,
        fiscal_class: null,
        payment_method: null,
        due_date: dueDate,
        amount,
        status: isPaid ? "paid" : "open",
        installment_label: text(bill.billOrder) ?? null,
        notes: `Importação histórica nativa Koper · título ${text(bill.billToPayId) ?? "—"} · parcela ${billId} · origem ${text(bill.originName ?? resolution.originName) ?? "—"}`,
        origin: "historical_import",
        source_system: "koper_flow",
        source_category: `koper_${text(resolution.route) ?? "other"}`,
        source_id: sourceId,
        paid_at: isPaid ? paidAt : null,
        paid_amount: isPaid ? (paymentValue > 0 ? paymentValue : amount) : null,
        paid_account_name: isPaid ? "Koper (histórico)" : null,
        created_by: actor.user_id,
        updated_at: new Date().toISOString(),
      });
    }

    if (resolution.status !== "exact_allocated") continue;
    exactResolutionCount += 1;
    exactResolutionValue = money(exactResolutionValue + amount);
    const allocations = array(resolution.allocations);
    const allocationSum = money(allocations.reduce((sum, allocation) => sum + money(allocation.amount), 0));
    const existingForPayable = existingAllocationsByPayable.get(payableId) ?? [];
    const hasForeignAllocation = existingForPayable.some((allocation) => allocation.source_system !== "koper_native_resolution");
    if (!allocations.length || allocationSum !== amount || hasForeignAllocation) {
      if (allocationBlockers.length < 80) allocationBlockers.push({ billId, reason: !allocations.length ? "missing_allocations" : allocationSum !== amount ? "allocation_sum_mismatch" : "existing_non_native_allocation", amount, allocationSum, existingAllocationCount: existingForPayable.length });
      continue;
    }

    let valid = true;
    const planned: Json[] = [];
    for (let index = 0; index < allocations.length; index += 1) {
      const allocation = allocations[index]!;
      const serviceId = text(allocation.serviceId);
      const budgetItemId = text(allocation.budgetItemId);
      const service = serviceId ? serviceById.get(serviceId) : undefined;
      const budgetItem = budgetItemId ? budgetById.get(budgetItemId) : undefined;
      const allocationAmount = money(allocation.amount);
      if (!service || allocationAmount <= 0 || (budgetItemId && (!budgetItem || budgetItem.project_id !== flowProject.id || (budgetItem.service_id && budgetItem.service_id !== service.id)))) {
        valid = false;
        if (allocationBlockers.length < 80) allocationBlockers.push({ billId, reason: !service ? "service_not_found" : allocationAmount <= 0 ? "invalid_allocation_amount" : "budget_item_mismatch", serviceId, budgetItemId, allocationAmount });
        break;
      }
      const nativeMethod = text(allocation.method);
      planned.push({
        id: stableUuid(`elos:koper:payable-allocation:${billId}:${index}`),
        company_id: env.BOSSA_COMPANY_ID,
        project_id: flowProject.id,
        payable_id: payableId,
        service_id: service.id,
        budget_item_id: budgetItem?.id ?? null,
        wbs_code_snapshot: text(allocation.wbsCode) ?? budgetItem?.code ?? null,
        service_name_snapshot: text(allocation.serviceName) ?? service.description,
        allocation_amount: allocationAmount,
        allocation_percent: Math.round(allocationAmount / amount * 10_000_000_000) / 100_000_000,
        resolution_method: resolutionMethod(nativeMethod),
        source_system: "koper_native_resolution",
        source_id: `${billId}:${index}`,
        evidence: { billId, billToPayId: text(bill.billToPayId), status: resolution.status, route: resolution.route, nativeMethod, nativeEvidence: object(allocation.evidence), resolutionVersion: resolution.version },
        updated_at: new Date().toISOString(),
      });
    }
    if (valid) allocationRows.push(...planned);
  }

  const titleValue = money(titleRows.reduce((sum, row) => sum + money(row.amount), 0));
  const allocationValue = money(allocationRows.reduce((sum, row) => sum + money(row.allocation_amount), 0));
  const plannedAllocationBills = new Set(allocationRows.map((row) => String(row.payable_id))).size;
  const summary = {
    ok: titleBlockers.length === 0 && allocationBlockers.length === 0,
    writeEnabled,
    flowProject,
    source: { bills: billStages.length, resolutions: resolutionStages.length, details: detailStages.length },
    current: { payables: payables.length, existingNativeTitles: existingTitleCount, existingNativeValue: existingTitleValue, allocations: existingAllocations.length },
    titles: { toInsert: titleRows.length, value: titleValue, excludedZeroValueCount, beneficiaryFallbackCount, beneficiaryFallbackValue, blockers: titleBlockers.length },
    exactResolutions: { count: exactResolutionCount, value: exactResolutionValue, allocationBills: plannedAllocationBills, allocationRows: allocationRows.length, allocationValue, blockers: allocationBlockers.length },
    titleBlockerExamples: titleBlockers,
    allocationBlockerExamples: allocationBlockers,
  };

  if (!writeEnabled) {
    console.log("KOPER_NATIVE_PAYABLE_PROMOTION_PREVIEW", JSON.stringify(summary));
  } else {
    if (!summary.ok) throw new Error(`KOPER_NATIVE_PAYABLE_PROMOTION_BLOCKED titles=${titleBlockers.length} allocations=${allocationBlockers.length}`);
    for (const batch of chunks(titleRows, 100)) await requestSupabase("payables", { method: "POST", body: batch, prefer: "resolution=merge-duplicates,return=minimal", query: new URLSearchParams({ on_conflict: "id" }), timeoutMs: 60_000 });
    for (const batch of chunks(allocationRows, 100)) await requestSupabase("payable_cost_allocations", { method: "POST", body: batch, prefer: "resolution=merge-duplicates,return=minimal", query: new URLSearchParams({ on_conflict: "id" }), timeoutMs: 60_000 });

    const sourceIds = billStages.map((row) => `koper_bill:${text(object(row.payload).billId) ?? row.koper_id}`);
    const verifiedPayables: Payable[] = [];
    for (const batch of chunks(sourceIds, 200)) verifiedPayables.push(...await requestSupabase<Payable[]>("payables", { query: new URLSearchParams({ select: "id,project_id,supplier_id,beneficiary_name,source_id,source_system,amount,status", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper_flow", source_id: quotedIn(batch), limit: String(batch.length + 10) }), timeoutMs: 30_000 }));
    const verifiedAllocations = await readAll<ExistingAllocation>("payable_cost_allocations", { select: "id,payable_id,source_system,source_id,allocation_amount", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper_native_resolution", order: "id.asc" });
    const verifiedAllocationValue = money(verifiedAllocations.reduce((sum, row) => sum + money(row.allocation_amount), 0));
    console.log("KOPER_NATIVE_PAYABLE_PROMOTION_RESULT", JSON.stringify({ ...summary, verified: { nativePayables: verifiedPayables.length, nativePayableValue: money(verifiedPayables.reduce((sum, row) => sum + money(row.amount), 0)), nativeAllocations: verifiedAllocations.length, nativeAllocationBills: new Set(verifiedAllocations.map((row) => row.payable_id)).size, nativeAllocationValue: verifiedAllocationValue } }));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("PGRST205")) {
    try {
      const supabaseUrl = env.SUPABASE_URL;
      const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !serviceRoleKey) throw new Error("SUPABASE_ENV_MISSING");
      const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/`, {
        headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
      });
      const schema = object(await response.json());
      const paths = object(schema.paths);
      console.log("KOPER_NATIVE_PAYABLE_SCHEMA_DIAGNOSTIC", JSON.stringify({
        supabaseHost: new URL(supabaseUrl).hostname,
        status: response.status,
        rpcPaths: Object.keys(paths).filter((path) => path.startsWith("/rpc/")).sort(),
      }));
    } catch (diagnosticError) {
      console.error("KOPER_NATIVE_PAYABLE_SCHEMA_DIAGNOSTIC_FAILED", JSON.stringify({ message: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError) }));
    }
  }
  console.error("KOPER_NATIVE_PAYABLE_PROMOTION_FAILED", JSON.stringify({ message: message.slice(0, 2_000) }));
  process.exitCode = 1;
}
