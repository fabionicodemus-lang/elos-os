"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/financeiro/contas-a-pagar";

function pageUrl(message: string, type: "error" | "success" = "error") {
  const params = new URLSearchParams({ [type]: message });
  return `${PATH}?${params.toString()}`;
}

function optional(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim() || null;
}

function parseMoney(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) return Number.NaN;

  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;

  return Number(normalized);
}

export async function createPayable(formData: FormData) {
  const supplierId = String(formData.get("supplier_id") ?? "");
  const dueDate = String(formData.get("due_date") ?? "");
  const amount = parseMoney(formData.get("amount"));

  if (!supplierId || !dueDate || !Number.isFinite(amount) || amount < 0) {
    redirect(pageUrl("Informe fornecedor, vencimento e valor válido."));
  }

  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("payables.manage");

  if (!projectId) {
    redirect(pageUrl("Selecione uma obra antes de criar a conta."));
  }

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id")
    .eq("id", supplierId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!supplier) {
    redirect(pageUrl("O fornecedor selecionado não pertence à empresa ativa."));
  }

  const { error } = await supabase.from("payables").insert({
    company_id: companyId,
    project_id: projectId,
    supplier_id: supplierId,
    document: optional(formData, "document"),
    fiscal_class: optional(formData, "fiscal_class"),
    payment_method: optional(formData, "payment_method"),
    due_date: dueDate,
    amount,
    status: "open",
    installment_label: optional(formData, "installment_label"),
    notes: optional(formData, "notes"),
    origin: "manual",
    source_system: "elos_os",
    source_id: `manual_${crypto.randomUUID()}`,
    created_by: userId,
  });

  if (error) redirect(pageUrl(error.message));
  revalidatePath(PATH);
  redirect(pageUrl("Conta cadastrada com sucesso.", "success"));
}

export async function markPayablePaid(formData: FormData) {
  const payableId = String(formData.get("payable_id") ?? "");
  const paidAt = String(formData.get("paid_at") ?? "");
  const paidAmount = parseMoney(formData.get("paid_amount"));
  const paidAccountName = optional(formData, "paid_account_name");

  if (!payableId || !paidAt || !Number.isFinite(paidAmount) || paidAmount < 0) {
    redirect(pageUrl("Informe data e valor pagos."));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("payables.manage");
  let query = supabase
    .from("payables")
    .update({
      status: "paid",
      paid_at: paidAt,
      paid_amount: paidAmount,
      paid_account_name: paidAccountName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payableId)
    .eq("company_id", companyId);

  if (projectId) query = query.eq("project_id", projectId);
  const { error } = await query;

  if (error) redirect(pageUrl(error.message));
  revalidatePath(PATH);
  redirect(pageUrl("Pagamento registrado.", "success"));
}

export async function cancelPayable(formData: FormData) {
  const payableId = String(formData.get("payable_id") ?? "");
  if (!payableId) redirect(pageUrl("Conta inválida."));

  const { supabase, companyId, projectId } = await requireCompanyPermission("payables.manage");
  let query = supabase
    .from("payables")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", payableId)
    .eq("company_id", companyId)
    .eq("status", "open");

  if (projectId) query = query.eq("project_id", projectId);
  const { error } = await query;

  if (error) redirect(pageUrl(error.message));
  revalidatePath(PATH);
  redirect(pageUrl("Conta cancelada.", "success"));
}
