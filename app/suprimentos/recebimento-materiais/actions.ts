"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { RpcArgs } from "@/lib/supabase/types";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/suprimentos/recebimento-materiais";
const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const optional = (formData: FormData, key: string) => text(formData, key) || null;
const numberValue = (formData: FormData, key: string) => { const value = Number(text(formData, key).replace(",", ".")); return Number.isFinite(value) ? value : null; };
const jsonArray = (formData: FormData, key: string) => { try { const value = JSON.parse(text(formData, key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
function resultUrl(message: string, type: "success" | "error", receipt?: string) { const params = new URLSearchParams({ [type]: message }); if (receipt) params.set("receipt", receipt); return `${PATH}?${params}`; }
function refresh() { revalidatePath(PATH); revalidatePath("/suprimentos/pedidos-compras"); revalidatePath("/execucao/solicitacoes-materiais"); }

export async function saveMaterialReceipt(formData: FormData) {
  const receiptId = optional(formData, "receipt_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.receipts.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { data, error } = await supabase.rpc("save_procurement_material_receipt", {
    p_company_id: companyId, p_project_id: projectId, p_receipt_id: receiptId, p_order_id: optional(formData, "order_id"),
    p_receipt_date: optional(formData, "receipt_date"), p_arrival_time: optional(formData, "arrival_time"),
    p_invoice_number: optional(formData, "invoice_number"), p_invoice_series: optional(formData, "invoice_series"), p_invoice_access_key: optional(formData, "invoice_access_key"),
    p_invoice_date: optional(formData, "invoice_date"), p_invoice_amount: numberValue(formData, "invoice_amount"),
    p_carrier_name: optional(formData, "carrier_name"), p_vehicle_plate: optional(formData, "vehicle_plate"), p_driver_name: optional(formData, "driver_name"),
    p_delivery_document: optional(formData, "delivery_document"), p_warehouse_location: optional(formData, "warehouse_location"),
    p_general_condition: optional(formData, "general_condition"), p_notes: optional(formData, "notes"), p_items: jsonArray(formData, "items_json"),
  });
  if (error || !data) redirect(resultUrl(error?.message ?? "Não foi possível salvar o recebimento.", "error", receiptId ?? undefined));
  refresh(); redirect(resultUrl(receiptId ? "Recebimento atualizado." : "Recebimento criado em elaboração.", "success", String(data)));
}

// O parâmetro adicional passa a vir explícito de cada ação. Antes era deduzido
// do nome da RPC (`rpc.includes("approve")`), o que quebraria silenciosamente se
// alguma função fosse renomeada.
type ReceiptStatusRpc =
  | "submit_procurement_material_receipt"
  | "approve_procurement_material_receipt"
  | "reject_procurement_material_receipt"
  | "cancel_procurement_material_receipt";

async function statusAction<T extends ReceiptStatusRpc>(
  formData: FormData,
  permission: string,
  rpc: T,
  success: string,
  extra: Omit<RpcArgs<T>, "p_company_id" | "p_project_id" | "p_receipt_id"> = {} as Omit<
    RpcArgs<T>,
    "p_company_id" | "p_project_id" | "p_receipt_id"
  >,
) {
  const receiptId = text(formData, "receipt_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission(permission);
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const args = { p_company_id: companyId, p_project_id: projectId, p_receipt_id: receiptId, ...extra } as RpcArgs<T>;
  const { error } = await supabase.rpc(rpc, args);
  if (error) redirect(resultUrl(error.message, "error", receiptId));
  refresh(); redirect(resultUrl(success, "success", receiptId));
}
export async function submitMaterialReceipt(formData: FormData) { return statusAction(formData, "procurement.receipts.submit", "submit_procurement_material_receipt", "Recebimento enviado para aprovação."); }
export async function approveMaterialReceipt(formData: FormData) { return statusAction(formData, "procurement.receipts.approve", "approve_procurement_material_receipt", "Recebimento aprovado e saldos do pedido atualizados.", { p_notes: optional(formData, "notes") }); }
export async function rejectMaterialReceipt(formData: FormData) { return statusAction(formData, "procurement.receipts.approve", "reject_procurement_material_receipt", "Recebimento devolvido para correção.", { p_reason: text(formData, "reason") }); }
export async function cancelMaterialReceipt(formData: FormData) { return statusAction(formData, "procurement.receipts.cancel", "cancel_procurement_material_receipt", "Recebimento cancelado.", { p_reason: text(formData, "reason") }); }

export async function uploadMaterialReceiptDocuments(formData: FormData) {
  const receiptId = text(formData, "receipt_id");
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("procurement.receipts.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  let uploaded = 0;
  for (const value of formData.getAll("documents")) {
    if (!(value instanceof File) || value.size <= 0) continue;
    if (value.size > 25 * 1024 * 1024) redirect(resultUrl(`${value.name} excede 25 MB.`, "error", receiptId));
    const safe = value.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100);
    const path = `${companyId}/${projectId}/${receiptId}/${crypto.randomUUID()}-${safe}`;
    const upload = await supabase.storage.from("material-receipt-documents").upload(path, new Uint8Array(await value.arrayBuffer()), { contentType: value.type, upsert: false });
    if (upload.error) redirect(resultUrl(upload.error.message, "error", receiptId));
    const insert = await supabase.from("procurement_material_receipt_documents").insert({ company_id: companyId, project_id: projectId, receipt_id: receiptId, document_type: text(formData, "document_type") || "evidence", storage_path: path, file_name: value.name, mime_type: value.type, file_size: value.size, caption: optional(formData, "caption"), uploaded_by: userId });
    if (insert.error) { await supabase.storage.from("material-receipt-documents").remove([path]); redirect(resultUrl(insert.error.message, "error", receiptId)); }
    uploaded += 1;
  }
  refresh(); redirect(resultUrl(`${uploaded} documento(s) anexado(s).`, "success", receiptId));
}
