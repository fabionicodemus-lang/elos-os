"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { financialInstallmentSummary, type FinancialInstallmentDraft } from "@/lib/financial-installments";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/financeiro/notas-manuais";
const retentionKeys = new Set(["inss", "iss", "irrf", "pis", "cofins", "csll", "other"]);
const dueTriggers = new Set(["issue_date", "competence_date", "first_installment_due_date"]);
const dueRules = new Set(["fixed_day", "days_after_event"]);
const businessAdjustments = new Set(["none", "previous_weekday", "next_weekday"]);
const categoryByRetention: Record<string, string> = {
  inss: "social",
  iss: "municipal",
  irrf: "federal",
  pis: "federal",
  cofins: "federal",
  csll: "federal",
  other: "other",
};

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return value(formData, key) || null;
}

function integer(formData: FormData, key: string, fallback = 0) {
  const parsed = Number.parseInt(value(formData, key), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArray(formData: FormData, key: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(value(formData, key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseRetentions(formData: FormData) {
  const keys = ["inss", "iss", "irrf", "pis", "cofins", "csll", "other"] as const;
  return Object.fromEntries(keys.map((key) => [key, Number(value(formData, `retention_${key}`) || 0)]));
}

function manualInvoiceNet(items: Array<Record<string, unknown>>, retentions: Record<string, number>) {
  const itemNet = items.reduce((sum, item) => {
    const quantity = Number(item.quantity ?? 0);
    const unitPrice = Number(item.unit_price ?? 0);
    const discount = Number(item.discount_amount ?? 0);
    return sum + quantity * unitPrice - discount;
  }, 0);
  return itemNet - Object.values(retentions).reduce((sum, amount) => sum + Number(amount || 0), 0);
}

function installmentDrafts(rows: Array<Record<string, unknown>>): FinancialInstallmentDraft[] {
  return rows.map((row, index) => ({
    id: `server-${index + 1}`,
    label: String(row.label ?? row.number ?? index + 1),
    due_date: String(row.due_date ?? ""),
    amount: Number(row.amount ?? 0),
    payment_method: String(row.payment_method ?? "Boleto"),
  }));
}

function pageUrl(message: string, type: "success" | "error", invoiceId?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (invoiceId) params.set("invoice", invoiceId);
  return `${PATH}?${params.toString()}`;
}

function cleanFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "documento";
}

function refreshFinancialPaths() {
  revalidatePath(PATH);
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/impostos");
  revalidatePath("/financeiro/fluxo-de-caixa");
  revalidatePath("/execucao/medicoes-contratos");
  revalidatePath("/suprimentos/recebimento-materiais");
}

export async function saveManualInvoice(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.manual_invoices.manage");
  if (!projectId) redirect(pageUrl("Selecione uma obra antes de lançar o documento.", "error"));

  const invoiceId = optional(formData, "invoice_id");
  const items = parseArray(formData, "items_json");
  const installments = parseArray(formData, "installments_json");
  const retentions = parseRetentions(formData);
  const net = manualInvoiceNet(items, retentions);
  const installmentSummary = financialInstallmentSummary(net, installmentDrafts(installments));
  if (!installmentSummary.valid) {
    redirect(pageUrl(
      `As parcelas precisam possuir datas e valores válidos e somar exatamente o líquido da nota. Diferença atual: R$ ${installmentSummary.difference.toFixed(2).replace(".", ",")}.`,
      "error",
      invoiceId ?? undefined,
    ));
  }

  const result = await supabase.rpc("save_and_post_finance_manual_invoice", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_invoice_id: invoiceId,
    p_supplier_id: value(formData, "supplier_id"),
    p_contract_id: optional(formData, "contract_id"),
    p_measurement_id: optional(formData, "measurement_id"),
    p_material_receipt_id: optional(formData, "material_receipt_id"),
    p_document_type: value(formData, "document_type"),
    p_document_number: value(formData, "document_number"),
    p_series: optional(formData, "series"),
    p_issue_date: value(formData, "issue_date"),
    p_competence_date: optional(formData, "competence_date"),
    p_notes: optional(formData, "notes"),
    p_retentions: retentions,
    p_items: items,
    p_installments: installments,
  });

  if (result.error || !result.data) {
    redirect(pageUrl(result.error?.message ?? "Não foi possível lançar a nota manual.", "error", invoiceId ?? undefined));
  }

  const resolvedId = String(result.data);
  refreshFinancialPaths();
  redirect(pageUrl(invoiceId ? "Nota atualizada e lançamentos financeiros sincronizados." : "Nota lançada e contas geradas com sucesso.", "success", resolvedId));
}

export async function saveManualRetentionRule(formData: FormData) {
  const retentionKey = value(formData, "retention_key");
  const projectId = value(formData, "project_id");
  const authoritySupplierId = value(formData, "authority_supplier_id");
  const dueTrigger = value(formData, "due_trigger");
  const dueRule = value(formData, "due_rule");
  const businessDayAdjustment = value(formData, "business_day_adjustment") || "none";
  const dueDay = integer(formData, "due_day", 0);
  const dueMonthOffset = integer(formData, "due_month_offset", 1);
  const dueDaysAfterEvent = integer(formData, "due_days_after_event", 0);
  const code = value(formData, "code").toUpperCase();
  const name = value(formData, "name");

  if (
    !retentionKeys.has(retentionKey) || !projectId || !authoritySupplierId || !code || !name ||
    !dueTriggers.has(dueTrigger) || !dueRules.has(dueRule) || !businessAdjustments.has(businessDayAdjustment) ||
    dueMonthOffset < 0 || dueMonthOffset > 24 || dueDaysAfterEvent < 0 || dueDaysAfterEvent > 730 ||
    (dueRule === "fixed_day" && (dueDay < 1 || dueDay > 31))
  ) {
    redirect(pageUrl("Revise a retenção, o órgão favorecido e a regra de vencimento.", "error"));
  }

  const { supabase, companyId, userId } = await requireCompanyPermission("finance.taxes.manage");
  const [projectResult, supplierResult] = await Promise.all([
    supabase.from("projects").select("id").eq("id", projectId).eq("company_id", companyId).neq("status", "archived").maybeSingle(),
    supabase.from("suppliers").select("id").eq("id", authoritySupplierId).eq("company_id", companyId).eq("status", "active").maybeSingle(),
  ]);
  if (!projectResult.data) redirect(pageUrl("A obra da regra não pertence à empresa ativa.", "error"));
  if (!supplierResult.data) redirect(pageUrl("O órgão favorecido está inativo ou não pertence à empresa.", "error"));

  const existingResult = await supabase
    .from("finance_tax_types")
    .select("id")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .eq("retention_key", retentionKey)
    .eq("status", "active")
    .maybeSingle();

  const payload = {
    company_id: companyId,
    project_id: projectId,
    retention_key: retentionKey,
    code,
    name,
    category: categoryByRetention[retentionKey] ?? "other",
    authority_supplier_id: authoritySupplierId,
    fiscal_class: optional(formData, "fiscal_class"),
    payment_method: optional(formData, "payment_method") || "Guia / DARF",
    document_prefix: optional(formData, "document_prefix"),
    due_trigger: dueTrigger,
    due_rule: dueRule,
    due_day: dueRule === "fixed_day" ? dueDay : null,
    due_month_offset: dueMonthOffset,
    due_days_after_event: dueRule === "days_after_event" ? dueDaysAfterEvent : 0,
    business_day_adjustment: businessDayAdjustment,
    auto_generate_payable: true,
    notes: optional(formData, "rule_notes"),
    status: "active",
    updated_at: new Date().toISOString(),
  };

  const result = existingResult.data
    ? await supabase.from("finance_tax_types").update(payload).eq("id", existingResult.data.id).eq("company_id", companyId)
    : await supabase.from("finance_tax_types").insert({ ...payload, created_by: userId });

  if (result.error) {
    const message = result.error.code === "23505"
      ? "Já existe um tributo ou uma regra ativa com este código e escopo."
      : result.error.message;
    redirect(pageUrl(message, "error"));
  }

  revalidatePath(PATH);
  revalidatePath("/financeiro/impostos");
  redirect(pageUrl(`Regra de ${retentionKey.toUpperCase()} salva para a obra.`, "success"));
}

export async function deleteManualInvoice(formData: FormData) {
  const invoiceId = value(formData, "invoice_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.manual_invoices.manage");
  if (!projectId || !invoiceId) redirect(pageUrl("Nota manual inválida.", "error"));

  const documentsResult = await supabase
    .from("finance_manual_invoice_documents")
    .select("storage_path")
    .eq("invoice_id", invoiceId)
    .eq("company_id", companyId)
    .eq("project_id", projectId);

  const result = await supabase.rpc("delete_finance_manual_invoice", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_invoice_id: invoiceId,
  });
  if (result.error) redirect(pageUrl(result.error.message, "error", invoiceId));

  const paths = (documentsResult.data ?? []).map((item) => item.storage_path).filter(Boolean);
  if (paths.length) await supabase.storage.from("manual-invoice-documents").remove(paths);

  refreshFinancialPaths();
  redirect(pageUrl("Nota manual e lançamentos não pagos excluídos.", "success"));
}

export async function uploadManualInvoiceDocuments(formData: FormData) {
  const invoiceId = value(formData, "invoice_id");
  const documentType = value(formData, "document_type") || "invoice";
  const caption = optional(formData, "caption");
  const files = formData.getAll("documents").filter((file): file is File => file instanceof File && file.size > 0);
  if (!files.length) redirect(pageUrl("Selecione ao menos um arquivo.", "error", invoiceId));

  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("finance.manual_invoices.manage");
  if (!projectId) redirect(pageUrl("Selecione uma obra.", "error", invoiceId));

  const invoiceResult = await supabase
    .from("finance_manual_invoices")
    .select("id,status")
    .eq("id", invoiceId)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!invoiceResult.data || invoiceResult.data.status === "cancelled") {
    redirect(pageUrl("Documento não disponível para anexos.", "error", invoiceId));
  }

  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) redirect(pageUrl(`O arquivo ${file.name} excede 10 MB.`, "error", invoiceId));
    const fileName = cleanFileName(file.name);
    const storagePath = `${companyId}/${projectId}/${invoiceId}/${crypto.randomUUID()}-${fileName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploaded = await supabase.storage.from("manual-invoice-documents").upload(storagePath, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploaded.error) redirect(pageUrl(uploaded.error.message, "error", invoiceId));

    const inserted = await supabase.from("finance_manual_invoice_documents").insert({
      company_id: companyId,
      project_id: projectId,
      invoice_id: invoiceId,
      document_type: documentType,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: file.type || null,
      file_size: file.size,
      caption,
      uploaded_by: userId,
    });
    if (inserted.error) {
      await supabase.storage.from("manual-invoice-documents").remove([storagePath]);
      redirect(pageUrl(inserted.error.message, "error", invoiceId));
    }
  }

  revalidatePath(PATH);
  redirect(pageUrl("Anexo(s) enviado(s) com sucesso.", "success", invoiceId));
}

export async function removeManualInvoiceDocument(formData: FormData) {
  const invoiceId = value(formData, "invoice_id");
  const documentId = value(formData, "document_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.manual_invoices.manage");
  if (!projectId) redirect(pageUrl("Selecione uma obra.", "error", invoiceId));

  const [documentResult, mutabilityResult] = await Promise.all([
    supabase.from("finance_manual_invoice_documents").select("id,storage_path").eq("id", documentId).eq("invoice_id", invoiceId).eq("company_id", companyId).eq("project_id", projectId).maybeSingle(),
    supabase.rpc("manual_invoice_mutability", { p_company_id: companyId, p_project_id: projectId, p_invoice_id: invoiceId }),
  ]);
  if (!documentResult.data) redirect(pageUrl("Anexo não encontrado.", "error", invoiceId));
  const mutability = mutabilityResult.data as { mutable?: boolean; reason?: string } | null;
  if (!mutability?.mutable) redirect(pageUrl(mutability?.reason ?? "A nota não permite remover anexos.", "error", invoiceId));

  const removed = await supabase.storage.from("manual-invoice-documents").remove([documentResult.data.storage_path]);
  if (removed.error) redirect(pageUrl(removed.error.message, "error", invoiceId));
  const deleted = await supabase.from("finance_manual_invoice_documents").delete().eq("id", documentId).eq("company_id", companyId);
  if (deleted.error) redirect(pageUrl(deleted.error.message, "error", invoiceId));

  revalidatePath(PATH);
  redirect(pageUrl("Anexo removido.", "success", invoiceId));
}
