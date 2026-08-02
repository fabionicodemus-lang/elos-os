import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";

type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type InputRow = { id: string; source_id: string | null; code: string; description: string; unit: string; category: string };
type ServiceRow = { id: string; source_id: string | null; code: string; description: string };
type BudgetItemRow = { koper_id: string; payload: unknown };

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function identifier(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function readStaging(entity: "stock_request" | "stock_request_item" | "budget_item"): Promise<StagingRow[]> {
  const rows: StagingRow[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<StagingRow[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "koper_id,koper_parent_id,payload",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: `eq.${entity}`,
        sync_state: "eq.present",
        limit: "1000",
        offset: String(offset),
      }),
    });
    rows.push(...page);
    if (page.length < 1_000) break;
  }
  return rows;
}

async function readCatalog<T>(table: "engineering_inputs" | "engineering_services", select: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(table, {
      query: new URLSearchParams({
        select,
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper",
        limit: "1000",
        offset: String(offset),
      }),
    });
    rows.push(...page);
    if (page.length < 1_000) break;
  }
  return rows;
}

function sourceDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const normalized = raw.replace(" ", "T");
  return Number.isNaN(Date.parse(normalized)) ? null : new Date(normalized).toISOString();
}

function dateOnly(value: unknown, fallback: string): string {
  return (sourceDate(value) ?? fallback).slice(0, 10);
}

type HeaderStatus = "requested" | "approved" | "attended" | "cancelled";

function headerStatus(value: unknown): HeaderStatus {
  const normalized = normalize(text(value) ?? "");
  if (normalized.includes("finalizado")) return "attended";
  if (normalized.includes("cancelado") || normalized.includes("reprovado")) return "cancelled";
  return normalized.includes("aprovado") ? "approved" : "requested";
}

export async function promoteAllStockRequests(): Promise<{
  ok: true;
  requests: number;
  sourceItems: number;
  items: number;
  requestStatuses: Record<string, number>;
  currentServiceAllocations: number;
  legacyServiceAllocations: number;
  verifiedRequests: number;
  verifiedItems: number;
}> {
  if (
    process.env.KOPER_MATERIAL_REQUESTS_WRITE_ENABLED !== "true"
    || process.env.KOPER_STOCK_REQUEST_FULL_PROMOTION_ENABLED !== "true"
  ) throw new Error("Full Koper stock request promotion is not explicitly enabled");

  const [requestRows, itemRows, budgetItemRows, inputs, services, projects, budgets, memberships] = await Promise.all([
    readStaging("stock_request"),
    readStaging("stock_request_item"),
    readStaging("budget_item"),
    readCatalog<InputRow>("engineering_inputs", "id,source_id,code,description,unit,category"),
    readCatalog<ServiceRow>("engineering_services", "id,source_id,code,description"),
    requestSupabase<Array<{ id: string }>>("projects", {
      query: new URLSearchParams({
        select: "id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        name: "ilike.*Flow*",
        status: "neq.archived",
        limit: "10",
      }),
    }),
    requestSupabase<Array<{ id: string }>>("engineering_budgets", {
      query: new URLSearchParams({
        select: "id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper",
        limit: "10",
      }),
    }),
    requestSupabase<Array<{ user_id: string }>>("company_memberships", {
      query: new URLSearchParams({
        select: "user_id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        status: "eq.active",
        order: "created_at.asc",
        limit: "100",
      }),
    }),
  ]);
  if (projects.length !== 1 || budgets.length !== 1 || memberships.length === 0) {
    throw new Error("Flow project, budget or requester identity is ambiguous");
  }
  const project = projects[0];
  const budget = budgets[0];
  const actor = memberships[0];
  if (!project || !budget || !actor) throw new Error("Flow promotion context is missing");

  const inputBySource = new Map(inputs.map((row) => [row.source_id, row]));
  const sourceRequestIds = new Set(requestRows.map((row) => row.koper_id));
  for (const row of itemRows) {
    const payload = objectValue(row.payload);
    const sourceRequestId = row.koper_parent_id ?? identifier(payload.requestId);
    const productId = identifier(payload.productId);
    const inputId = identifier(payload.inputId);
    const quantity = numberValue(payload.productAmount);
    const input =
      (productId ? inputBySource.get(productId) : null)
      ?? (inputId ? inputBySource.get(inputId) : null);
    if (!sourceRequestId || !sourceRequestIds.has(sourceRequestId) || !input || quantity === null || quantity <= 0) {
      throw new Error(`Active request preflight failed for product request ${row.koper_id}`);
    }
    const links = Array.isArray(payload.services) ? payload.services.map(objectValue) : [];
    if (links.length > 0) {
      if (links.some((link) => (numberValue(link.inputAmount) ?? 0) <= 0)) {
        throw new Error(`Service allocation preflight failed for product request ${row.koper_id}`);
      }
    }
  }

  const fallbackRows = await requestSupabase<ServiceRow[]>("engineering_services", {
    method: "POST",
    body: [{
      company_id: env.BOSSA_COMPANY_ID,
      code: "KOPER-SR-LEGACY",
      description: "Legado Koper — centro de custo indisponível",
      unit: "un",
      group_code: "KOPER-INSTALACOES-LEGACY",
      default_method: "unit",
      notes: "Centro técnico para solicitações históricas cujo acompanhamento não existe mais no orçamento atual do Koper.",
      status: "active",
      source_system: "koper",
      source_id: "stock-request-legacy-cost-center",
      updated_at: new Date().toISOString(),
    }],
    prefer: "resolution=merge-duplicates,return=representation",
    query: new URLSearchParams({
      on_conflict: "company_id,source_system,source_id",
      select: "id,source_id,code,description",
    }),
  });
  const fallbackService = fallbackRows[0];
  if (!fallbackService) throw new Error("Legacy Koper cost center was not created");

  const serviceBySource = new Map(services.map((row) => [row.source_id, row]));
  const budgetItemById = new Map(budgetItemRows.map((row) => [row.koper_id, row]));
  const budgetItemByInputId = new Map<string, StagingRow>();
  for (const row of budgetItemRows) {
    const inputId = identifier(objectValue(row.payload).inputId);
    if (inputId) budgetItemByInputId.set(inputId, row);
  }

  function linkedService(link: Record<string, unknown>): ServiceRow | null {
    const itemMonitInputId = identifier(link.itemMonitInputId);
    const monitInputPchId = identifier(link.monitInputPchId);
    const budgetItem =
      (itemMonitInputId ? budgetItemById.get(itemMonitInputId) : undefined)
      ?? (monitInputPchId ? budgetItemById.get(monitInputPchId) : undefined)
      ?? (itemMonitInputId ? budgetItemByInputId.get(itemMonitInputId) : undefined)
      ?? (monitInputPchId ? budgetItemByInputId.get(monitInputPchId) : undefined);
    const sourceId = budgetItem ? identifier(objectValue(budgetItem.payload).serviceId) : null;
    return sourceId ? serviceBySource.get(sourceId) ?? null : null;
  }

  const now = new Date().toISOString();
  const headerPayloads = requestRows.map((row) => {
    const payload = objectValue(row.payload);
    const numericId = Number(row.koper_id);
    if (!Number.isInteger(numericId) || numericId <= 0) throw new Error(`Invalid Koper request id ${row.koper_id}`);
    const status = headerStatus(payload.status);
    const isApproved = status === "approved" || status === "attended";
    const isCancelled = status === "cancelled";
    const createdAt = sourceDate(payload.requestDate) ?? now;
    const approvedDates = (Array.isArray(payload.products) ? payload.products : [])
      .map((value) => sourceDate(objectValue(value).approvedDate))
      .filter((value): value is string => value !== null)
      .sort();
    return {
      company_id: env.BOSSA_COMPANY_ID,
      project_id: project.id,
      budget_id: budget.id,
      sequence_no: 1_000_000 + numericId,
      request_number: `KOPER-${row.koper_id}`,
      status,
      needed_date: dateOnly(payload.deadline, createdAt),
      requester_user_id: actor.user_id,
      requester_name: text(payload.userName) ?? "Usuário Koper",
      notes: [
        `Koper requestId=${row.koper_id}`,
        `status original=${text(payload.status) ?? "n/a"}`,
        `local=${text(payload.stockPlaceName) ?? "Flow Aptos"}`,
        text(payload.commentRequest),
      ].filter(Boolean).join(" · "),
      approved_by: isApproved ? actor.user_id : null,
      approved_at: isApproved ? approvedDates.at(-1) ?? createdAt : null,
      cancelled_by: isCancelled ? actor.user_id : null,
      cancelled_at: isCancelled
        ? sourceDate(payload.cancelledDate) ?? sourceDate(payload.updatedAt) ?? createdAt
        : null,
      cancellation_reason: isCancelled
        ? `Status original no Koper: ${text(payload.status) ?? "Cancelado"}`
        : null,
      created_by: actor.user_id,
      updated_by: actor.user_id,
      created_at: createdAt,
      updated_at: now,
    };
  });

  const promotedHeaders: Array<{ id: string; request_number: string }> = [];
  for (const batch of chunks(headerPayloads, 100)) {
    promotedHeaders.push(...await requestSupabase<Array<{ id: string; request_number: string }>>("execution_material_requests", {
      method: "POST",
      body: batch,
      prefer: "resolution=merge-duplicates,return=representation",
      query: new URLSearchParams({
        on_conflict: "project_id,request_number",
        select: "id,request_number",
      }),
    }));
  }
  const requestIdBySource = new Map(promotedHeaders.map((row) => [row.request_number.replace(/^KOPER-/, ""), row.id]));

  type Allocation = {
    requestId: string;
    input: InputRow;
    service: ServiceRow;
    quantity: number;
    productRequestIds: string[];
    sourceLinks: string[];
  };
  const allocations = new Map<string, Allocation>();
  let currentServiceAllocations = 0;
  let legacyServiceAllocations = 0;

  for (const row of itemRows) {
    const payload = objectValue(row.payload);
    const sourceRequestId = row.koper_parent_id ?? identifier(payload.requestId);
    const requestId = sourceRequestId ? requestIdBySource.get(sourceRequestId) : null;
    const productId = identifier(payload.productId);
    const inputSourceId = productId && inputBySource.has(productId) ? productId : identifier(payload.inputId);
    const input = inputSourceId ? inputBySource.get(inputSourceId) : null;
    const quantity = numberValue(payload.productAmount);
    if (!requestId || !input || quantity === null || quantity <= 0) {
      throw new Error(`Incomplete mapping for Koper product request ${row.koper_id}`);
    }

    const links = Array.isArray(payload.services) ? payload.services.map(objectValue) : [];
    const lineAllocations: Array<{ service: ServiceRow; quantity: number; link: string }> = [];
    if (links.length === 0) {
      lineAllocations.push({ service: fallbackService, quantity, link: "sem vínculo de acompanhamento" });
    } else {
      const allocated = links.reduce((sum, link) => sum + (numberValue(link.inputAmount) ?? 0), 0);
      if (Math.abs(allocated - quantity) > 0.00001) {
        const legacyLinks = links.map((link) =>
          `itemMonitInputId=${identifier(link.itemMonitInputId) ?? "n/a"},`
          + `monitInputPchId=${identifier(link.monitInputPchId) ?? "n/a"},`
          + `inputAmount=${numberValue(link.inputAmount) ?? "n/a"}`
        ).join("|");
        lineAllocations.push({
          service: fallbackService,
          quantity,
          link: `divergência histórica: productAmount=${quantity},allocatedAmount=${allocated},links=[${legacyLinks}]`,
        });
      } else {
        for (const link of links) {
          const linkQuantity = numberValue(link.inputAmount);
          if (linkQuantity === null || linkQuantity <= 0) {
            throw new Error(`Invalid service allocation for Koper product request ${row.koper_id}`);
          }
          const service = linkedService(link) ?? fallbackService;
          lineAllocations.push({
            service,
            quantity: linkQuantity,
            link: `itemMonitInputId=${identifier(link.itemMonitInputId) ?? "n/a"},monitInputPchId=${identifier(link.monitInputPchId) ?? "n/a"},inputAmount=${linkQuantity}`,
          });
        }
      }
    }

    for (const allocation of lineAllocations) {
      if (allocation.service.id === fallbackService.id) legacyServiceAllocations += 1;
      else currentServiceAllocations += 1;
      const key = `${requestId}:${input.id}:${allocation.service.id}`;
      const existing = allocations.get(key);
      if (existing) {
        existing.quantity += allocation.quantity;
        existing.productRequestIds.push(row.koper_id);
        existing.sourceLinks.push(allocation.link);
      } else {
        allocations.set(key, {
          requestId,
          input,
          service: allocation.service,
          quantity: allocation.quantity,
          productRequestIds: [row.koper_id],
          sourceLinks: [allocation.link],
        });
      }
    }
  }

  const itemPayloads = [...allocations.values()].map((allocation, sortOrder) => ({
    company_id: env.BOSSA_COMPANY_ID,
    project_id: project.id,
    request_id: allocation.requestId,
    input_id: allocation.input.id,
    input_code: allocation.input.code,
    input_name: allocation.input.description,
    unit_snapshot: allocation.input.unit,
    category_snapshot: allocation.input.category,
    cost_center_service_id: allocation.service.id,
    cost_center_code: allocation.service.code,
    cost_center_name: allocation.service.description,
    requested_quantity: allocation.quantity,
    ordered_quantity: 0,
    notes: `Koper productRequestIds=${allocation.productRequestIds.join(",")} · ${allocation.sourceLinks.join(";")}`,
    sort_order: sortOrder,
    updated_at: now,
  }));
  for (const batch of chunks(itemPayloads, 100)) {
    await requestSupabase<Array<{ id: string }>>("execution_material_request_items", {
      method: "POST",
      body: batch,
      prefer: "resolution=merge-duplicates,return=representation",
      query: new URLSearchParams({
        on_conflict: "request_id,input_id,cost_center_code",
        select: "id",
      }),
    });
  }

  const intendedStatusByRequestNumber = new Map(headerPayloads.map((header) => [
    header.request_number,
    header.status,
  ]));
  for (const status of ["requested", "approved", "attended", "cancelled"] as const) {
    const ids = promotedHeaders.flatMap((header) =>
      intendedStatusByRequestNumber.get(header.request_number) === status ? [header.id] : []
    );
    for (const batch of chunks(ids, 100)) {
      await requestSupabase<Array<{ id: string }>>("execution_material_requests", {
        method: "PATCH",
        body: { status, updated_at: now },
        prefer: "return=representation",
        query: new URLSearchParams({ id: `in.(${batch.join(",")})`, select: "id" }),
      });
    }
  }

  const verifiedRequests = await requestSupabase<Array<{
    id: string;
    request_number: string;
    status: HeaderStatus;
  }>>("execution_material_requests", {
    query: new URLSearchParams({
      select: "id,request_number,status",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${project.id}`,
      request_number: "like.KOPER-*",
      limit: "1000",
    }),
  });
  const verifiedItems: Array<{ id: string }> = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<Array<{ id: string }>>("execution_material_request_items", {
      query: new URLSearchParams({
        select: "id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        project_id: `eq.${project.id}`,
        notes: "like.Koper productRequestIds=*",
        limit: "1000",
        offset: String(offset),
      }),
    });
    verifiedItems.push(...page);
    if (page.length < 1_000) break;
  }
  if (verifiedRequests.length !== headerPayloads.length || verifiedItems.length !== itemPayloads.length) {
    throw new Error("Active Koper stock request verification failed");
  }
  if (verifiedRequests.some((request) =>
    intendedStatusByRequestNumber.get(request.request_number) !== request.status
  )) throw new Error("Koper stock request status verification failed");
  return {
    ok: true,
    requests: headerPayloads.length,
    sourceItems: itemRows.length,
    items: itemPayloads.length,
    requestStatuses: verifiedRequests.reduce<Record<string, number>>((counts, request) => {
      counts[request.status] = (counts[request.status] ?? 0) + 1;
      return counts;
    }, {}),
    currentServiceAllocations,
    legacyServiceAllocations,
    verifiedRequests: verifiedRequests.length,
    verifiedItems: verifiedItems.length,
  };
}
