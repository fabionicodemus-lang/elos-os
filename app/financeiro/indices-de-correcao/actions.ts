"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/financeiro/indices-de-correcao";

function pageUrl(message: string, type: "error" | "success" = "error") {
  const params = new URLSearchParams({ [type]: message });
  return `${PATH}?${params.toString()}`;
}

function parseDecimal(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) return Number.NaN;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  return Number(normalized);
}

export async function saveCorrectionIndexValue(formData: FormData) {
  const correctionIndexId = String(formData.get("correction_index_id") ?? "");
  const referenceMonthInput = String(formData.get("reference_month") ?? "");
  const value = parseDecimal(formData.get("value"));
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!correctionIndexId || !/^\d{4}-\d{2}$/.test(referenceMonthInput) || !Number.isFinite(value)) {
    redirect(pageUrl("Informe índice, mês de referência e valor válido."));
  }

  const referenceMonth = `${referenceMonthInput}-01`;
  const { supabase, companyId, userId } = await requireCompanyPermission("indices.manage");

  const { data: correctionIndex } = await supabase
    .from("correction_indices")
    .select("id, code")
    .eq("id", correctionIndexId)
    .eq("company_id", companyId)
    .eq("status", "active")
    .maybeSingle();

  if (!correctionIndex) {
    redirect(pageUrl("O índice selecionado não pertence à empresa ativa."));
  }

  const { error } = await supabase
    .from("correction_index_values")
    .upsert(
      {
        company_id: companyId,
        correction_index_id: correctionIndexId,
        reference_month: referenceMonth,
        value,
        notes,
        created_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,correction_index_id,reference_month" },
    );

  if (error) redirect(pageUrl(error.message));

  revalidatePath(PATH);
  revalidatePath("/comercial/planos-de-pagamento");
  revalidatePath("/comercial/vendas");
  redirect(pageUrl(`${correctionIndex.code} de ${referenceMonthInput} salvo com sucesso.`, "success"));
}
