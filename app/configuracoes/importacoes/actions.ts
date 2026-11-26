"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";
import { isUuid } from "@/lib/eobra-import/resolution.mjs";
import { safeImportDatabaseMessage } from "@/lib/eobra-import/server";

const PATH = "/configuracoes/importacoes";
function destination(batchId: string, message: string, type = "error") {
  return `${PATH}${isUuid(batchId) ? `/${batchId}` : ""}?${new URLSearchParams({ [type]: message })}`;
}

export async function promoverEobraImport(form: FormData) {
  const batchId = String(form.get("batch_id") ?? "");
  const previewHash = String(form.get("preview_hash") ?? "");
  if (!isUuid(batchId) || !/^[0-9a-f]{64}$/.test(previewHash)) redirect(destination("", "Lote de importação inválido."));
  if (form.get("confirm_review") !== "on") redirect(destination(batchId, "Confirme a obra, os vínculos e os totais antes de importar."));
  const { supabase, companyId } = await requireCompanyPermission("admin.company.manage");
  const batch = await supabase.from("integration_import_batches").select("id").eq("id", batchId).eq("company_id", companyId).maybeSingle();
  if (batch.error || !batch.data) redirect(destination("", "O lote não está disponível na empresa selecionada."));
  const result = await supabase.rpc("promote_eobra_import", { p_batch_id: batchId, p_preview_hash: previewHash });
  if (result.error) redirect(destination(batchId, safeImportDatabaseMessage(result.error)));
  for (const path of [PATH, `${PATH}/${batchId}`, "/cadastros/fornecedores", "/cadastros/clientes", "/financeiro/contas-a-pagar", "/financeiro/contas-a-receber", "/dashboard"]) revalidatePath(path);
  redirect(destination(batchId, "Importação concluída. O resultado de cada registro está disponível abaixo.", "success"));
}

export async function cancelarEobraImport(form: FormData) {
  const batchId = String(form.get("batch_id") ?? "");
  if (!isUuid(batchId)) redirect(destination("", "Lote de importação inválido."));
  const { supabase, companyId } = await requireCompanyPermission("admin.company.manage");
  const batch = await supabase.from("integration_import_batches").select("id").eq("id", batchId).eq("company_id", companyId).maybeSingle();
  if (batch.error || !batch.data) redirect(destination("", "O lote não está disponível na empresa selecionada."));
  const result = await supabase.rpc("cancel_eobra_import", { p_batch_id: batchId });
  if (result.error) redirect(destination(batchId, safeImportDatabaseMessage(result.error)));
  revalidatePath(PATH); revalidatePath(`${PATH}/${batchId}`);
  redirect(destination(batchId, "Lote cancelado. Nenhum registro oficial foi removido.", "success"));
}
