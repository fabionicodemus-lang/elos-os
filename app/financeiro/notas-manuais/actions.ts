"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/financeiro/notas-manuais";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return value(formData, key) || null;
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

export async function saveManualInvoice(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.manual_invoices.manage");
  if (!projectId) redirect(pageUrl("Selecione uma obra antes de lançar o documento.", "error"));

  const items = parseArray(formData, "items_json");
  const installments = parseArray(formData, "installments_json");
  const submit = value(formData, "submit_mode") === "submit";

  const result = await supabase.rpc("save_finance_manual_invoice", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_invoice_id: optional(formData, "invoice_id"),
    p_supplier_id: value(formData, "supplier_id"),
    p_contract_id: optional(formData, "contract_id"),
    p_measurement_id: optional(formData, "measurement_id"),
    p_document_type: value(formData, "document_type"),
    p_document_number: value(formData, "document_number"),
    p_series: optional(formData, "series"),
    p_issue_date: value(formData, "issue_date"),
    p_competence_date: optional(formData, "competence_date"),
    p_notes: optional(formData, "notes"),
    p_retentions: parseRetentions(formData),
    p_items: items,
    p_installments: installments,
    p_submit: submit,
  });

  if (result.error || !result.data) {
    redirect(pageUrl(result.error?.message ?? "Não foi possível salvar o documento.", "error", optional(formData, "invoice_id") ?? undefined));
  }

  const invoiceId = String(result.data);
  revalidatePath(PATH);
  redirect(pageUrl(submit ? "Documento enviado para aprovação." : "Rascunho salvo com sucesso.", "success", invoiceId));
}

export async function approveManualInvoice(formData: FormData) {
  const invoiceId = value(formData, "invoice_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.manual_invoices.approve");
  if (!projectId) redirect(pageUrl("Selecione uma obra.", "error"));

  const result = await supabase.rpc("approve_finance_manual_invoice", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_invoice_id: invoiceId,
    p_notes: optional(formData, "notes"),
  });
  if (result.error) redirect(pageUrl(result.error.message, "error", invoiceId));

  revalidatePath(PATH);
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/execucao/medicoes-contratos");
  redirect(pageUrl("Documento aprovado e parcelas geradas no Contas a Pagar.", "success", invoiceId));
}

export async function rejectManualInvoice(formData: FormData) {
  const invoiceId = value(formData, "invoice_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.manual_invoices.approve");
  if (!projectId) redirect(pageUrl("Selecione uma obra.", "error"));

  const result = await supabase.rpc("reject_finance_manual_invoice", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_invoice_id: invoiceId,
    p_reason: value(formData, "reason"),
  });
  if (result.error) redirect(pageUrl(result.error.message, "error", invoiceId));

  revalidatePath(PATH);
  redirect(pageUrl("Documento devolvido para correção.", "success", invoiceId));
}

export async function cancelManualInvoice(formData: FormData) {
  const invoiceId = value(formData, "invoice_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.manual_invoices.cancel");
  if (!projectId) redirect(pageUrl("Selecione uma obra.", "error"));

  const result = await supabase.rpc("cancel_finance_manual_invoice", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_invoice_id: invoiceId,
    p_reason: value(formData, "reason"),
  });
  if (result.error) redirect(pageUrl(result.error.message, "error", invoiceId));

  revalidatePath(PATH);
  redirect(pageUrl("Documento cancelado no Elos OS.", "success", invoiceId));
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

  const [documentResult, invoiceResult] = await Promise.all([
    supabase.from("finance_manual_invoice_documents").select("id,storage_path").eq("id", documentId).eq("invoice_id", invoiceId).eq("company_id", companyId).eq("project_id", projectId).maybeSingle(),
    supabase.from("finance_manual_invoices").select("status").eq("id", invoiceId).eq("company_id", companyId).eq("project_id", projectId).maybeSingle(),
  ]);
  if (!documentResult.data) redirect(pageUrl("Anexo não encontrado.", "error", invoiceId));
  if (invoiceResult.data?.status === "approved") redirect(pageUrl("Anexos de documentos aprovados não podem ser removidos.", "error", invoiceId));

  const removed = await supabase.storage.from("manual-invoice-documents").remove([documentResult.data.storage_path]);
  if (removed.error) redirect(pageUrl(removed.error.message, "error", invoiceId));
  const deleted = await supabase.from("finance_manual_invoice_documents").delete().eq("id", documentId).eq("company_id", companyId);
  if (deleted.error) redirect(pageUrl(deleted.error.message, "error", invoiceId));

  revalidatePath(PATH);
  redirect(pageUrl("Anexo removido.", "success", invoiceId));
}
