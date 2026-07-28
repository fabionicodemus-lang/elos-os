"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/execucao/solicitacoes-materiais";

type RequestItemPayload = {
  input_id: string;
  quantity: number;
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
        cost_center_code: String(row.cost_center_code ?? "").trim(),
        notes: String(row.notes ?? "").trim(),
      };
    });
    if (rows.some((row) => !row.input_id || !row.cost_center_code || !Number.isFinite(row.quantity) || row.quantity <= 0)) return null;
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

export async function saveMaterialRequest(formData: FormData) {
  const requestId = text(formData, "request_id") || null;
  const budgetId = text(formData, "budget_id");
  const neededDate = text(formData, "needed_date");
  const notes = text(formData, "notes") || null;
  const items = parseItems(text(formData, "items_json"));

  if (!budgetId || !validDate(neededDate) || !items) {
    redirect(resultUrl("Revise o orçamento, a data de necessidade e os materiais da solicitação.", "error"));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.material_requests.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra antes de criar a solicitação.", "error"));

  const { error } = await supabase.rpc("save_execution_material_request", {
    p_company_id: companyId,
    p_project_id: projectId,
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
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.material_requests.approve");
  if (!projectId || !requestId) redirect(resultUrl("Solicitação não encontrada.", "error"));

  const { error } = await supabase.rpc("approve_execution_material_request", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_request_id: requestId,
  });
  if (error) redirect(resultUrl(error.message, "error"));
  refresh();
  redirect(resultUrl("Solicitação aprovada e liberada para Suprimentos.", "success"));
}

export async function cancelMaterialRequest(formData: FormData) {
  const requestId = text(formData, "request_id");
  const reason = text(formData, "reason");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.material_requests.approve");
  if (!projectId || !requestId) redirect(resultUrl("Solicitação não encontrada.", "error"));
  if (!reason) redirect(resultUrl("Informe o motivo do cancelamento.", "error"));

  const { error } = await supabase.rpc("cancel_execution_material_request", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_request_id: requestId,
    p_reason: reason,
  });
  if (error) redirect(resultUrl(error.message, "error"));
  refresh();
  redirect(resultUrl("Solicitação cancelada.", "success"));
}
