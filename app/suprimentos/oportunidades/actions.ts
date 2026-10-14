"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/suprimentos/oportunidades";
function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function numeric(formData: FormData, key: string) {
  const raw = text(formData, key);
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}
function target(message: string, type: "success" | "error") { return `${PATH}?${new URLSearchParams({ [type]: message }).toString()}`; }

export async function transferStockOpportunity(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.intelligence.manage");
  if (!projectId) redirect(target("Selecione a obra de destino.", "error"));
  const fromProjectId = text(formData, "from_project_id");
  const fromBalanceId = text(formData, "from_balance_id");
  const toLocationId = text(formData, "to_location_id");
  const quantity = numeric(formData, "quantity");
  if (!fromProjectId || !fromBalanceId || !toLocationId || quantity <= 0) redirect(target("Informe origem, destino e quantidade válidos.", "error"));
  if (fromProjectId === projectId) redirect(target("A origem precisa ser outra obra.", "error"));

  const { error } = await supabase.rpc("transfer_procurement_inventory_between_projects", {
    p_company_id: companyId,
    p_from_project_id: fromProjectId,
    p_to_project_id: projectId,
    p_from_balance_id: fromBalanceId,
    p_to_location_id: toLocationId,
    p_quantity: quantity,
    p_notes: text(formData, "notes") || "Transferência sugerida pela Central de Oportunidades de Compras",
  });
  if (error) redirect(target(error.message, "error"));

  revalidatePath(PATH);
  revalidatePath("/suprimentos/estoque");
  revalidatePath("/suprimentos/controle-integrado");
  revalidatePath("/execucao/solicitacoes-materiais");
  revalidatePath("/engenharia/planejamento-suprimentos");
  redirect(target("Transferência entre obras registrada. O saldo a comprar foi recalculado.", "success"));
}
