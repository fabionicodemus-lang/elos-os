"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const IMPORT_PATH = "/engenharia/orcamentos/importar";

function batchPath(batchId: string) {
  return `${IMPORT_PATH}/${batchId}`;
}

function messageUrl(batchId: string, message: string, type: "error" | "success" = "error") {
  const safe = message.length > 1200 ? `${message.slice(0, 1197)}...` : message;
  return `${batchPath(batchId)}?${new URLSearchParams({ [type]: safe }).toString()}`;
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function resolveBudgetImportEntity(formData: FormData) {
  const batchId = text(formData, "batch_id");
  const rowId = text(formData, "row_id");
  const action = text(formData, "resolution_action");
  const targetId = text(formData, "target_id") || null;
  const category = text(formData, "category") || null;
  const note = text(formData, "note") || null;

  if (!batchId || !rowId || !["reuse", "create"].includes(action)) {
    redirect(messageUrl(batchId || "invalido", "Resolução inválida."));
  }

  const { supabase, companyId } = await requireCompanyPermission("budgets.manage");
  const { data, error } = await supabase.rpc("resolve_engineering_budget_import_entity", {
    p_company_id: companyId,
    p_batch_id: batchId,
    p_row_id: rowId,
    p_action: action,
    p_target_id: targetId,
    p_category: category,
    p_note: note,
  });

  if (error) redirect(messageUrl(batchId, error.message));
  revalidatePath(batchPath(batchId));
  redirect(messageUrl(batchId, `${Number(data ?? 0).toLocaleString("pt-BR")} linha(s) da mesma entidade resolvida(s).`, "success"));
}

export async function promoteBudgetImport(formData: FormData) {
  const batchId = text(formData, "batch_id");
  const code = text(formData, "budget_code").toUpperCase();
  const name = text(formData, "budget_name");
  const version = text(formData, "budget_version").toUpperCase();

  if (!batchId || !code || !name || !version) {
    redirect(messageUrl(batchId || "invalido", "Informe código, nome e versão da revisão que será criada."));
  }

  const { supabase, companyId } = await requireCompanyPermission("budgets.manage");
  // Older staging batches may contain zero-quantity services. Re-reading applies the
  // current parser to the whole composition without silently changing the audit trail.
  const invalidServices = await supabase.from("engineering_budget_import_rows")
    .select("id", { count: "exact", head: true }).eq("company_id", companyId)
    .eq("batch_id", batchId).eq("entity_kind", "service").or("quantity.lte.0,quantity.is.null");
  if (invalidServices.error) redirect(messageUrl(batchId, invalidServices.error.message));
  if ((invalidServices.count ?? 0) > 0) redirect(messageUrl(batchId, "Este lote antigo contém serviços zerados ou sem quantidade válida. Cancele o lote e envie o XLSX novamente para desconsiderar esses serviços e suas composições."));
  const { data, error } = await supabase.rpc("promote_engineering_budget_import", {
    p_company_id: companyId,
    p_batch_id: batchId,
    p_budget_code: code,
    p_budget_name: name,
    p_budget_version: version,
  });

  if (error || !data) redirect(messageUrl(batchId, error?.message || "Não foi possível promover o orçamento."));

  revalidatePath(IMPORT_PATH);
  revalidatePath("/engenharia/orcamentos");
  revalidatePath(`/engenharia/orcamentos/${data}`);
  redirect(`/engenharia/orcamentos/${data}?${new URLSearchParams({ success: "Orçamento promovido a partir do staging. Revise a conciliação antes de torná-lo orçamento base." }).toString()}`);
}
