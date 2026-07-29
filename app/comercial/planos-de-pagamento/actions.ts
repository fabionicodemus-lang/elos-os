"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/comercial/planos-de-pagamento";

function safeReturnPath(formData: FormData) {
  const requested = String(formData.get("return_path") ?? "").trim();
  if (/^\/comercial\/vendas\/[0-9a-f-]+$/i.test(requested)) return requested;
  return PATH;
}

function pageUrl(
  message: string,
  type: "error" | "success" = "error",
  saleId?: string,
  basePath = PATH,
) {
  const params = new URLSearchParams({ [type]: message });
  if (saleId && basePath === PATH) params.set("sale", saleId);
  return `${basePath}?${params.toString()}`;
}

function optional(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim() || null;
}

function parseMoney(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) return Number.NaN;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  return Number(normalized);
}

function addMonths(dateValue: string, months: number) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const targetIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetIndex / 12);
  const targetMonthIndex = ((targetIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

const categoryLabels: Record<string, string> = {
  entry: "Entrada",
  monthly: "Parcela mensal",
  reinforcement: "Reforço",
  keys: "Parcela nas chaves",
  post_keys: "Parcela pós-chaves",
  other: "Outra parcela",
};

const frequencyMonths: Record<string, number> = {
  once: 0,
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

export async function createReceivableSeries(formData: FormData) {
  const saleId = String(formData.get("sale_id") ?? "");
  const returnPath = safeReturnPath(formData);
  const category = String(formData.get("category") ?? "");
  const firstDueDate = String(formData.get("first_due_date") ?? "");
  const frequency = String(formData.get("frequency") ?? "once");
  const amount = parseMoney(formData.get("amount"));
  const requestedQuantity = Number.parseInt(String(formData.get("quantity") ?? "1"), 10);
  const quantity = frequency === "once" ? 1 : requestedQuantity;
  const correctionIndexId = String(formData.get("correction_index_id") ?? "").trim() || null;

  if (
    !saleId ||
    !categoryLabels[category] ||
    !firstDueDate ||
    frequencyMonths[frequency] === undefined ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 240
  ) {
    redirect(pageUrl("Informe venda, tipo, vencimento, quantidade e valor válidos.", "error", saleId, returnPath));
  }

  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("receivables.manage");

  if (!projectId) {
    redirect(pageUrl("Selecione uma obra antes de montar o plano.", "error", saleId, returnPath));
  }

  const { data: sale } = await supabase
    .from("sales")
    .select("id, client_id, unit_id, status, sale_date")
    .eq("id", saleId)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!sale || sale.status !== "active") {
    redirect(pageUrl("A venda selecionada não pertence ao ambiente ativo ou está cancelada.", "error", saleId, returnPath));
  }

  let correctionIndex: { id: string; code: string } | null = null;
  let correctionBaseMonth: string | null = null;
  let correctionBaseValue: number | null = null;

  if (correctionIndexId) {
    const indexResult = await supabase
      .from("correction_indices")
      .select("id, code")
      .eq("id", correctionIndexId)
      .eq("company_id", companyId)
      .eq("status", "active")
      .maybeSingle();

    if (!indexResult.data) {
      redirect(pageUrl("O índice de correção selecionado não está disponível.", "error", saleId, returnPath));
    }

    correctionIndex = indexResult.data;
    correctionBaseMonth = `${sale.sale_date.slice(0, 7)}-01`;

    const baseValueResult = await supabase
      .from("correction_index_values")
      .select("value")
      .eq("company_id", companyId)
      .eq("correction_index_id", correctionIndexId)
      .lte("reference_month", correctionBaseMonth)
      .order("reference_month", { ascending: false })
      .limit(1)
      .maybeSingle();

    correctionBaseValue = baseValueResult.data ? Number(baseValueResult.data.value) : null;
  }

  const description = optional(formData, "description") || categoryLabels[category];
  const interestRate = parseMoney(formData.get("interest_rate_monthly"));
  const notes = optional(formData, "notes");
  const stepMonths = frequencyMonths[frequency];
  const batchId = crypto.randomUUID();

  const rows = Array.from({ length: quantity }, (_, index) => ({
    company_id: companyId,
    project_id: projectId,
    sale_id: sale.id,
    client_id: sale.client_id,
    unit_id: sale.unit_id,
    category,
    description,
    sequence_number: index + 1,
    sequence_total: quantity,
    due_date: addMonths(firstDueDate, stepMonths * index),
    amount,
    adjustment_index: correctionIndex?.code ?? null,
    correction_index_id: correctionIndex?.id ?? null,
    correction_base_month: correctionBaseMonth,
    correction_base_value: correctionBaseValue,
    interest_rate_monthly: Number.isFinite(interestRate) && interestRate >= 0 ? interestRate : null,
    status: "open",
    correction_locked: false,
    notes,
    source_system: "elos_os",
    source_id: `manual_${batchId}_${index + 1}`,
    created_by: userId,
  }));

  const { error } = await supabase.from("receivables").insert(rows);
  if (error) redirect(pageUrl(error.message, "error", saleId, returnPath));

  revalidatePath(PATH);
  revalidatePath("/comercial/vendas");
  revalidatePath(returnPath);
  redirect(pageUrl(`${quantity} parcela(s) adicionada(s) ao plano.`, "success", saleId, returnPath));
}

export async function markReceivablePaid(formData: FormData) {
  const receivableId = String(formData.get("receivable_id") ?? "").trim();
  const saleId = String(formData.get("sale_id") ?? "").trim();
  const bankAccountId = String(formData.get("bank_account_id") ?? "").trim();
  const returnPath = safeReturnPath(formData);
  const paidAt = String(formData.get("paid_at") ?? "").trim();
  const paidAmount = parseMoney(formData.get("paid_amount"));

  if (!receivableId || !bankAccountId || !paidAt || !Number.isFinite(paidAmount) || paidAmount <= 0) {
    redirect(pageUrl("Informe conta bancária, data e valor recebidos.", "error", saleId, returnPath));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("receivables.manage");
  const receivableResult = await supabase
    .from("receivables")
    .select("id,project_id,status")
    .eq("id", receivableId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!receivableResult.data || receivableResult.data.status !== "open") {
    redirect(pageUrl("A parcela não está disponível para recebimento.", "error", saleId, returnPath));
  }

  const resolvedProjectId = projectId ?? receivableResult.data.project_id;
  const result = await supabase.rpc("receive_finance_receivable", {
    p_company_id: companyId,
    p_project_id: resolvedProjectId,
    p_receivable_id: receivableId,
    p_account_id: bankAccountId,
    p_paid_at: paidAt,
    p_paid_amount: paidAmount,
  });

  if (result.error) redirect(pageUrl(result.error.message, "error", saleId, returnPath));

  revalidatePath(PATH);
  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/contas-bancarias");
  revalidatePath("/financeiro/fluxo-de-caixa");
  revalidatePath(returnPath);
  redirect(pageUrl("Recebimento registrado, correção travada e extrato atualizado.", "success", saleId, returnPath));
}

export async function cancelReceivable(formData: FormData) {
  const receivableId = String(formData.get("receivable_id") ?? "");
  const saleId = String(formData.get("sale_id") ?? "");
  const returnPath = safeReturnPath(formData);
  if (!receivableId) redirect(pageUrl("Parcela inválida.", "error", saleId, returnPath));

  const { supabase, companyId, projectId } = await requireCompanyPermission("receivables.manage");
  let query = supabase
    .from("receivables")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", receivableId)
    .eq("company_id", companyId)
    .eq("status", "open");

  if (projectId) query = query.eq("project_id", projectId);
  const { error } = await query;
  if (error) redirect(pageUrl(error.message, "error", saleId, returnPath));

  revalidatePath(PATH);
  revalidatePath("/comercial/vendas");
  revalidatePath(returnPath);
  redirect(pageUrl("Parcela cancelada.", "success", saleId, returnPath));
}
