"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/engenharia/levantamento";
const allowedMethods = new Set(["unit", "count", "length", "area", "volume", "weight", "custom"]);
const allowedStatuses = new Set(["draft", "in_review", "approved"]);
const allowedLocationTypes = new Set(["enterprise", "tower", "floor", "unit", "room", "sector", "external", "other"]);

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function numberValue(formData: FormData, key: string, fallback = Number.NaN) {
  const raw = text(formData, key).replace(/\./g, "").replace(",", ".");
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function optionalNumber(formData: FormData, key: string) {
  const raw = text(formData, key);
  if (!raw) return null;
  const value = numberValue(formData, key);
  return Number.isFinite(value) ? value : null;
}

function resultUrl(message: string, type: "error" | "success" = "error", budgetId?: string | null) {
  const params = new URLSearchParams({ [type]: message });
  if (budgetId) params.set("budget", budgetId);
  return `${LIST_PATH}?${params.toString()}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(value);
}

function calculateTakeoff({
  method,
  elementCount,
  dimensionA,
  dimensionB,
  dimensionC,
  adjustment,
  repetitions,
}: {
  method: string;
  elementCount: number;
  dimensionA: number | null;
  dimensionB: number | null;
  dimensionC: number | null;
  adjustment: number;
  repetitions: number;
}) {
  const a = Number(dimensionA ?? 0);
  const b = Number(dimensionB ?? 0);
  const c = Number(dimensionC ?? 0);
  let perLocation = 0;
  let inside = "";

  if (method === "area") {
    perLocation = elementCount * a * b + adjustment;
    inside = `${formatNumber(elementCount)} × ${formatNumber(a)} × ${formatNumber(b)}`;
  } else if (method === "volume") {
    perLocation = elementCount * a * b * c + adjustment;
    inside = `${formatNumber(elementCount)} × ${formatNumber(a)} × ${formatNumber(b)} × ${formatNumber(c)}`;
  } else if (method === "length" || method === "weight") {
    perLocation = elementCount * a + adjustment;
    inside = `${formatNumber(elementCount)} × ${formatNumber(a)}`;
  } else if (method === "custom") {
    perLocation = a + adjustment;
    inside = formatNumber(a);
  } else {
    perLocation = elementCount + adjustment;
    inside = formatNumber(elementCount);
  }

  if (adjustment) inside += ` ${adjustment > 0 ? "+" : "−"} ${formatNumber(Math.abs(adjustment))}`;
  const safePerLocation = Math.max(0, perLocation);
  const total = safePerLocation * repetitions;

  return {
    quantityPerLocation: safePerLocation,
    totalQuantity: total,
    formula: `${formatNumber(repetitions)} × (${inside})`,
  };
}

async function loadTakeoffReferences(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  const serviceId = text(formData, "service_id");
  const locationId = optional(formData, "location_id");
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("takeoffs.manage");

  if (!projectId) redirect(resultUrl("Selecione uma obra antes de registrar o levantamento.", "error", budgetId));
  if (!budgetId || !serviceId) redirect(resultUrl("Selecione a revisão e o serviço.", "error", budgetId));

  const [budgetResult, serviceResult, locationResult] = await Promise.all([
    supabase
      .from("engineering_budgets")
      .select("id, project_id, status")
      .eq("id", budgetId)
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("engineering_services")
      .select("id, unit, default_method, status")
      .eq("id", serviceId)
      .eq("company_id", companyId)
      .maybeSingle(),
    locationId
      ? supabase
          .from("engineering_takeoff_locations")
          .select("id, repetitions, status")
          .eq("id", locationId)
          .eq("company_id", companyId)
          .eq("project_id", projectId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (!budgetResult.data || budgetResult.data.status === "archived") {
    redirect(resultUrl("A revisão selecionada não está disponível.", "error", budgetId));
  }
  if (!serviceResult.data || serviceResult.data.status !== "active") {
    redirect(resultUrl("O serviço selecionado não está ativo.", "error", budgetId));
  }
  if (locationId && (!locationResult.data || locationResult.data.status !== "active")) {
    redirect(resultUrl("O local selecionado não está ativo.", "error", budgetId));
  }

  return {
    supabase,
    companyId,
    projectId,
    userId,
    budgetId,
    serviceId,
    locationId,
    service: serviceResult.data,
    location: locationResult.data,
  };
}

function takeoffPayload(formData: FormData, references: Awaited<ReturnType<typeof loadTakeoffReferences>>) {
  const method = text(formData, "method") || references.service.default_method || "area";
  const elementCount = numberValue(formData, "element_count", 1);
  const dimensionA = optionalNumber(formData, "dimension_a");
  const dimensionB = optionalNumber(formData, "dimension_b");
  const dimensionC = optionalNumber(formData, "dimension_c");
  const adjustment = numberValue(formData, "adjustment", 0);
  const repetitionOverride = optionalNumber(formData, "repetition_override");
  const officialRepetitions = Number(references.location?.repetitions ?? 1);
  const repetitions = repetitionOverride ?? officialRepetitions;
  const status = text(formData, "status") || "draft";

  if (!allowedMethods.has(method) || !allowedStatuses.has(status)) return null;
  if (!Number.isFinite(elementCount) || elementCount < 0 || !Number.isFinite(adjustment)) return null;
  if (!Number.isFinite(repetitions) || repetitions <= 0) return null;
  if (repetitionOverride && !optional(formData, "repetition_reason")) return null;

  const calculation = calculateTakeoff({
    method,
    elementCount,
    dimensionA,
    dimensionB,
    dimensionC,
    adjustment,
    repetitions,
  });

  if (!Number.isFinite(calculation.totalQuantity) || calculation.totalQuantity < 0) return null;

  return {
    company_id: references.companyId,
    project_id: references.projectId,
    budget_id: references.budgetId,
    location_id: references.locationId,
    service_id: references.serviceId,
    method,
    element_count: elementCount,
    dimension_a: dimensionA,
    dimension_b: dimensionB,
    dimension_c: dimensionC,
    adjustment,
    location_repetitions_snapshot: officialRepetitions,
    repetition_override: repetitionOverride,
    repetition_reason: optional(formData, "repetition_reason"),
    quantity_per_location: calculation.quantityPerLocation,
    total_quantity: calculation.totalQuantity,
    formula: calculation.formula,
    unit_snapshot: references.service.unit,
    source_reference: optional(formData, "source_reference"),
    project_revision: optional(formData, "project_revision"),
    description: optional(formData, "description"),
    status,
  };
}

export async function createEngineeringTakeoffLocation(formData: FormData) {
  const code = text(formData, "code").toUpperCase();
  const name = text(formData, "name");
  const locationType = text(formData, "location_type") || "floor";
  const repetitions = numberValue(formData, "repetitions", 1);
  const sortOrder = Math.trunc(numberValue(formData, "sort_order", 0));
  const parentId = optional(formData, "parent_id");
  const budgetId = optional(formData, "budget_id");

  if (!code || !name || !allowedLocationTypes.has(locationType) || !Number.isFinite(repetitions) || repetitions <= 0) {
    redirect(resultUrl("Informe código, nome, tipo e repetições válidas para o local.", "error", budgetId));
  }

  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("takeoffs.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error", budgetId));

  if (parentId) {
    const { data: parent } = await supabase
      .from("engineering_takeoff_locations")
      .select("id")
      .eq("id", parentId)
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!parent) redirect(resultUrl("O local superior selecionado não pertence à obra.", "error", budgetId));
  }

  const { error } = await supabase.from("engineering_takeoff_locations").insert({
    company_id: companyId,
    project_id: projectId,
    parent_id: parentId,
    code,
    name,
    location_type: locationType,
    repetitions,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    notes: optional(formData, "notes"),
    status: "active",
    created_by: userId,
  });

  if (error) {
    const message = error.code === "23505" ? `Já existe um local com o código ${code} nesta obra.` : error.message;
    redirect(resultUrl(message, "error", budgetId));
  }

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Local adicionado à estrutura da obra.", "success", budgetId));
}

export async function updateEngineeringTakeoffLocation(formData: FormData) {
  const locationId = text(formData, "location_id");
  const code = text(formData, "code").toUpperCase();
  const name = text(formData, "name");
  const locationType = text(formData, "location_type");
  const repetitions = numberValue(formData, "repetitions");
  const sortOrder = Math.trunc(numberValue(formData, "sort_order", 0));
  const parentId = optional(formData, "parent_id");
  const status = text(formData, "status");
  const budgetId = optional(formData, "budget_id");

  if (!locationId || !code || !name || !allowedLocationTypes.has(locationType) || !["active", "inactive"].includes(status) || !Number.isFinite(repetitions) || repetitions <= 0 || parentId === locationId) {
    redirect(resultUrl("Revise os dados do local.", "error", budgetId));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("takeoffs.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error", budgetId));

  const { error } = await supabase
    .from("engineering_takeoff_locations")
    .update({
      parent_id: parentId,
      code,
      name,
      location_type: locationType,
      repetitions,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      notes: optional(formData, "notes"),
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", locationId)
    .eq("company_id", companyId)
    .eq("project_id", projectId);

  if (error) {
    const message = error.code === "23505" ? `Já existe um local com o código ${code} nesta obra.` : error.message;
    redirect(resultUrl(message, "error", budgetId));
  }

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Local atualizado.", "success", budgetId));
}

export async function createEngineeringTakeoff(formData: FormData) {
  const references = await loadTakeoffReferences(formData);
  const payload = takeoffPayload(formData, references);
  if (!payload) redirect(resultUrl("Revise o método, as dimensões, os ajustes e as repetições.", "error", references.budgetId));

  const { error } = await references.supabase.from("engineering_takeoffs").insert({
    ...payload,
    record_status: "active",
    created_by: references.userId,
  });

  if (error) redirect(resultUrl(error.message, "error", references.budgetId));
  revalidatePath(LIST_PATH);
  redirect(resultUrl("Memória de cálculo adicionada.", "success", references.budgetId));
}

export async function updateEngineeringTakeoff(formData: FormData) {
  const takeoffId = text(formData, "takeoff_id");
  const references = await loadTakeoffReferences(formData);
  const payload = takeoffPayload(formData, references);
  if (!takeoffId || !payload) redirect(resultUrl("Revise os dados da memória de cálculo.", "error", references.budgetId));

  const { error } = await references.supabase
    .from("engineering_takeoffs")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", takeoffId)
    .eq("company_id", references.companyId)
    .eq("project_id", references.projectId);

  if (error) redirect(resultUrl(error.message, "error", references.budgetId));
  revalidatePath(LIST_PATH);
  redirect(resultUrl("Memória de cálculo atualizada.", "success", references.budgetId));
}

export async function advanceEngineeringTakeoffStatus(formData: FormData) {
  const takeoffId = text(formData, "takeoff_id");
  const nextStatus = text(formData, "next_status");
  const budgetId = text(formData, "budget_id");
  if (!takeoffId || !allowedStatuses.has(nextStatus)) redirect(resultUrl("Memória inválida.", "error", budgetId));

  const { supabase, companyId, projectId } = await requireCompanyPermission("takeoffs.manage");
  const { error } = await supabase
    .from("engineering_takeoffs")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", takeoffId)
    .eq("company_id", companyId)
    .eq("project_id", projectId ?? "");

  if (error) redirect(resultUrl(error.message, "error", budgetId));
  const message = nextStatus === "approved" ? "Memória aprovada." : nextStatus === "in_review" ? "Memória enviada para conferência." : "Memória reaberta como rascunho.";
  revalidatePath(LIST_PATH);
  redirect(resultUrl(message, "success", budgetId));
}

export async function duplicateEngineeringTakeoff(formData: FormData) {
  const takeoffId = text(formData, "takeoff_id");
  const budgetId = text(formData, "budget_id");
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("takeoffs.manage");
  if (!takeoffId || !projectId) redirect(resultUrl("Memória inválida.", "error", budgetId));

  const { data, error: readError } = await supabase
    .from("engineering_takeoffs")
    .select("budget_id, location_id, service_id, method, element_count, dimension_a, dimension_b, dimension_c, adjustment, location_repetitions_snapshot, repetition_override, repetition_reason, quantity_per_location, total_quantity, formula, unit_snapshot, source_reference, project_revision, description")
    .eq("id", takeoffId)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (readError || !data) redirect(resultUrl(readError?.message ?? "Memória não encontrada.", "error", budgetId));

  const { error } = await supabase.from("engineering_takeoffs").insert({
    company_id: companyId,
    project_id: projectId,
    ...data,
    description: data.description ? `Cópia · ${data.description}` : "Cópia da memória",
    status: "draft",
    record_status: "active",
    created_by: userId,
  });

  if (error) redirect(resultUrl(error.message, "error", budgetId));
  revalidatePath(LIST_PATH);
  redirect(resultUrl("Memória duplicada como rascunho.", "success", budgetId));
}

export async function toggleEngineeringTakeoffRecordStatus(formData: FormData) {
  const takeoffId = text(formData, "takeoff_id");
  const nextStatus = text(formData, "next_record_status");
  const budgetId = text(formData, "budget_id");
  if (!takeoffId || !["active", "inactive"].includes(nextStatus)) redirect(resultUrl("Memória inválida.", "error", budgetId));

  const { supabase, companyId, projectId } = await requireCompanyPermission("takeoffs.manage");
  const { error } = await supabase
    .from("engineering_takeoffs")
    .update({ record_status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", takeoffId)
    .eq("company_id", companyId)
    .eq("project_id", projectId ?? "");

  if (error) redirect(resultUrl(error.message, "error", budgetId));
  revalidatePath(LIST_PATH);
  redirect(resultUrl(nextStatus === "active" ? "Memória reativada." : "Memória retirada da revisão.", "success", budgetId));
}
