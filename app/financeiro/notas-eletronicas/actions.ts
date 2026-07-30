"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { normalizeMatchText, normalizeTaxId, parseNfeXml, type ParsedNfe } from "@/lib/nfe-xml";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/financeiro/notas-eletronicas";

type RawInstallment = {
  number?: unknown;
  due_date?: unknown;
  dueDate?: unknown;
  amount?: unknown;
  payment_method?: unknown;
  paymentMethod?: unknown;
};

function value(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return value(formData, key) || null; }
function parseArray(formData: FormData, key: string) {
  try { const parsed = JSON.parse(value(formData, key) || "[]"); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function pageUrl(message: string, type: "success" | "error", invoiceId?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (invoiceId) params.set("invoice", invoiceId);
  return `${PATH}?${params.toString()}`;
}
function cleanFileName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "nfe.xml";
}
function supplierProductKey(item: ParsedNfe["items"][number]) {
  const code = normalizeMatchText(item.supplierCode);
  if (code) return `code:${code}`;
  const ean = String(item.ean ?? "").replace(/\D/g, "");
  if (ean) return `ean:${ean}`;
  return `desc:${normalizeMatchText(item.description)}`;
}

export async function importElectronicInvoice(formData: FormData) {
  const xmlFile = formData.get("xml_file");
  if (!(xmlFile instanceof File) || xmlFile.size <= 0) redirect(pageUrl("Selecione o arquivo XML da NF-e.", "error"));
  if (xmlFile.size > 5 * 1024 * 1024) redirect(pageUrl("O XML excede o limite de 5 MB.", "error"));
  if (!xmlFile.name.toLowerCase().endsWith(".xml")) redirect(pageUrl("O arquivo precisa possuir a extensão .xml.", "error"));

  let parsed: ParsedNfe;
  try { parsed = parseNfeXml(await xmlFile.text()); }
  catch (error) { redirect(pageUrl(error instanceof Error ? error.message : "Não foi possível interpretar o XML.", "error")); }

  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("finance.invoices.manage");
  if (!projectId) redirect(pageUrl("Selecione uma obra antes de importar a nota.", "error"));

  const issuerTaxId = normalizeTaxId(parsed.issuer.taxId);
  const supplierResult = await supabase.from("suppliers").select("id,tax_id,legal_name,status").eq("company_id", companyId).eq("status", "active").limit(3000);
  if (supplierResult.error) redirect(pageUrl(supplierResult.error.message, "error"));

  let supplierId = supplierResult.data?.find((supplier) => normalizeTaxId(supplier.tax_id) === issuerTaxId)?.id ?? null;
  if (!supplierId && value(formData, "create_supplier") === "1") {
    const permission = await supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "suppliers.manage" });
    if (permission.data !== true) redirect(pageUrl("O emitente não está cadastrado e seu perfil não pode criar fornecedores.", "error"));
    const created = await supabase.from("suppliers").insert({
      company_id: companyId,
      person_type: issuerTaxId.length === 14 ? "company" : "individual",
      legal_name: parsed.issuer.name || "Emitente da NF-e",
      trade_name: parsed.issuer.tradeName || null,
      tax_id: issuerTaxId,
      state_registration: parsed.issuer.stateRegistration || null,
      phone: parsed.issuer.phone || null,
      email: parsed.issuer.email || null,
      city: parsed.issuer.city || null,
      state: parsed.issuer.state || null,
      category: "Fornecedor importado por NF-e",
      status: "active",
      source_system: "nfe_xml",
      source_id: `issuer:${issuerTaxId}`,
      created_by: userId,
    }).select("id").single();
    if (created.error || !created.data) redirect(pageUrl(created.error?.message ?? "Não foi possível cadastrar o emitente.", "error"));
    supplierId = created.data.id;
  }
  if (!supplierId) redirect(pageUrl(`O emitente ${parsed.issuer.name || issuerTaxId} não está cadastrado como fornecedor ativo.`, "error"));

  const clientMappings = parseArray(formData, "items_json") as Array<Record<string, unknown>>;
  const mappingByLine = new Map(clientMappings.map((mapping) => [Number(mapping.line_number), mapping]));
  const items = parsed.items.map((item) => {
    const mapping = mappingByLine.get(item.lineNumber) ?? {};
    return {
      line_number: item.lineNumber,
      supplier_code: item.supplierCode,
      ean: item.ean,
      description: item.description,
      ncm: item.ncm,
      cfop: item.cfop,
      unit: item.unit,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      gross_amount: item.grossAmount,
      discount_amount: item.discountAmount,
      freight_amount: item.freightAmount,
      other_amount: item.otherAmount,
      total_amount: item.totalAmount,
      icms_amount: item.icmsAmount,
      ipi_amount: item.ipiAmount,
      pis_amount: item.pisAmount,
      cofins_amount: item.cofinsAmount,
      input_id: String(mapping.input_id ?? "") || null,
      order_item_id: String(mapping.order_item_id ?? "") || null,
      receipt_item_id: String(mapping.receipt_item_id ?? "") || null,
      cost_center_service_id: String(mapping.cost_center_service_id ?? "") || null,
      notes: String(mapping.notes ?? "") || null,
    };
  });

  const clientInstallments = parseArray(formData, "installments_json") as RawInstallment[];
  const installmentSource: RawInstallment[] = clientInstallments.length ? clientInstallments : parsed.installments;
  const installments = installmentSource.map((installment, index) => ({
    number: String(installment.number ?? index + 1),
    due_date: String(installment.due_date ?? installment.dueDate ?? parsed.issueDate),
    amount: Number(installment.amount ?? 0),
    payment_method: String(installment.payment_method ?? installment.paymentMethod ?? "Não informado"),
  }));

  const payload = {
    access_key: parsed.accessKey,
    model: parsed.model,
    series: parsed.series,
    number: parsed.number,
    issue_date: parsed.issueDate,
    issue_datetime: parsed.issueDateTime,
    nature_operation: parsed.natureOperation,
    issuer: { tax_id: parsed.issuer.taxId, name: parsed.issuer.name, trade_name: parsed.issuer.tradeName, state_registration: parsed.issuer.stateRegistration },
    recipient: { tax_id: parsed.recipient.taxId, name: parsed.recipient.name },
    totals: {
      products: parsed.totals.products,
      freight: parsed.totals.freight,
      insurance: parsed.totals.insurance,
      discount: parsed.totals.discount,
      import_tax: parsed.totals.importTax,
      ipi: parsed.totals.ipi,
      pis: parsed.totals.pis,
      cofins: parsed.totals.cofins,
      icms: parsed.totals.icms,
      other: parsed.totals.other,
      invoice: parsed.totals.invoice,
    },
  };

  const bytes = new Uint8Array(await xmlFile.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  const storagePath = `${companyId}/${projectId}/${parsed.accessKey}-${hash.slice(0, 12)}.xml`;
  const upload = await supabase.storage.from("electronic-invoice-xml").upload(storagePath, bytes, { contentType: "application/xml", upsert: false });
  if (upload.error) redirect(pageUrl(upload.error.message, "error"));

  const saved = await supabase.rpc("save_finance_electronic_invoice", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_supplier_id: supplierId,
    p_order_id: optional(formData, "order_id"),
    p_receipt_id: optional(formData, "receipt_id"),
    p_xml_storage_path: storagePath,
    p_xml_file_name: cleanFileName(xmlFile.name),
    p_xml_hash: hash,
    p_payload: payload,
    p_items: items,
    p_installments: installments,
  });
  if (saved.error || !saved.data) {
    await supabase.storage.from("electronic-invoice-xml").remove([storagePath]);
    redirect(pageUrl(saved.error?.message ?? "Não foi possível importar a NF-e.", "error"));
  }

  const sefazDocumentId = optional(formData, "sefaz_document_id");
  if (sefazDocumentId) {
    await supabase.from("finance_sefaz_documents").update({ processing_status: "imported", imported_invoice_id: String(saved.data), updated_at: new Date().toISOString() }).eq("company_id", companyId).eq("id", sefazDocumentId);
  }

  let mappingWarnings = 0;
  for (const item of parsed.items) {
    const mapping = mappingByLine.get(item.lineNumber);
    const inputId = String(mapping?.input_id ?? "").trim();
    if (!inputId) continue;
    const remembered = await supabase.rpc("remember_finance_supplier_product_mapping", {
      p_company_id: companyId,
      p_supplier_id: supplierId,
      p_product_key: supplierProductKey(item),
      p_supplier_product_code: item.supplierCode || null,
      p_ean: item.ean || null,
      p_description: item.description,
      p_description_normalized: normalizeMatchText(item.description),
      p_input_id: inputId,
    });
    if (remembered.error) mappingWarnings += 1;
  }

  revalidatePath(PATH);
  const message = mappingWarnings
    ? `XML importado. ${mappingWarnings} associação(ões) não puderam ser memorizadas; revise a migration 0046.`
    : sefazDocumentId
      ? "NF-e importada diretamente da SEFAZ. Revise os itens, o pedido e as parcelas antes de aprovar."
      : "XML importado. As associações fornecedor × produto × insumo foram memorizadas para as próximas notas.";
  redirect(pageUrl(message, "success", String(saved.data)));
}

export async function resolveInvoiceDivergence(formData: FormData) {
  const invoiceId = value(formData, "invoice_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.invoices.approve");
  if (!projectId) redirect(pageUrl("Selecione uma obra.", "error"));
  const result = await supabase.rpc("resolve_finance_electronic_invoice_divergence", { p_company_id: companyId, p_project_id: projectId, p_invoice_id: invoiceId, p_divergence_id: value(formData, "divergence_id"), p_action: value(formData, "action"), p_notes: value(formData, "notes") });
  if (result.error) redirect(pageUrl(result.error.message, "error", invoiceId));
  revalidatePath(PATH);
  redirect(pageUrl("Divergência tratada com rastreabilidade.", "success", invoiceId));
}

export async function approveElectronicInvoice(formData: FormData) {
  const invoiceId = value(formData, "invoice_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.invoices.approve");
  if (!projectId) redirect(pageUrl("Selecione uma obra.", "error"));
  const result = await supabase.rpc("approve_finance_electronic_invoice", { p_company_id: companyId, p_project_id: projectId, p_invoice_id: invoiceId, p_notes: optional(formData, "notes") });
  if (result.error) redirect(pageUrl(result.error.message, "error", invoiceId));
  revalidatePath(PATH);
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/suprimentos/pedidos-compras");
  redirect(pageUrl("NF-e aprovada e parcelas geradas no Contas a Pagar.", "success", invoiceId));
}

export async function rejectElectronicInvoice(formData: FormData) {
  const invoiceId = value(formData, "invoice_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.invoices.approve");
  if (!projectId) redirect(pageUrl("Selecione uma obra.", "error"));
  const result = await supabase.rpc("reject_finance_electronic_invoice", { p_company_id: companyId, p_project_id: projectId, p_invoice_id: invoiceId, p_reason: value(formData, "reason") });
  if (result.error) redirect(pageUrl(result.error.message, "error", invoiceId));
  revalidatePath(PATH);
  redirect(pageUrl("NF-e devolvida para correção.", "success", invoiceId));
}

export async function cancelElectronicInvoice(formData: FormData) {
  const invoiceId = value(formData, "invoice_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.invoices.cancel");
  if (!projectId) redirect(pageUrl("Selecione uma obra.", "error"));
  const result = await supabase.rpc("cancel_finance_electronic_invoice", { p_company_id: companyId, p_project_id: projectId, p_invoice_id: invoiceId, p_reason: value(formData, "reason") });
  if (result.error) redirect(pageUrl(result.error.message, "error", invoiceId));
  revalidatePath(PATH);
  redirect(pageUrl("NF-e cancelada no Elos OS.", "success", invoiceId));
}
