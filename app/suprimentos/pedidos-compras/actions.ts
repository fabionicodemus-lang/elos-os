"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/suprimentos/pedidos-compras";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function safeName(name: string) {
  const extension = name.includes(".") ? `.${name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  const stem = name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "documento";
  return `${stem}${extension}`;
}
function resultUrl(message: string, type: "success" | "error", order?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (order) params.set("order", order);
  return `${PATH}?${params.toString()}`;
}
function refresh() {
  revalidatePath(PATH);
  revalidatePath("/suprimentos/orcamentos-materiais");
  revalidatePath("/execucao/solicitacoes-materiais");
  revalidatePath("/dashboard");
}

export async function generatePurchaseOrders(formData: FormData) {
  const quotationId = text(formData, "quotation_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.orders.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra antes de gerar os pedidos.", "error"));
  const { data, error } = await supabase.rpc("generate_procurement_purchase_orders_from_quotation", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_quotation_id: quotationId,
  });
  if (error) redirect(resultUrl(error.message, "error"));
  const payload = data as { created_count?: number; order_ids?: string[] } | null;
  const firstOrder = payload?.order_ids?.[0];
  refresh();
  redirect(resultUrl(`${payload?.created_count ?? 0} pedido(s) gerado(s), um para cada fornecedor vencedor.`, "success", firstOrder));
}

export async function savePurchaseOrderHeader(formData: FormData) {
  const orderId = text(formData, "order_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.orders.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("save_procurement_purchase_order_header", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_order_id: orderId,
    p_expected_delivery_date: optional(formData, "expected_delivery_date"),
    p_delivery_address: optional(formData, "delivery_address"),
    p_payment_terms: optional(formData, "payment_terms"),
    p_freight_terms: optional(formData, "freight_terms"),
    p_warranty_terms: optional(formData, "warranty_terms"),
    p_supplier_contact_name: optional(formData, "supplier_contact_name"),
    p_supplier_contact_email: optional(formData, "supplier_contact_email"),
    p_supplier_contact_phone: optional(formData, "supplier_contact_phone"),
    p_notes: optional(formData, "notes"),
    p_supplier_notes: optional(formData, "supplier_notes"),
  });
  if (error) redirect(resultUrl(error.message, "error", orderId));
  refresh();
  redirect(resultUrl("Dados do pedido atualizados.", "success", orderId));
}

export async function issuePurchaseOrder(formData: FormData) {
  const orderId = text(formData, "order_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.orders.issue");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("issue_procurement_purchase_order", { p_company_id: companyId, p_project_id: projectId, p_order_id: orderId });
  if (error) redirect(resultUrl(error.message, "error", orderId));
  refresh();
  redirect(resultUrl("Pedido emitido. As quantidades das solicitações foram comprometidas.", "success", orderId));
}

export async function confirmPurchaseOrder(formData: FormData) {
  const orderId = text(formData, "order_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.orders.confirm");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("confirm_procurement_purchase_order", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_order_id: orderId,
    p_reference: optional(formData, "reference"),
    p_confirmed_delivery_date: optional(formData, "confirmed_delivery_date"),
    p_notes: optional(formData, "notes"),
  });
  if (error) redirect(resultUrl(error.message, "error", orderId));
  refresh();
  redirect(resultUrl("Confirmação do fornecedor registrada.", "success", orderId));
}

export async function cancelPurchaseOrder(formData: FormData) {
  const orderId = text(formData, "order_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.orders.cancel");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("cancel_procurement_purchase_order", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_order_id: orderId,
    p_reason: text(formData, "reason"),
  });
  if (error) redirect(resultUrl(error.message, "error", orderId));
  refresh();
  redirect(resultUrl("Pedido cancelado e quantidades não recebidas estornadas.", "success", orderId));
}

export async function closePurchaseOrder(formData: FormData) {
  const orderId = text(formData, "order_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.orders.issue");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("close_procurement_purchase_order", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_order_id: orderId,
    p_notes: optional(formData, "notes"),
  });
  if (error) redirect(resultUrl(error.message, "error", orderId));
  refresh();
  redirect(resultUrl("Pedido encerrado.", "success", orderId));
}

export async function uploadPurchaseOrderDocuments(formData: FormData) {
  const orderId = text(formData, "order_id");
  const documentType = text(formData, "document_type") || "other";
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("procurement.orders.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  let uploaded = 0;
  for (const value of formData.getAll("documents")) {
    if (!(value instanceof File) || value.size <= 0) continue;
    if (value.size > 25 * 1024 * 1024) redirect(resultUrl(`${value.name} excede 25 MB.`, "error", orderId));
    const allowed = value.type === "application/pdf" || value.type.startsWith("image/") || value.type.includes("spreadsheet") || value.type.includes("wordprocessingml");
    if (!allowed) redirect(resultUrl(`${value.name} não possui formato aceito.`, "error", orderId));
    const path = `${companyId}/${projectId}/${orderId}/${crypto.randomUUID()}-${safeName(value.name)}`;
    const storage = await supabase.storage.from("purchase-order-documents").upload(path, new Uint8Array(await value.arrayBuffer()), { contentType: value.type, upsert: false });
    if (storage.error) redirect(resultUrl(storage.error.message, "error", orderId));
    const insert = await supabase.from("procurement_purchase_order_documents").insert({
      company_id: companyId, project_id: projectId, order_id: orderId, document_type: documentType,
      storage_path: path, file_name: value.name, mime_type: value.type, file_size: value.size,
      caption: optional(formData, "caption"), uploaded_by: userId,
    });
    if (insert.error) {
      await supabase.storage.from("purchase-order-documents").remove([path]);
      redirect(resultUrl(insert.error.message, "error", orderId));
    }
    uploaded += 1;
  }
  refresh();
  redirect(resultUrl(`${uploaded} documento(s) anexado(s).`, "success", orderId));
}

export async function removePurchaseOrderDocument(formData: FormData) {
  const orderId = text(formData, "order_id");
  const documentId = text(formData, "document_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.orders.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { data: document } = await supabase.from("procurement_purchase_order_documents").select("storage_path").eq("id", documentId).eq("company_id", companyId).eq("project_id", projectId).eq("order_id", orderId).maybeSingle();
  if (!document) redirect(resultUrl("Documento não encontrado.", "error", orderId));
  const deletion = await supabase.from("procurement_purchase_order_documents").delete().eq("id", documentId);
  if (deletion.error) redirect(resultUrl(deletion.error.message, "error", orderId));
  await supabase.storage.from("purchase-order-documents").remove([document.storage_path]);
  refresh();
  redirect(resultUrl("Documento removido.", "success", orderId));
}
