"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/execucao/solicitacoes-materiais";

type RequestItemPayload = {
  input_id: string;
  quantity: number;
  cost_center_service_id: string;
  cost_center_code: string;
  notes?: string;
};

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function resultUrl(message: string, type: "error" | "success", view?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (view) params.set("view", view);
  return `${LIST_PATH}?${params.toString()}`;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

function parseItems(raw: string): RequestItemPayload[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const rows = parsed.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        input_id: String(row.input_id ?? "").trim(),
        quantity: Number(row.quantity ?? 0),
        cost_center_service_id: String(row.cost_center_service_id ?? "").trim(),
        cost_center_code: String(row.cost_center_code ?? "").trim(),
        notes: String(row.notes ?? "").trim(),
      };
    });
    if (rows.some((row) => !row.input_id || !row.cost_center_service_id || !row.cost_center_code || !Number.isFinite(row.quantity) || row.quantity <= 0)) return null;
    return rows;
  } catch {
    return null;
  }
}

function refresh() {
  revalidatePath(LIST_PATH);
  revalidatePath("/engenharia/planejamento-suprimentos");
  revalidatePath("/dashboard");
}

async function resolveRequestProject({
  supabase,
  companyId,
  requestId,
}: {
  supabase: Awaited<ReturnType<typeof requireCompanyPermission>>["supabase"];
  companyId: string;
  requestId: string;
}) {
  const { data } = await supabase
    .from("execution_material_requests")
    .select("id, project_id, budget_id")
    .eq("id", requestId)
    .eq("company_id", companyId)
    .maybeSingle();
  return data as { id: string; project_id: string; budget_id: string } | null;
}

export async function saveMaterialRequest(formData: FormData) {
  const requestId = text(formData, "request_id") || null;
  const budgetId = text(formData, "budget_id");
  const neededDate = text(formData, "needed_date");
  const notes = text(formData, "notes") || null;
  const items = parseItems(text(formData, "items_json"));

  if (!budgetId || !validDate(neededDate) || !items) {
    redirect(resultUrl("Revise o orçamento, a data, os materiais e os serviços usados como centros de custo.", "error"));
  }

  const { supabase, companyId } = await requireCompanyPermission("execution.material_requests.manage");
  const { data: budget } = await supabase
    .from("engineering_budgets")
    .select("id, project_id, status, is_base")
    .eq("id", budgetId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!budget) redirect(resultUrl("O orçamento informado não pertence à empresa atual.", "error"));
  if (budget.status !== "approved" || budget.is_base !== true) {
    redirect(resultUrl("A solicitação deve usar o orçamento base aprovado da própria obra.", "error"));
  }

  if (requestId) {
    const request = await resolveRequestProject({ supabase, companyId, requestId });
    if (!request) redirect(resultUrl("Solicitação não encontrada.", "error"));
    if (request.project_id !== budget.project_id || request.budget_id !== budget.id) {
      redirect(resultUrl("A solicitação e o orçamento pertencem a contextos de obra diferentes.", "error"));
    }
  }

  const centerIds = [...new Set(items.map((item) => item.cost_center_service_id))];
  const { data: budgetItems, error: budgetItemsError } = await supabase
    .from("engineering_budget_items")
    .select("service_id")
    .eq("company_id", companyId)
    .eq("project_id", budget.project_id)
    .eq("budget_id", budget.id)
    .eq("status", "active")
    .in("service_id", centerIds);

  if (budgetItemsError) redirect(resultUrl("Não foi possível validar os centros de custo da obra.", "error"));
  const allowedCenters = new Set((budgetItems ?? []).map((item) => item.service_id).filter(Boolean));
  if (centerIds.some((serviceId) => !allowedCenters.has(serviceId))) {
    redirect(resultUrl("Há serviço/centro de custo que não pertence ao orçamento base desta obra. Atualize a solicitação.", "error"));
  }

  const { error } = await supabase.rpc("save_execution_material_request", {
    p_company_id: companyId,
    p_project_id: budget.project_id,
    p_request_id: requestId,
    p_budget_id: budgetId,
    p_needed_date: neededDate,
    p_notes: notes,
    p_items: items,
  });

  if (error) redirect(resultUrl(error.message, "error"));
  refresh();
  redirect(resultUrl(requestId ? "Solicitação atualizada." : "Solicitação criada e enviada para aprovação.", "success"));
}

export async function approveMaterialRequest(formData: FormData) {
  const requestId = text(formData, "request_id");
  const { supabase, companyId } = await requireCompanyPermission("execution.material_requests.approve");
  if (!requestId) redirect(resultUrl("Solicitação não encontrada.", "error"));

  const request = await resolveRequestProject({ supabase, companyId, requestId });
  if (!request) redirect(resultUrl("Solicitação não encontrada.", "error"));

  const { error } = await supabase.rpc("approve_execution_material_request", {
    p_company_id: companyId,
    p_project_id: request.project_id,
    p_request_id: requestId,
  });
  if (error) redirect(resultUrl(error.message, "error"));
  refresh();
  redirect(resultUrl("Solicitação aprovada e liberada para Suprimentos.", "success"));
}

export async function cancelMaterialRequest(formData: FormData) {
  const requestId = text(formData, "request_id");
  const reason = text(formData, "reason");
  const { supabase, companyId } = await requireCompanyPermission("execution.material_requests.approve");
  if (!requestId) redirect(resultUrl("Solicitação não encontrada.", "error"));
  if (!reason) redirect(resultUrl("Informe o motivo do cancelamento.", "error"));

  const request = await resolveRequestProject({ supabase, companyId, requestId });
  if (!request) redirect(resultUrl("Solicitação não encontrada.", "error"));

  const { error } = await supabase.rpc("cancel_execution_material_request", {
    p_company_id: companyId,
    p_project_id: request.project_id,
    p_request_id: requestId,
    p_reason: reason,
  });
  if (error) redirect(resultUrl(error.message, "error"));
  refresh();
  redirect(resultUrl("Solicitação cancelada.", "success"));
}