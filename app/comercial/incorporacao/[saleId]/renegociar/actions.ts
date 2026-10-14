"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

function money(value: FormDataEntryValue | null, fallback = Number.NaN) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) return fallback;
  const parsed = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function executeRenegotiation(formData: FormData) {
  const saleId = String(formData.get("sale_id") ?? "").trim();
  const effectiveDate = String(formData.get("effective_date") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const financialImpact = money(formData.get("financial_impact"), 0);
  const rawItems = String(formData.get("items_json") ?? "");

  if (!saleId || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || reason.length < 5 || !Number.isFinite(financialImpact)) {
    redirect(`/comercial/incorporacao/${saleId}/renegociar?error=${encodeURIComponent("Informe vigência, motivo e impacto financeiro válidos.")}`);
  }

  let items: unknown;
  try {
    items = JSON.parse(rawItems);
  } catch {
    redirect(`/comercial/incorporacao/${saleId}/renegociar?error=${encodeURIComponent("O novo plano de pagamento está inválido.")}`);
  }
  if (!Array.isArray(items) || items.length < 1 || items.length > 240) {
    redirect(`/comercial/incorporacao/${saleId}/renegociar?error=${encodeURIComponent("Inclua entre 1 e 240 parcelas no novo plano.")}`);
  }

  const { supabase, companyId, userId } = await requireCompanyPermission("commercial.incorporation.approve");
  const { data: sale } = await supabase.from("sales").select("id,status").eq("id", saleId).eq("company_id", companyId).maybeSingle();
  if (!sale || sale.status !== "active") {
    redirect(`/comercial/incorporacao?error=${encodeURIComponent("Venda ativa não encontrada.")}`);
  }

  const { error } = await supabase.rpc("commercial_execute_payment_plan_renegotiation", {
    p_company_id: companyId,
    p_sale_id: saleId,
    p_effective_date: effectiveDate,
    p_reason: reason,
    p_financial_impact: financialImpact,
    p_items: items,
    p_user_id: userId,
  });
  if (error) {
    redirect(`/comercial/incorporacao/${saleId}/renegociar?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/comercial/incorporacao");
  revalidatePath(`/comercial/incorporacao/${saleId}`);
  revalidatePath(`/comercial/incorporacao/${saleId}/renegociar`);
  revalidatePath(`/comercial/vendas/${saleId}`);
  revalidatePath("/comercial/planos-de-pagamento");
  revalidatePath("/financeiro/contas-a-receber");
  redirect(`/comercial/incorporacao/${saleId}?success=${encodeURIComponent("Renegociação executada e novo fluxo financeiro gerado.")}`);
}
