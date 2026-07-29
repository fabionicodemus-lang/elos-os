"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/suprimentos/estoque";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function numberValue(formData: FormData, key: string, fallback = 0) {
  const value = Number(text(formData, key).replace(",", "."));
  return Number.isFinite(value) ? value : fallback;
}
function booleanValue(formData: FormData, key: string) { return ["1", "true", "on", "yes"].includes(text(formData, key).toLowerCase()); }
function jsonArray(formData: FormData, key: string) {
  try { const parsed = JSON.parse(text(formData, key) || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function url(message: string, type: "success" | "error", extra: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams({ [type]: message });
  Object.entries(extra).forEach(([key, value]) => { if (value) params.set(key, value); });
  return `${PATH}?${params.toString()}`;
}

export async function saveInventoryLocation(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.inventory.manage");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const locationId = optional(formData, "location_id");
  const { data, error } = await supabase.rpc("save_procurement_inventory_location", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_location_id: locationId,
    p_code: text(formData, "code"),
    p_name: text(formData, "name"),
    p_type: text(formData, "location_type") || "warehouse",
    p_address: optional(formData, "address"),
    p_responsible_name: optional(formData, "responsible_name"),
    p_allow_negative: booleanValue(formData, "allow_negative"),
    p_notes: optional(formData, "notes"),
  });
  if (error || !data) redirect(url(error?.message ?? "Não foi possível salvar o local.", "error"));
  revalidatePath(PATH);
  redirect(url(locationId ? "Local atualizado." : "Local de estoque criado.", "success"));
}

export async function postInventoryMovement(formData: FormData) {
  const movementType = text(formData, "movement_type");
  const permission = movementType === "issue" ? "procurement.inventory.issue" : movementType === "transfer" ? "procurement.inventory.transfer" : "procurement.inventory.adjust";
  const { supabase, companyId, projectId } = await requireCompanyPermission(permission);
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const { data, error } = await supabase.rpc("post_procurement_inventory_movement", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_movement_type: movementType,
    p_movement_date: optional(formData, "movement_date"),
    p_input_id: text(formData, "input_id"),
    p_from_location_id: optional(formData, "from_location_id"),
    p_to_location_id: optional(formData, "to_location_id"),
    p_quantity: numberValue(formData, "quantity"),
    p_unit_cost: numberValue(formData, "unit_cost"),
    p_batch_number: optional(formData, "batch_number"),
    p_expiration_date: optional(formData, "expiration_date"),
    p_cost_center_service_id: optional(formData, "cost_center_service_id"),
    p_recipient_name: optional(formData, "recipient_name"),
    p_source_type: "manual",
    p_source_id: null,
    p_source_reference: optional(formData, "source_reference"),
    p_notes: optional(formData, "notes"),
  });
  if (error || !data) redirect(url(error?.message ?? "Não foi possível registrar a movimentação.", "error", { view: "movements" }));
  revalidatePath(PATH);
  redirect(url("Movimentação registrada e saldo atualizado.", "success", { view: "movements" }));
}

export async function setInventoryThreshold(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.inventory.manage");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("set_procurement_inventory_threshold", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_balance_id: text(formData, "balance_id"),
    p_minimum: numberValue(formData, "minimum_quantity"),
    p_maximum: optional(formData, "maximum_quantity") ? numberValue(formData, "maximum_quantity") : null,
  });
  if (error) redirect(url(error.message, "error"));
  revalidatePath(PATH);
  redirect(url("Níveis de estoque atualizados.", "success"));
}

export async function saveInventoryCount(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.inventory.count");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const countId = optional(formData, "count_id");
  const { data, error } = await supabase.rpc("save_procurement_inventory_count", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_count_id: countId,
    p_location_id: text(formData, "location_id"),
    p_count_date: text(formData, "count_date"),
    p_notes: optional(formData, "notes"),
    p_items: jsonArray(formData, "items_json"),
  });
  if (error || !data) redirect(url(error?.message ?? "Não foi possível salvar o inventário.", "error", { view: "counts" }));
  revalidatePath(PATH);
  redirect(url(countId ? "Inventário atualizado." : "Inventário físico criado.", "success", { view: "counts", count: String(data) }));
}

async function changeCount(formData: FormData, action: "submit" | "approve" | "cancel", success: string) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.inventory.count");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const countId = text(formData, "count_id");
  const { error } = await supabase.rpc("change_procurement_inventory_count_status", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_count_id: countId,
    p_action: action,
    p_notes: optional(formData, "notes"),
  });
  if (error) redirect(url(error.message, "error", { view: "counts", count: countId }));
  revalidatePath(PATH);
  redirect(url(success, "success", { view: "counts", count: countId }));
}

export async function submitInventoryCount(formData: FormData) { return changeCount(formData, "submit", "Inventário enviado para aprovação."); }
export async function approveInventoryCount(formData: FormData) { return changeCount(formData, "approve", "Inventário aprovado e diferenças ajustadas no estoque."); }
export async function cancelInventoryCount(formData: FormData) { return changeCount(formData, "cancel", "Inventário cancelado."); }
