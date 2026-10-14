"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/suprimentos/aprovacoes-compras";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function numberValue(formData: FormData, key: string) {
  const raw = text(formData, key);
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}
function target(message: string, type: "success" | "error") { return `${PATH}?${new URLSearchParams({ [type]: message }).toString()}`; }
function refresh() { revalidatePath(PATH); revalidatePath("/suprimentos/pedidos-compras"); revalidatePath("/suprimentos/indicadores"); }

export async function savePurchaseApprovalSettings(formData: FormData) {
  const { supabase, companyId } = await requireCompanyPermission("procurement.approval_settings.manage");
  const { error } = await supabase.rpc("save_procurement_purchase_approval_settings", {
    p_company_id: companyId,
    p_enabled: text(formData, "enabled") === "1",
    p_level1_limit: numberValue(formData, "level1_limit"),
    p_level2_limit: numberValue(formData, "level2_limit"),
    p_require_distinct: text(formData, "require_distinct") === "1",
    p_requester_cannot_approve: text(formData, "requester_cannot_approve") === "1",
  });
  if (error) redirect(target(error.message, "error"));
  refresh();
  redirect(target("Regras de alçada atualizadas.", "success"));
}

export async function submitPurchaseOrderForApproval(formData: FormData) {
  const orderId = text(formData, "order_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.orders.manage");
  if (!projectId) redirect(target("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("submit_procurement_purchase_order_for_approval", { p_company_id: companyId, p_project_id: projectId, p_order_id: orderId });
  if (error) redirect(target(error.message, "error"));
  refresh();
  redirect(target("Pedido enviado para as alçadas de aprovação.", "success"));
}

export async function approvePurchaseOrderLevel(formData: FormData) {
  const orderId = text(formData, "order_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.orders.approve");
  if (!projectId) redirect(target("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("approve_procurement_purchase_order_level", { p_company_id: companyId, p_project_id: projectId, p_order_id: orderId, p_notes: text(formData, "notes") || null });
  if (error) redirect(target(error.message, "error"));
  refresh();
  redirect(target("Alçada aprovada.", "success"));
}

export async function rejectPurchaseOrderApproval(formData: FormData) {
  const orderId = text(formData, "order_id");
  const reason = text(formData, "reason");
  if (!reason) redirect(target("Informe o motivo da rejeição.", "error"));
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.orders.approve");
  if (!projectId) redirect(target("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("reject_procurement_purchase_order_approval", { p_company_id: companyId, p_project_id: projectId, p_order_id: orderId, p_reason: reason });
  if (error) redirect(target(error.message, "error"));
  refresh();
  redirect(target("Pedido rejeitado e devolvido para revisão.", "success"));
}
