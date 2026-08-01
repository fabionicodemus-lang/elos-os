"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/suprimentos/controle-integrado";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function numeric(formData: FormData, key: string) {
  const source = text(formData, key);
  const normalized = source.includes(",") ? source.replace(/\./g, "").replace(",", ".") : source;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}
function target(message: string, type: "success" | "error", extra: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams({ [type]: message });
  Object.entries(extra).forEach(([key, value]) => { if (value) params.set(key, value); });
  return `${PATH}?${params.toString()}`;
}

export async function saveInventoryReservation(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.intelligence.manage");
  if (!projectId) redirect(target("Selecione uma obra.", "error"));
  const reservationId = optional(formData, "reservation_id");
  const result = await supabase.rpc("save_procurement_inventory_reservation", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_reservation_id: reservationId,
    p_balance_id: text(formData, "balance_id"),
    p_service_id: optional(formData, "service_id"),
    p_supply_plan_item_id: optional(formData, "supply_plan_item_id"),
    p_quantity: numeric(formData, "quantity"),
    p_required_date: optional(formData, "required_date"),
    p_notes: optional(formData, "notes"),
  });
  if (result.error || !result.data) redirect(target(result.error?.message ?? "Não foi possível salvar a reserva.", "error"));
  revalidatePath(PATH);
  revalidatePath("/suprimentos/estoque");
  revalidatePath("/engenharia/planejamento-suprimentos");
  redirect(target(reservationId ? "Reserva atualizada." : "Estoque reservado para a execução.", "success"));
}

export async function changeInventoryReservation(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.intelligence.manage");
  if (!projectId) redirect(target("Selecione uma obra.", "error"));
  const action = text(formData, "action");
  const result = await supabase.rpc("change_procurement_inventory_reservation", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_reservation_id: text(formData, "reservation_id"),
    p_action: action,
    p_notes: optional(formData, "notes"),
  });
  if (result.error) redirect(target(result.error.message, "error"));
  revalidatePath(PATH);
  revalidatePath("/suprimentos/estoque");
  revalidatePath("/engenharia/planejamento-suprimentos");
  const message = action === "consume" ? "Reserva consumida e saída registrada no estoque." : action === "release" ? "Reserva liberada." : "Reserva cancelada.";
  redirect(target(message, "success"));
}

export async function transferInventoryBetweenProjects(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.intelligence.manage");
  if (!projectId) redirect(target("Selecione a obra de origem.", "error"));
  const result = await supabase.rpc("transfer_procurement_inventory_between_projects", {
    p_company_id: companyId,
    p_from_project_id: projectId,
    p_to_project_id: text(formData, "to_project_id"),
    p_from_balance_id: text(formData, "from_balance_id"),
    p_to_location_id: text(formData, "to_location_id"),
    p_quantity: numeric(formData, "quantity"),
    p_notes: optional(formData, "notes"),
  });
  if (result.error || !result.data) redirect(target(result.error?.message ?? "Não foi possível transferir o material.", "error"));
  revalidatePath(PATH);
  revalidatePath("/suprimentos/estoque");
  revalidatePath("/engenharia/planejamento-suprimentos");
  redirect(target("Transferência entre obras registrada nas duas movimentações de estoque.", "success"));
}
