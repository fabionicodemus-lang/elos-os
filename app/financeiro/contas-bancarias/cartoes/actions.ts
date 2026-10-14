"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/financeiro/contas-bancarias/cartoes";
const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

function finish(message: string, error = false, instrument?: string): never {
  revalidatePath(PATH);
  revalidatePath("/financeiro/contas-bancarias");
  const params = new URLSearchParams({ [error ? "error" : "success"]: message });
  if (instrument) params.set("instrument", instrument);
  redirect(`${PATH}?${params}`);
}

export async function saveCardSettings(formData: FormData) {
  const { supabase } = await requireCompanyPermission("finance.bank_accounts.manage");
  const instrument = text(formData, "instrument");
  const { error } = await supabase.rpc("bank_save_card_settings", {
    p_instrument: instrument,
    p_limit: text(formData, "limit") ? Number(text(formData, "limit")) : null,
    p_closing_day: Number(text(formData, "closing_day")),
    p_due_day: Number(text(formData, "due_day")),
  });
  finish(error?.message ?? "Configuração do cartão salva.", Boolean(error), instrument);
}

export async function postCardPurchase(formData: FormData) {
  const { supabase } = await requireCompanyPermission("finance.bank_accounts.manage");
  const instrument = text(formData, "instrument");
  const { error } = await supabase.rpc("bank_post_card_purchase", {
    p_instrument: instrument,
    p_project: text(formData, "project") || null,
    p_purchase_date: text(formData, "purchase_date"),
    p_description: text(formData, "description"),
    p_total: Number(text(formData, "total")),
    p_installments: Number(text(formData, "installments") || "1"),
    p_external_reference: text(formData, "external_reference") || null,
  });
  finish(error?.message ?? "Compra lançada nas faturas correspondentes.", Boolean(error), instrument);
}

export async function closeCardCycle(formData: FormData) {
  const { supabase } = await requireCompanyPermission("finance.bank_accounts.manage");
  const instrument = text(formData, "instrument");
  const { error } = await supabase.rpc("bank_close_card_cycle", { p_cycle: text(formData, "cycle") });
  finish(error?.message ?? "Fatura fechada.", Boolean(error), instrument);
}

export async function payCardCycle(formData: FormData) {
  const { supabase } = await requireCompanyPermission("finance.bank_accounts.manage");
  const instrument = text(formData, "instrument");
  const { error } = await supabase.rpc("bank_pay_card_cycle", {
    p_cycle: text(formData, "cycle"),
    p_account: text(formData, "account"),
    p_date: text(formData, "date"),
    p_amount: Number(text(formData, "amount")),
  });
  finish(error?.message ?? "Pagamento da fatura registrado.", Boolean(error), instrument);
}

export async function cancelCardPurchase(formData: FormData) {
  const { supabase } = await requireCompanyPermission("finance.bank_accounts.manage");
  const instrument = text(formData, "instrument");
  const { error } = await supabase.rpc("bank_cancel_card_purchase", {
    p_purchase_group: text(formData, "purchase_group"),
    p_reason: text(formData, "reason"),
  });
  finish(error?.message ?? "Compra cancelada com histórico preservado.", Boolean(error), instrument);
}
