"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/execucao/solicitacoes-materiais";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function numeric(formData: FormData, key: string) {
  const raw = text(formData, key);
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

function target(message: string, type: "success" | "error") {
  return `${PATH}?${new URLSearchParams({ [type]: message }).toString()}`;
}

export async function fulfillMaterialRequestFromStock(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.inventory.issue");
  if (!projectId) redirect(target("Selecione uma obra.", "error"));

  const requestItemId = text(formData, "request_item_id");
  const balanceId = text(formData, "balance_id");
  const quantity = numeric(formData, "quantity");
  if (!requestItemId || !balanceId || quantity <= 0) {
    redirect(target("Selecione o saldo de estoque e informe uma quantidade válida.", "error"));
  }

  const { error } = await supabase.rpc("fulfill_execution_material_request_from_stock", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_request_item_id: requestItemId,
    p_balance_id: balanceId,
    p_quantity: quantity,
    p_notes: text(formData, "notes") || null,
  });
  if (error) redirect(target(error.message, "error"));

  revalidatePath(PATH);
  revalidatePath("/suprimentos/estoque");
  revalidatePath("/suprimentos/controle-integrado");
  revalidatePath("/suprimentos/orcamentos-materiais");
  revalidatePath("/engenharia/planejamento-suprimentos");
  redirect(target("Estoque reservado e solicitação atualizada.", "success"));
}
