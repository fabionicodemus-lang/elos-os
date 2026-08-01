"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/execucao/medicoes-por-etapas";
function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function numeric(formData: FormData, key: string, fallback = 0) {
  const raw = text(formData, key).replace(/\s/g, "");
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : fallback;
}
function jsonArray(formData: FormData, key: string) { try { const value = JSON.parse(text(formData, key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function target(message: string, type: "success" | "error", measurement?: string, contract?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (measurement) params.set("measurement", measurement);
  if (contract) params.set("contract", contract);
  return `${PATH}?${params.toString()}`;
}

export async function saveStageMeasurement(formData: FormData) {
  const measurementId = optional(formData, "measurement_id");
  const contractId = text(formData, "contract_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.measurements.manage");
  if (!projectId) redirect(target("Selecione uma obra.", "error"));
  const { data, error } = await supabase.rpc("save_execution_stage_contract_measurement", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_measurement_id: measurementId,
    p_contract_id: contractId,
    p_period_start: optional(formData, "period_start"),
    p_period_end: optional(formData, "period_end"),
    p_tax_withholding: numeric(formData, "tax_withholding_amount"),
    p_advance_deduction: numeric(formData, "advance_deduction_amount"),
    p_other_discount: numeric(formData, "other_discount_amount"),
    p_notes: optional(formData, "notes"),
    p_contractor_notes: optional(formData, "contractor_notes"),
    p_items: jsonArray(formData, "items_json"),
  });
  if (error || !data) redirect(target(error?.message ?? "Não foi possível salvar a medição.", "error", measurementId ?? undefined, contractId));
  revalidatePath(PATH);
  revalidatePath("/execucao/medicoes-contratos");
  revalidatePath("/execucao/contratos-servicos");
  revalidatePath("/execucao/contratacoes-servicos");
  redirect(target(measurementId ? "Medição por etapas atualizada." : "Medição por etapas criada em elaboração.", "success", String(data), contractId));
}
