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
  const { supabase, companyId } = await requireCompanyPermission("procurement.inventory.issue");

  const requestItemId = text(formData, "request_item_id");
  const balanceId = text(formData, "balance_id");
  const quantity = numeric(formData, "quantity");
  if (!requestItemId || !balanceId || quantity <= 0) {
    redirect(target("Selecione o saldo de estoque e informe uma quantidade válida.", "error"));
  }

  const [{ data: requestItem }, { data: balance }] = await Promise.all([
    supabase
      .from("execution_material_request_items")
      .select("id, project_id, input_id")
      .eq("id", requestItemId)
      .eq("company_id", companyId)
      .maybeSingle(),
    supabase
      .from("procurement_inventory_balances")
      .select("id, project_id, input_id")
      .eq("id", balanceId)
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);

  if (!requestItem || !balance) redirect(target("Solicitação ou saldo de estoque não encontrado.", "error"));
  if (requestItem.project_id !== balance.project_id || requestItem.input_id !== balance.input_id) {
    redirect(target("O saldo selecionado não pertence à mesma obra/material da solicitação.", "error"));
  }

  const { error } = await supabase.rpc("fulfill_execution_material_request_from_stock", {
    p_company_id: companyId,
    p_project_id: requestItem.project_id,
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