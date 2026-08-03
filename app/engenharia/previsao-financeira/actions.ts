"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/engenharia/previsao-financeira";

function pageUrl(message: string, type: "error" | "success" = "error") {
  return `${PATH}?${new URLSearchParams({ [type]: message }).toString()}`;
}

export async function updateForecastSettings(formData: FormData) {
  const paymentDays = Number.parseInt(String(formData.get("forecast_default_payment_days") ?? ""), 10);
  if (!Number.isFinite(paymentDays) || paymentDays < 0 || paymentDays > 365) {
    redirect(pageUrl("Informe um prazo padrão entre 0 e 365 dias."));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("projects.manage");
  if (!projectId) redirect(pageUrl("Selecione uma obra antes de alterar a configuração."));

  const { error } = await supabase
    .from("projects")
    .update({ forecast_default_payment_days: paymentDays, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("company_id", companyId);

  if (error) redirect(pageUrl(error.message));

  revalidatePath(PATH);
  revalidatePath("/engenharia/curvas");
  revalidatePath("/financeiro/fluxo-de-caixa");
  redirect(pageUrl("Prazo padrão da previsão atualizado.", "success"));
}
