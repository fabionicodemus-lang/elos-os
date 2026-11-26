"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";
import { isUuid } from "@/lib/eobra-import/resolution.mjs";
import { safeImportDatabaseMessage } from "@/lib/eobra-import/server";

const PATH = "/configuracoes/importacoes/correcao-eobra";
const destination = (message: string, type = "error") => `${PATH}?${new URLSearchParams({ [type]: message })}`;

async function correctionContext(form: FormData, permission = "admin.company.manage") {
  const workspace = await requireCompanyPermission(permission);
  if (String(form.get("company_id") ?? "") !== workspace.companyId) redirect(destination("A empresa selecionada mudou. Atualize esta página e confira a revisão novamente."));
  return workspace;
}

function reviewedHash(form: FormData) {
  const hash = String(form.get("preview_hash") ?? "");
  if (!/^[a-f0-9]{64}$/.test(hash) || form.get("confirm_review") !== "on") redirect(destination("Confira a prévia e confirme a revisão antes de continuar."));
  return hash;
}

function revalidateFinancialViews() {
  for (const path of [PATH, "/financeiro/indices-de-correcao", "/financeiro/contas-a-receber", "/comercial/planos-de-pagamento", "/comercial/vendas", "/dashboard"]) revalidatePath(path);
}

export async function bindCorrectionIndex(form: FormData) {
  const { supabase, companyId } = await correctionContext(form);
  const sourceId = String(form.get("source_index_id") ?? "");
  const indexId = String(form.get("correction_index_id") ?? "");
  const hash = reviewedHash(form);
  if (!isUuid(sourceId) || !isUuid(indexId)) redirect(destination("Selecione os índices de origem e destino para conferir o vínculo."));
  const result = await supabase.rpc("bind_eobra_correction_index", { p_company_id: companyId, p_source_index_id: sourceId, p_correction_index_id: indexId, p_preview_hash: hash });
  if (result.error) redirect(destination(safeImportDatabaseMessage(result.error)));
  revalidateFinancialViews();
  redirect(destination("Índices vinculados e competências conferidas. As parcelas podem ser revisadas individualmente abaixo.", "success"));
}

export async function activateCorrectionPolicy(form: FormData) {
  const { supabase, companyId } = await correctionContext(form);
  const receivableId = String(form.get("receivable_id") ?? "");
  const recordId = String(form.get("source_record_id") ?? "");
  const hash = reviewedHash(form);
  if (!isUuid(receivableId) || !isUuid(recordId)) redirect(destination("A parcela desta revisão é inválida. Abra a conferência novamente."));
  const result = await supabase.rpc("activate_eobra_receivable_correction", { p_company_id: companyId, p_receivable_id: receivableId, p_source_record_id: recordId, p_preview_hash: hash });
  if (result.error) redirect(destination(safeImportDatabaseMessage(result.error)));
  revalidateFinancialViews();
  redirect(destination("Política ativada para a parcela conferida. Consulte a fila para atualizar competências posteriores ao corte.", "success"));
}

export async function refreshCorrectionBatch(form: FormData) {
  const { supabase, companyId } = await correctionContext(form, "receivables.manage");
  const result = await supabase.rpc("refresh_receivable_correction_policies", { p_company_id: companyId, p_correction_index_id: null, p_limit: 500 });
  if (result.error) redirect(destination(safeImportDatabaseMessage(result.error)));
  const counts = result.data as { processed?: number; updated?: number; pending?: number; total_blocked?: number } | null;
  revalidateFinancialViews();
  redirect(destination(`${counts?.processed ?? 0} parcela(s) conferida(s); ${counts?.updated ?? 0} atualização(ões) validada(s). Restam ${counts?.pending ?? 0} na fila e ${counts?.total_blocked ?? 0} com pendência de índice ou revisão.`, "success"));
}
